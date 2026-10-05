use crate::errors::Fi6900Error;
use crate::events::*;
use crate::instructions::collect_asset_vault_pairs;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, MintTo, SetAuthority, TokenAccount, TokenInterface,
};
use anchor_spl::token_2022::spl_token_2022::instruction::AuthorityType;

// ---------------------------------------------------------------------------
// initialize_fund
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeFund<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Fund::INIT_SPACE,
        seeds = [FUND_SEED, index_mint.key().as_ref()],
        bump
    )]
    pub fund: Box<Account<'info, Fund>>,
    #[account(
        mut,
        constraint = index_mint.decimals == INDEX_DECIMALS @ Fi6900Error::InvalidMint,
        constraint = index_mint.supply == 0 @ Fi6900Error::SupplyNotZero,
        constraint = index_mint.mint_authority == COption::Some(authority.key()) @ Fi6900Error::Unauthorized,
        constraint = index_mint.freeze_authority.is_none() @ Fi6900Error::InvalidMint,
        constraint = index_mint.to_account_info().owner == &token_program.key() @ Fi6900Error::InvalidMint,
    )]
    pub index_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_fund(
    ctx: Context<InitializeFund>,
    mint_fee_bps: u16,
    redeem_fee_bps: u16,
    mgmt_fee_bps: u16,
    timelock_slots: u64,
) -> Result<()> {
    validate_fees(mint_fee_bps, redeem_fee_bps, mgmt_fee_bps)?;
    let now = Clock::get()?.unix_timestamp;
    let fund = &mut ctx.accounts.fund;
    fund.authority = ctx.accounts.authority.key();
    fund.pending_authority = Pubkey::default();
    fund.rebalancer = ctx.accounts.authority.key();
    fund.fee_recipient = ctx.accounts.authority.key();
    fund.index_mint = ctx.accounts.index_mint.key();
    fund.bump = ctx.bumps.fund;
    fund.asset_count = 0;
    fund.active_bitmap = [0u64; BITMAP_WORDS];
    fund.occupied_bitmap = [0u64; BITMAP_WORDS];
    fund.mint_fee_bps = mint_fee_bps;
    fund.redeem_fee_bps = redeem_fee_bps;
    fund.mgmt_fee_bps = mgmt_fee_bps;
    fund.last_fee_accrual_ts = now;
    fund.epoch = 0;
    fund.open_auctions = 0;
    fund.paused = 0;
    fund.auction_nonce = 0;
    fund.max_auction_discount_bps = DEFAULT_MAX_AUCTION_DISCOUNT_BPS;
    fund.max_ref_move_bps = DEFAULT_MAX_REF_MOVE_BPS;
    fund.ref_move_period_slots = DEFAULT_REF_MOVE_PERIOD_SLOTS;
    fund.timelock_slots = timelock_slots;
    fund.action_nonce = 0;
    fund.reserved = [0u8; 64];

    // Take over mint authority.
    token_interface::set_authority(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            SetAuthority {
                current_authority: ctx.accounts.authority.to_account_info(),
                account_or_mint: ctx.accounts.index_mint.to_account_info(),
            },
        ),
        AuthorityType::MintTokens,
        Some(fund.key()),
    )?;

    emit!(FundInitialized {
        fund: fund.key(),
        index_mint: fund.index_mint,
        authority: fund.authority,
    });
    Ok(())
}

pub fn validate_fees(mint_fee_bps: u16, redeem_fee_bps: u16, mgmt_fee_bps: u16) -> Result<()> {
    require!(mint_fee_bps <= MAX_FEE_BPS, Fi6900Error::InvalidArgument);
    require!(redeem_fee_bps <= MAX_FEE_BPS, Fi6900Error::InvalidArgument);
    require!(mgmt_fee_bps <= MAX_FEE_BPS, Fi6900Error::InvalidArgument);
    Ok(())
}

/// Direct admin setters are only allowed while the timelock is disabled.
pub fn require_no_timelock(fund: &Fund) -> Result<()> {
    require!(!fund.timelock_enabled(), Fi6900Error::TimelockRequired);
    Ok(())
}

// ---------------------------------------------------------------------------
// Shared "apply" helpers (used by the direct ixs and by execute_action)
// ---------------------------------------------------------------------------

pub fn apply_set_fees(fund: &mut Fund, mint_fee_bps: u16, redeem_fee_bps: u16, mgmt_fee_bps: u16) -> Result<()> {
    validate_fees(mint_fee_bps, redeem_fee_bps, mgmt_fee_bps)?;
    fund.mint_fee_bps = mint_fee_bps;
    fund.redeem_fee_bps = redeem_fee_bps;
    fund.mgmt_fee_bps = mgmt_fee_bps;
    Ok(())
}

pub fn apply_set_fee_recipient(fund: &mut Fund, new_fee_recipient: Pubkey) -> Result<()> {
    require!(new_fee_recipient != Pubkey::default(), Fi6900Error::InvalidArgument);
    fund.fee_recipient = new_fee_recipient;
    Ok(())
}

pub fn apply_set_target_weight(asset: &mut Asset, target_weight_bps: u16) -> Result<()> {
    require!(target_weight_bps as u128 <= BPS_DENOMINATOR, Fi6900Error::InvalidArgument);
    require!(asset.status == ASSET_STATUS_ACTIVE, Fi6900Error::WrongAssetStatus);
    asset.target_weight_bps = target_weight_bps;
    Ok(())
}

pub fn apply_begin_remove_asset(fund: &mut Fund, asset: &mut Asset) -> Result<()> {
    require!(asset.status == ASSET_STATUS_ACTIVE, Fi6900Error::WrongAssetStatus);
    asset.status = ASSET_STATUS_REMOVING;
    asset.target_weight_bps = 0;
    bitmap_clear(&mut fund.active_bitmap, asset.index);
    Ok(())
}

pub fn apply_set_max_auction_discount(fund: &mut Fund, bps: u16) -> Result<()> {
    require!(bps <= MAX_AUCTION_DISCOUNT_CAP_BPS, Fi6900Error::InvalidArgument);
    fund.max_auction_discount_bps = bps;
    Ok(())
}

pub fn apply_set_ref_move_policy(fund: &mut Fund, max_ref_move_bps: u16, period_slots: u64) -> Result<()> {
    require!(max_ref_move_bps as u128 <= BPS_DENOMINATOR, Fi6900Error::InvalidArgument);
    require!(period_slots > 0, Fi6900Error::InvalidArgument);
    fund.max_ref_move_bps = max_ref_move_bps;
    fund.ref_move_period_slots = period_slots;
    Ok(())
}

/// Fills a freshly created Asset account and claims the next free slot.
pub fn apply_add_asset(
    fund: &mut Fund,
    fund_key: Pubkey,
    asset: &mut Asset,
    asset_key: Pubkey,
    mint: &InterfaceAccount<'_, Mint>,
    vault: Pubkey,
    token_program: Pubkey,
    bump: u8,
    target_weight_bps: u16,
) -> Result<()> {
    require!(target_weight_bps as u128 <= BPS_DENOMINATOR, Fi6900Error::InvalidArgument);
    let slot = fund.next_free_slot().ok_or(Fi6900Error::MaxAssets)?;
    bitmap_set(&mut fund.occupied_bitmap, slot);
    bitmap_set(&mut fund.active_bitmap, slot);
    fund.asset_count = fund
        .asset_count
        .checked_add(1)
        .ok_or(Fi6900Error::MathOverflow)?;

    asset.fund = fund_key;
    asset.mint = mint.key();
    asset.vault = vault;
    asset.token_program = token_program;
    asset.index = slot;
    asset.status = ASSET_STATUS_ACTIVE;
    asset.decimals = mint.decimals;
    asset.target_weight_bps = target_weight_bps;
    asset.pending_deposits = 0;
    asset.pending_withdrawals = 0;
    asset.bump = bump;
    asset.ref_price = 0;
    asset.ref_price_updated_slot = 0;
    asset.ref_price_anchor = 0;
    asset.ref_price_anchor_slot = 0;
    asset.reserved = [0u8; 32];

    emit!(AssetAdded {
        fund: fund_key,
        asset: asset_key,
        mint: asset.mint,
        vault: asset.vault,
        index: slot,
        target_weight_bps,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// add_asset (direct; timelock must be 0)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct AddAsset<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ Fi6900Error::Unauthorized)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(
        constraint = mint.key() != fund.index_mint @ Fi6900Error::InvalidMint,
        constraint = mint.to_account_info().owner == &token_program.key() @ Fi6900Error::InvalidMint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = authority,
        space = 8 + Asset::INIT_SPACE,
        seeds = [ASSET_SEED, fund.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub asset: Box<Account<'info, Asset>>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = fund,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn add_asset(ctx: Context<AddAsset>, target_weight_bps: u16) -> Result<()> {
    require_no_timelock(&ctx.accounts.fund)?;
    let asset_key = ctx.accounts.asset.key();
    let vault = ctx.accounts.vault.key();
    let token_program = ctx.accounts.token_program.key();
    let fund_key = ctx.accounts.fund.key();
    apply_add_asset(
        &mut ctx.accounts.fund,
        fund_key,
        &mut ctx.accounts.asset,
        asset_key,
        &ctx.accounts.mint,
        vault,
        token_program,
        ctx.bumps.asset,
        target_weight_bps,
    )
}

// ---------------------------------------------------------------------------
// Fund-level admin (set_fees, set_rebalancer, set_fee_recipient, set_paused,
// set_timelock, set_auction_params, propose_authority)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FundAdmin<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ Fi6900Error::Unauthorized)]
    pub fund: Box<Account<'info, Fund>>,
}

pub fn set_fees(
    ctx: Context<FundAdmin>,
    mint_fee_bps: u16,
    redeem_fee_bps: u16,
    mgmt_fee_bps: u16,
) -> Result<()> {
    require_no_timelock(&ctx.accounts.fund)?;
    apply_set_fees(&mut ctx.accounts.fund, mint_fee_bps, redeem_fee_bps, mgmt_fee_bps)
}

pub fn set_rebalancer(ctx: Context<FundAdmin>, new_rebalancer: Pubkey) -> Result<()> {
    require_no_timelock(&ctx.accounts.fund)?;
    ctx.accounts.fund.rebalancer = new_rebalancer;
    Ok(())
}

pub fn set_fee_recipient(ctx: Context<FundAdmin>, new_fee_recipient: Pubkey) -> Result<()> {
    require_no_timelock(&ctx.accounts.fund)?;
    apply_set_fee_recipient(&mut ctx.accounts.fund, new_fee_recipient)
}

/// Protective: never timelocked.
pub fn set_paused(ctx: Context<FundAdmin>, mask: u8) -> Result<()> {
    require!(
        mask & !(PAUSE_MINT | PAUSE_REDEEM | PAUSE_AUCTIONS) == 0,
        Fi6900Error::InvalidArgument
    );
    ctx.accounts.fund.paused = mask;
    Ok(())
}

/// Enables the timelock from 0; once enabled, changing it requires a queued action.
pub fn set_timelock(ctx: Context<FundAdmin>, timelock_slots: u64) -> Result<()> {
    require_no_timelock(&ctx.accounts.fund)?;
    ctx.accounts.fund.timelock_slots = timelock_slots;
    Ok(())
}

pub fn set_auction_params(
    ctx: Context<FundAdmin>,
    max_auction_discount_bps: u16,
    max_ref_move_bps: u16,
    ref_move_period_slots: u64,
) -> Result<()> {
    require_no_timelock(&ctx.accounts.fund)?;
    apply_set_max_auction_discount(&mut ctx.accounts.fund, max_auction_discount_bps)?;
    apply_set_ref_move_policy(&mut ctx.accounts.fund, max_ref_move_bps, ref_move_period_slots)
}

pub fn propose_authority(ctx: Context<FundAdmin>, new_authority: Pubkey) -> Result<()> {
    ctx.accounts.fund.pending_authority = new_authority;
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    pub pending_authority: Signer<'info>,
    #[account(
        mut,
        constraint = fund.pending_authority == pending_authority.key() @ Fi6900Error::Unauthorized,
        constraint = fund.pending_authority != Pubkey::default() @ Fi6900Error::Unauthorized,
    )]
    pub fund: Box<Account<'info, Fund>>,
}

pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
    let fund = &mut ctx.accounts.fund;
    fund.authority = fund.pending_authority;
    fund.pending_authority = Pubkey::default();
    Ok(())
}

// ---------------------------------------------------------------------------
// Asset-level admin (set_target_weight, begin_remove_asset) — direct; timelock must be 0
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct AssetAdmin<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ Fi6900Error::Unauthorized)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(mut, has_one = fund)]
    pub asset: Box<Account<'info, Asset>>,
}

pub fn set_target_weight(ctx: Context<AssetAdmin>, target_weight_bps: u16) -> Result<()> {
    require_no_timelock(&ctx.accounts.fund)?;
    apply_set_target_weight(&mut ctx.accounts.asset, target_weight_bps)
}

pub fn begin_remove_asset(ctx: Context<AssetAdmin>) -> Result<()> {
    require_no_timelock(&ctx.accounts.fund)?;
    apply_begin_remove_asset(&mut ctx.accounts.fund, &mut ctx.accounts.asset)
}

// ---------------------------------------------------------------------------
// finalize_remove_asset (completion step; only possible once the vault is empty)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FinalizeRemoveAsset<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ Fi6900Error::Unauthorized)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(
        mut,
        close = authority,
        has_one = fund,
        has_one = vault,
        has_one = token_program,
        constraint = asset.status == ASSET_STATUS_REMOVING @ Fi6900Error::WrongAssetStatus,
    )]
    pub asset: Box<Account<'info, Asset>>,
    #[account(mut)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn finalize_remove_asset(ctx: Context<FinalizeRemoveAsset>) -> Result<()> {
    let asset = &ctx.accounts.asset;
    require!(
        ctx.accounts.vault.amount == 0
            && asset.pending_deposits == 0
            && asset.pending_withdrawals == 0,
        Fi6900Error::AssetNotEmpty
    );

    let fund = &mut ctx.accounts.fund;
    let index_mint = fund.index_mint;
    let bump = fund.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[FUND_SEED, index_mint.as_ref(), &[bump]]];

    // Close the (empty) vault; rent goes to the authority.
    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.authority.to_account_info(),
            authority: fund.to_account_info(),
        },
        signer_seeds,
    ))?;

    bitmap_clear(&mut fund.occupied_bitmap, asset.index);
    bitmap_clear(&mut fund.active_bitmap, asset.index);
    fund.asset_count = fund
        .asset_count
        .checked_sub(1)
        .ok_or(Fi6900Error::MathOverflow)?;

    emit!(AssetRemoved {
        fund: fund.key(),
        asset: asset.key(),
        mint: asset.mint,
        index: asset.index,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// bootstrap_mint
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct BootstrapMint<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ Fi6900Error::Unauthorized, has_one = index_mint)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(mut, constraint = index_mint.supply == 0 @ Fi6900Error::SupplyNotZero)]
    pub index_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, constraint = recipient_ata.mint == fund.index_mint @ Fi6900Error::InvalidMint)]
    pub recipient_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// remaining_accounts: `[Asset, vault]` for every active slot in index order.
/// Every vault must already hold the basket (amount > 0).
pub fn bootstrap_mint<'info>(
    ctx: Context<'_, '_, 'info, 'info, BootstrapMint<'info>>,
    units: u64,
) -> Result<()> {
    require!(units > 0, Fi6900Error::ZeroAmount);
    let fund = &mut ctx.accounts.fund;
    require!(!bitmap_is_empty(&fund.active_bitmap), Fi6900Error::EmptyVault);

    let pairs = collect_asset_vault_pairs(ctx.remaining_accounts, &fund.key(), &fund.active_bitmap)?;
    for (_, _, asset, amount) in pairs.iter() {
        require!(asset.effective_balance(*amount)? > 0, Fi6900Error::EmptyVault);
    }

    let index_mint = fund.index_mint;
    let bump = fund.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[FUND_SEED, index_mint.as_ref(), &[bump]]];
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.index_mint.to_account_info(),
                to: ctx.accounts.recipient_ata.to_account_info(),
                authority: fund.to_account_info(),
            },
            signer_seeds,
        ),
        units,
    )?;
    fund.last_fee_accrual_ts = Clock::get()?.unix_timestamp;
    Ok(())
}
