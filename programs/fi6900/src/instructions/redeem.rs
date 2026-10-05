use crate::errors::Fi6900Error;
use crate::events::RedeemBegun;
use crate::instructions::{chunk_complete, collect_asset_vault_chunk, store_asset};
use crate::math::{fee_amount, mul_div_floor};
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Reserve `entitled` for one chunk of `[Asset (writable), vault]` pairs starting at
/// `session.next_slot`. `supply_ref` is the supply the net units are a share of
/// (pre-burn supply, i.e. current supply + net once the burn has happened).
fn process_redeem_chunk<'info>(
    fund: &Fund,
    fund_key: &Pubkey,
    supply_ref: u64,
    net: u64,
    session: &mut RedeemSession,
    remaining: &[AccountInfo<'info>],
) -> Result<()> {
    let (pairs, next) =
        collect_asset_vault_chunk(remaining, fund_key, &fund.active_bitmap, session.next_slot)?;
    for (slot, asset_info, mut asset, vault_amount) in pairs.into_iter() {
        let effective = asset.effective_balance(vault_amount)?;
        let entitled = mul_div_floor(effective, net, supply_ref)?;
        session.entitled[slot as usize] = entitled;
        if entitled > 0 {
            asset.pending_withdrawals = asset
                .pending_withdrawals
                .checked_add(entitled)
                .ok_or(Fi6900Error::MathOverflow)?;
            store_asset(asset_info, &asset)?;
        }
    }
    session.next_slot = next;
    if chunk_complete(&fund.active_bitmap, next) {
        session.ready = 1;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// begin_redeem
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(units: u64, nonce: u64)]
pub struct BeginRedeem<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(has_one = index_mint)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(mut)]
    pub index_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = owner,
        space = 8 + RedeemSession::LEN,
        seeds = [REDEEM_SESSION_SEED, fund.key().as_ref(), owner.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub session: AccountLoader<'info, RedeemSession>,
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
    pub system_program: Program<'info, System>,
}

/// remaining_accounts: `[Asset (writable), vault]` for the first N active slots in index
/// order. Pays the fee and burns the net units now; further chunks via `begin_redeem_continue`.
pub fn begin_redeem<'info>(
    ctx: Context<'_, '_, 'info, 'info, BeginRedeem<'info>>,
    units: u64,
    nonce: u64,
) -> Result<()> {
    let fund = &ctx.accounts.fund;
    require!(!fund.is_paused(PAUSE_REDEEM), Fi6900Error::Paused);
    require!(units > 0, Fi6900Error::ZeroAmount);
    let supply_before = ctx.accounts.index_mint.supply;
    require!(supply_before > 0, Fi6900Error::SupplyZero);
    require!(!bitmap_is_empty(&fund.active_bitmap), Fi6900Error::WrongRemainingAccounts);

    let fee = fee_amount(units, fund.redeem_fee_bps)?;
    let net = units.checked_sub(fee).ok_or(Fi6900Error::MathOverflow)?;
    require!(net > 0, Fi6900Error::ZeroAmount);

    {
        let mut session = ctx.accounts.session.load_init()?;
        session.fund = fund.key();
        session.owner = ctx.accounts.owner.key();
        session.nonce = nonce;
        session.units = net;
        session.created_slot = Clock::get()?.slot;
        session.next_slot = 0;
        session.ready = 0;
        process_redeem_chunk(fund, &fund.key(), supply_before, net, &mut session, ctx.remaining_accounts)?;
    }

    // Fee units go to the fee recipient (owner signs), net units are burned.
    if fee > 0 {
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.owner_index_ata.to_account_info(),
                    mint: ctx.accounts.index_mint.to_account_info(),
                    to: ctx.accounts.fee_recipient_ata.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            fee,
            INDEX_DECIMALS,
        )?;
    }
    token_interface::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.index_mint.to_account_info(),
                from: ctx.accounts.owner_index_ata.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        net,
    )?;

    emit!(RedeemBegun {
        fund: fund.key(),
        owner: ctx.accounts.owner.key(),
        units,
        fee,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// begin_redeem_continue
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct BeginRedeemContinue<'info> {
    pub owner: Signer<'info>,
    #[account(has_one = index_mint)]
    pub fund: Box<Account<'info, Fund>>,
    pub index_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        constraint = session.load()?.owner == owner.key() @ Fi6900Error::Unauthorized,
        constraint = session.load()?.fund == fund.key() @ Fi6900Error::WrongRemainingAccounts,
    )]
    pub session: AccountLoader<'info, RedeemSession>,
}

/// remaining_accounts: `[Asset (writable), vault]` for the next active slots after `session.next_slot`.
pub fn begin_redeem_continue<'info>(
    ctx: Context<'_, '_, 'info, 'info, BeginRedeemContinue<'info>>,
) -> Result<()> {
    let fund = &ctx.accounts.fund;
    require!(!fund.is_paused(PAUSE_REDEEM), Fi6900Error::Paused);
    let mut session = ctx.accounts.session.load_mut()?;
    require!(session.ready == 0, Fi6900Error::SessionAlreadyReady);
    let net = session.units;
    // The net units were already burned at begin: they were a share of (supply + net).
    let supply_ref = ctx
        .accounts
        .index_mint
        .supply
        .checked_add(net)
        .ok_or(Fi6900Error::MathOverflow)?;
    process_redeem_chunk(fund, &fund.key(), supply_ref, net, &mut session, ctx.remaining_accounts)
}

// ---------------------------------------------------------------------------
// withdraw
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(slot: u16)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    pub fund: Box<Account<'info, Fund>>,
    #[account(
        mut,
        constraint = session.load()?.owner == owner.key() @ Fi6900Error::Unauthorized,
        constraint = session.load()?.fund == fund.key() @ Fi6900Error::WrongRemainingAccounts,
    )]
    pub session: AccountLoader<'info, RedeemSession>,
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

pub fn withdraw(ctx: Context<Withdraw>, slot: u16) -> Result<()> {
    let mut session = ctx.accounts.session.load_mut()?;
    require!(session.ready == 1, Fi6900Error::SessionNotReady);
    require!(
        !bitmap_get(&session.withdrawn_bitmap, slot),
        Fi6900Error::AlreadyWithdrawn
    );

    let amount = session.entitled[slot as usize];
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
        asset.pending_withdrawals = asset
            .pending_withdrawals
            .checked_sub(amount)
            .ok_or(Fi6900Error::MathOverflow)?;
    }
    bitmap_set(&mut session.withdrawn_bitmap, slot);
    Ok(())
}

// ---------------------------------------------------------------------------
// close_redeem
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CloseRedeem<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        mut,
        close = owner,
        constraint = session.load()?.owner == owner.key() @ Fi6900Error::Unauthorized,
        constraint = session.load()?.ready == 1 @ Fi6900Error::SessionNotReady,
        constraint = session.load()?.is_complete() @ Fi6900Error::IncompleteWithdrawals,
    )]
    pub session: AccountLoader<'info, RedeemSession>,
}

pub fn close_redeem(_ctx: Context<CloseRedeem>) -> Result<()> {
    Ok(())
}
