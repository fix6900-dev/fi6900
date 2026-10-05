use crate::errors::Fi6900Error;
use crate::events::MintFinalized;
use crate::instructions::{active_slots, chunk_complete, collect_asset_vault_chunk, load_asset_checked, store_asset};
use crate::math::{fee_amount, mul_div_ceil};
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

/// Compute `required` for one chunk of `[Asset, vault]` pairs starting at `session.next_slot`.
fn process_mint_chunk<'info>(
    fund: &Fund,
    fund_key: &Pubkey,
    supply: u64,
    units: u64,
    session: &mut MintSession,
    remaining: &[AccountInfo<'info>],
) -> Result<()> {
    let (pairs, next) =
        collect_asset_vault_chunk(remaining, fund_key, &fund.active_bitmap, session.next_slot)?;
    for (slot, _, asset, vault_amount) in pairs.iter() {
        let effective = asset.effective_balance(*vault_amount)?;
        session.required[*slot as usize] = mul_div_ceil(effective, units, supply)?;
    }
    session.next_slot = next;
    if chunk_complete(&fund.active_bitmap, next) {
        session.ready = 1;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// begin_mint
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(units: u64, nonce: u64)]
pub struct BeginMint<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(has_one = index_mint)]
    pub fund: Box<Account<'info, Fund>>,
    pub index_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = owner,
        space = 8 + MintSession::LEN,
        seeds = [MINT_SESSION_SEED, fund.key().as_ref(), owner.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub session: AccountLoader<'info, MintSession>,
    pub system_program: Program<'info, System>,
}

/// remaining_accounts: `[Asset, vault]` for the first N active slots in index order.
/// With every active slot supplied the session is `ready` immediately; otherwise call
/// `begin_mint_continue` with the next chunk(s).
pub fn begin_mint<'info>(
    ctx: Context<'_, '_, 'info, 'info, BeginMint<'info>>,
    units: u64,
    nonce: u64,
) -> Result<()> {
    let fund = &ctx.accounts.fund;
    require!(!fund.is_paused(PAUSE_MINT), Fi6900Error::Paused);
    require!(fund.open_auctions == 0, Fi6900Error::AuctionsOpen);
    require!(units > 0, Fi6900Error::ZeroAmount);
    let supply = ctx.accounts.index_mint.supply;
    require!(supply > 0, Fi6900Error::SupplyZero);
    require!(!bitmap_is_empty(&fund.active_bitmap), Fi6900Error::WrongRemainingAccounts);

    let mut session = ctx.accounts.session.load_init()?;
    session.fund = fund.key();
    session.owner = ctx.accounts.owner.key();
    session.nonce = nonce;
    session.units = units;
    session.epoch = fund.epoch;
    session.created_slot = Clock::get()?.slot;
    session.next_slot = 0;
    session.ready = 0;
    process_mint_chunk(fund, &fund.key(), supply, units, &mut session, ctx.remaining_accounts)
}

// ---------------------------------------------------------------------------
// begin_mint_continue
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct BeginMintContinue<'info> {
    pub owner: Signer<'info>,
    #[account(has_one = index_mint)]
    pub fund: Box<Account<'info, Fund>>,
    pub index_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        constraint = session.load()?.owner == owner.key() @ Fi6900Error::Unauthorized,
        constraint = session.load()?.fund == fund.key() @ Fi6900Error::WrongRemainingAccounts,
    )]
    pub session: AccountLoader<'info, MintSession>,
}

/// remaining_accounts: `[Asset, vault]` for the next active slots after `session.next_slot`.
pub fn begin_mint_continue<'info>(
    ctx: Context<'_, '_, 'info, 'info, BeginMintContinue<'info>>,
) -> Result<()> {
    let fund = &ctx.accounts.fund;
    require!(!fund.is_paused(PAUSE_MINT), Fi6900Error::Paused);
    require!(fund.open_auctions == 0, Fi6900Error::AuctionsOpen);
    let supply = ctx.accounts.index_mint.supply;
    require!(supply > 0, Fi6900Error::SupplyZero);
    let mut session = ctx.accounts.session.load_mut()?;
    require!(session.ready == 0, Fi6900Error::SessionAlreadyReady);
    require!(session.epoch == fund.epoch, Fi6900Error::StaleEpoch);
    let units = session.units;
    process_mint_chunk(fund, &fund.key(), supply, units, &mut session, ctx.remaining_accounts)
}

// ---------------------------------------------------------------------------
// deposit / cancel_mint_refund (shared account set)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(slot: u16)]
pub struct MintSessionSlot<'info> {
    pub owner: Signer<'info>,
    pub fund: Box<Account<'info, Fund>>,
    #[account(
        mut,
        constraint = session.load()?.owner == owner.key() @ Fi6900Error::Unauthorized,
        constraint = session.load()?.fund == fund.key() @ Fi6900Error::WrongRemainingAccounts,
    )]
    pub session: AccountLoader<'info, MintSession>,
    #[account(
        mut,
        has_one = fund,
        has_one = vault,
        has_one = mint,
        has_one = token_program,
        constraint = asset.index == slot @ Fi6900Error::SlotNotActive,
    )]
    pub asset: Box<Account<'info, Asset>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        constraint = owner_token.mint == asset.mint @ Fi6900Error::InvalidMint,
        constraint = owner_token.owner == owner.key() @ Fi6900Error::Unauthorized,
    )]
    pub owner_token: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Transfers `gross_amount` (default `required[slot]`) from the owner into the vault and credits
/// the amount the vault actually RECEIVED (balance delta). For a plain SPL / Token-2022 mint the
/// two are equal; for a Token-2022 mint with a `TransferFeeConfig` the fee is withheld on the
/// receiving side, so the caller must send a gross amount whose net clears `required`
/// (SDK: `grossForNet(required, feeBps, maxFee)`). `received < required` fails with `ShortDeposit`;
/// any excess stays in the vault and is credited to every holder at finalize.
///
/// Accounting: `asset.pending_deposits += received` and `session.required[slot]` is overwritten
/// with `received`, so finalize / refund release exactly what was credited. (The original
/// `required` is not needed after the deposit; keeping a separate `received` array would double
/// the 4 KB session.) A refund + re-deposit of the same slot therefore has to clear the previously
/// received amount, which is >= the original requirement — never less.
pub fn deposit(ctx: Context<MintSessionSlot>, slot: u16, gross_amount: Option<u64>) -> Result<()> {
    let fund = &ctx.accounts.fund;
    require!(!fund.is_paused(PAUSE_MINT), Fi6900Error::Paused);
    require!(fund.is_active(slot), Fi6900Error::SlotNotActive);
    require!(
        ctx.accounts.asset.status == ASSET_STATUS_ACTIVE,
        Fi6900Error::SlotNotActive
    );
    let mut session = ctx.accounts.session.load_mut()?;
    require!(session.ready == 1, Fi6900Error::SessionNotReady);
    require!(
        !bitmap_get(&session.deposited_bitmap, slot),
        Fi6900Error::AlreadyDeposited
    );
    // Fail fast if the session is already stale; saves the user a refund round-trip.
    require!(session.epoch == fund.epoch, Fi6900Error::StaleEpoch);

    let required = session.required[slot as usize];
    if required > 0 {
        let gross = gross_amount.unwrap_or(required);
        require!(gross >= required, Fi6900Error::ShortDeposit);
        let before = ctx.accounts.vault.amount;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.owner_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            gross,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.vault.reload()?;
        let received = ctx
            .accounts
            .vault
            .amount
            .checked_sub(before)
            .ok_or(Fi6900Error::MathOverflow)?;
        require!(received >= required, Fi6900Error::ShortDeposit);
        let asset = &mut ctx.accounts.asset;
        asset.pending_deposits = asset
            .pending_deposits
            .checked_add(received)
            .ok_or(Fi6900Error::MathOverflow)?;
        session.required[slot as usize] = received;
    }
    bitmap_set(&mut session.deposited_bitmap, slot);
    Ok(())
}

/// Refunds the amount the vault received for this slot (gross, from the vault; a fee mint taxes
/// the owner again on the way back) and releases the same amount from `pending_deposits`.
pub fn cancel_mint_refund(ctx: Context<MintSessionSlot>, slot: u16) -> Result<()> {
    let mut session = ctx.accounts.session.load_mut()?;
    require!(
        bitmap_get(&session.deposited_bitmap, slot),
        Fi6900Error::SlotNotActive
    );

    let amount = session.required[slot as usize];
    if amount > 0 {
        let fund = &ctx.accounts.fund;
        let index_mint = fund.index_mint;
        let bump = fund.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[FUND_SEED, index_mint.as_ref(), &[bump]]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_token.to_account_info(),
                    authority: fund.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        let asset = &mut ctx.accounts.asset;
        asset.pending_deposits = asset
            .pending_deposits
            .checked_sub(amount)
            .ok_or(Fi6900Error::MathOverflow)?;
    }
    bitmap_clear(&mut session.deposited_bitmap, slot);
    Ok(())
}

// ---------------------------------------------------------------------------
// finalize_mint
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FinalizeMint<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(has_one = index_mint)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(mut)]
    pub index_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        close = owner,
        constraint = session.load()?.owner == owner.key() @ Fi6900Error::Unauthorized,
        constraint = session.load()?.fund == fund.key() @ Fi6900Error::WrongRemainingAccounts,
    )]
    pub session: AccountLoader<'info, MintSession>,
    #[account(
        mut,
        constraint = owner_index_ata.mint == fund.index_mint @ Fi6900Error::InvalidMint,
        constraint = owner_index_ata.owner == owner.key() @ Fi6900Error::Unauthorized,
    )]
    pub owner_index_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = fee_recipient_ata.mint == fund.index_mint @ Fi6900Error::InvalidMint,
        constraint = fee_recipient_ata.owner == fund.fee_recipient @ Fi6900Error::Unauthorized,
    )]
    pub fee_recipient_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// remaining_accounts: `[Asset]` (writable) for every active slot in index order.
pub fn finalize_mint<'info>(ctx: Context<'_, '_, 'info, 'info, FinalizeMint<'info>>) -> Result<()> {
    let fund = &ctx.accounts.fund;
    let session = ctx.accounts.session.load()?;
    require!(!fund.is_paused(PAUSE_MINT), Fi6900Error::Paused);
    require!(session.ready == 1, Fi6900Error::SessionNotReady);
    require!(session.epoch == fund.epoch, Fi6900Error::StaleEpoch);
    require!(
        session.deposited_bitmap == fund.active_bitmap && !bitmap_is_empty(&fund.active_bitmap),
        Fi6900Error::IncompleteDeposits
    );

    // Release pending deposits into the live NAV. `required[slot]` holds the amount the vault
    // actually received (deposit overwrites it), so this is exactly what was credited.
    let mut iter = ctx.remaining_accounts.iter();
    for slot in active_slots(&fund.active_bitmap) {
        let info = iter
            .next()
            .ok_or_else(|| error!(Fi6900Error::WrongRemainingAccounts))?;
        let mut asset = load_asset_checked(info, &fund.key(), slot)?;
        let amount = session.required[slot as usize];
        asset.pending_deposits = asset
            .pending_deposits
            .checked_sub(amount)
            .ok_or(Fi6900Error::MathOverflow)?;
        store_asset(info, &asset)?;
    }
    require!(iter.next().is_none(), Fi6900Error::WrongRemainingAccounts);

    let units = session.units;
    let fee = fee_amount(units, fund.mint_fee_bps)?;
    let net = units.checked_sub(fee).ok_or(Fi6900Error::MathOverflow)?;
    require!(net > 0, Fi6900Error::ZeroAmount);

    let index_mint = fund.index_mint;
    let bump = fund.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[FUND_SEED, index_mint.as_ref(), &[bump]]];

    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.index_mint.to_account_info(),
                to: ctx.accounts.owner_index_ata.to_account_info(),
                authority: fund.to_account_info(),
            },
            signer_seeds,
        ),
        net,
    )?;
    if fee > 0 {
        token_interface::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.index_mint.to_account_info(),
                    to: ctx.accounts.fee_recipient_ata.to_account_info(),
                    authority: fund.to_account_info(),
                },
                signer_seeds,
            ),
            fee,
        )?;
    }

    emit!(MintFinalized {
        fund: fund.key(),
        owner: ctx.accounts.owner.key(),
        units,
        fee,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// cancel_mint_close
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CancelMintClose<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        close = owner,
        constraint = session.load()?.owner == owner.key() @ Fi6900Error::Unauthorized,
        constraint = bitmap_is_empty(&session.load()?.deposited_bitmap) @ Fi6900Error::IncompleteDeposits,
    )]
    pub session: AccountLoader<'info, MintSession>,
}

pub fn cancel_mint_close(_ctx: Context<CancelMintClose>) -> Result<()> {
    Ok(())
}
