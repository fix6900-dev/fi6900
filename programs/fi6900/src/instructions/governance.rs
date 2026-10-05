//! Reference prices (auction price bounds) and the admin timelock (PendingAction).
use crate::errors::Fi6900Error;
use crate::events::*;
use crate::instructions::admin::*;
use crate::math::move_bps;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

// ---------------------------------------------------------------------------
// set_ref_price
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SetRefPrice<'info> {
    pub signer: Signer<'info>,
    pub fund: Box<Account<'info, Fund>>,
    #[account(mut, has_one = fund)]
    pub asset: Box<Account<'info, Asset>>,
}

/// Rebalancer or authority. The first value (ref_price == 0) is authority-only and
/// unrestricted. Afterwards a move is measured against the anchor at the start of the
/// current `ref_move_period_slots` window and may not exceed `max_ref_move_bps`; the
/// authority may exceed it only while the timelock is disabled (otherwise queue an
/// `ACTION_REF_PRICE_OVERRIDE`).
pub fn set_ref_price(ctx: Context<SetRefPrice>, price: u128) -> Result<()> {
    let fund = &ctx.accounts.fund;
    let signer = ctx.accounts.signer.key();
    let is_authority = signer == fund.authority;
    let is_rebalancer = signer == fund.rebalancer;
    require!(is_authority || is_rebalancer, Fi6900Error::Unauthorized);
    require!(price > 0, Fi6900Error::InvalidArgument);

    let slot = Clock::get()?.slot;
    let asset = &mut ctx.accounts.asset;
    let old = asset.ref_price;

    if old == 0 {
        require!(is_authority, Fi6900Error::Unauthorized);
        asset.ref_price_anchor = price;
        asset.ref_price_anchor_slot = slot;
    } else {
        // Roll the move window.
        if slot >= asset.ref_price_anchor_slot.saturating_add(fund.ref_move_period_slots) {
            asset.ref_price_anchor = old;
            asset.ref_price_anchor_slot = slot;
        }
        let bps = move_bps(asset.ref_price_anchor, price)?;
        if bps > fund.max_ref_move_bps as u128 {
            if is_authority {
                require_no_timelock(fund)?;
            } else {
                return err!(Fi6900Error::RefPriceMoveTooLarge);
            }
            // Authority override (timelock disabled): re-anchor.
            asset.ref_price_anchor = price;
            asset.ref_price_anchor_slot = slot;
        }
    }
    asset.ref_price = price;
    asset.ref_price_updated_slot = slot;

    emit!(RefPriceSet {
        fund: fund.key(),
        asset: asset.key(),
        mint: asset.mint,
        old_price: old,
        new_price: price,
        signer,
        slot,
    });
    Ok(())
}

/// Authority override path used by execute_action (bypasses the move cap, re-anchors).
pub fn apply_ref_price_override(asset: &mut Asset, price: u128, slot: u64) -> Result<()> {
    require!(price > 0, Fi6900Error::InvalidArgument);
    asset.ref_price = price;
    asset.ref_price_updated_slot = slot;
    asset.ref_price_anchor = price;
    asset.ref_price_anchor_slot = slot;
    Ok(())
}

// ---------------------------------------------------------------------------
// queue_action
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct QueueAction<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority @ Fi6900Error::Unauthorized)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(
        init,
        payer = authority,
        space = 8 + PendingAction::INIT_SPACE,
        seeds = [PENDING_SEED, fund.key().as_ref(), &fund.action_nonce.to_le_bytes()],
        bump
    )]
    pub action: Box<Account<'info, PendingAction>>,
    pub system_program: Program<'info, System>,
}

fn validate_payload(kind: u8, key: &Pubkey, values: &[u64; 4]) -> Result<()> {
    let as_u16 = |v: u64| -> Result<u16> { u16::try_from(v).map_err(|_| error!(Fi6900Error::InvalidArgument)) };
    match kind {
        ACTION_SET_FEES => validate_fees(as_u16(values[0])?, as_u16(values[1])?, as_u16(values[2])?),
        ACTION_SET_TARGET_WEIGHT => {
            require!(*key != Pubkey::default(), Fi6900Error::InvalidArgument);
            require!(values[0] <= BPS_DENOMINATOR as u64, Fi6900Error::InvalidArgument);
            Ok(())
        }
        ACTION_SET_REBALANCER | ACTION_SET_FEE_RECIPIENT | ACTION_BEGIN_REMOVE_ASSET => {
            require!(*key != Pubkey::default(), Fi6900Error::InvalidArgument);
            Ok(())
        }
        ACTION_REF_PRICE_OVERRIDE => {
            require!(*key != Pubkey::default(), Fi6900Error::InvalidArgument);
            require!(values[0] != 0 || values[1] != 0, Fi6900Error::InvalidArgument);
            Ok(())
        }
        ACTION_SET_MAX_AUCTION_DISCOUNT => {
            require!(values[0] <= MAX_AUCTION_DISCOUNT_CAP_BPS as u64, Fi6900Error::InvalidArgument);
            Ok(())
        }
        ACTION_SET_TIMELOCK => Ok(()),
        ACTION_ADD_ASSET => {
            require!(*key != Pubkey::default(), Fi6900Error::InvalidArgument);
            require!(values[0] <= BPS_DENOMINATOR as u64, Fi6900Error::InvalidArgument);
            Ok(())
        }
        ACTION_SET_REF_MOVE_POLICY => {
            require!(values[0] <= BPS_DENOMINATOR as u64, Fi6900Error::InvalidArgument);
            require!(values[1] > 0, Fi6900Error::InvalidArgument);
            Ok(())
        }
        ACTION_SET_TOKEN_METADATA => {
            require!(*key != Pubkey::default(), Fi6900Error::InvalidArgument);
            Ok(())
        }
        _ => err!(Fi6900Error::InvalidActionKind),
    }
}

pub fn queue_action(ctx: Context<QueueAction>, kind: u8, key: Pubkey, values: [u64; 4]) -> Result<()> {
    require!(kind < ACTION_KIND_COUNT, Fi6900Error::InvalidActionKind);
    validate_payload(kind, &key, &values)?;
    let slot = Clock::get()?.slot;
    let fund = &mut ctx.accounts.fund;
    let nonce = fund.action_nonce;
    fund.action_nonce = nonce.checked_add(1).ok_or(Fi6900Error::MathOverflow)?;
    let eta = slot.checked_add(fund.timelock_slots).ok_or(Fi6900Error::MathOverflow)?;

    let action = &mut ctx.accounts.action;
    action.fund = fund.key();
    action.nonce = nonce;
    action.kind = kind;
    action.proposer = ctx.accounts.authority.key();
    action.queued_slot = slot;
    action.eta_slot = eta;
    action.key = key;
    action.values = values;
    action.bump = ctx.bumps.action;

    emit!(ActionQueued {
        fund: fund.key(),
        action: action.key(),
        nonce,
        kind,
        key,
        values,
        eta_slot: eta,
        proposer: action.proposer,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// execute_action (every kind except ADD_ASSET and SET_TOKEN_METADATA)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ExecuteAction<'info> {
    pub executor: Signer<'info>,
    #[account(mut)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(
        mut,
        close = proposer,
        has_one = fund,
        constraint = action.proposer == proposer.key() @ Fi6900Error::WrongActionTarget,
    )]
    pub action: Box<Account<'info, PendingAction>>,
    /// CHECK: receives the action rent; verified against action.proposer.
    #[account(mut)]
    pub proposer: UncheckedAccount<'info>,
    /// Required for SET_TARGET_WEIGHT / REF_PRICE_OVERRIDE / BEGIN_REMOVE_ASSET.
    #[account(mut, has_one = fund)]
    pub asset: Option<Box<Account<'info, Asset>>>,
}

fn require_eta(action: &PendingAction, slot: u64) -> Result<()> {
    require!(slot >= action.eta_slot, Fi6900Error::TimelockNotElapsed);
    Ok(())
}

/// Resolve the optional asset account and check it is the one the action names.
fn target_asset<'a, 'info>(
    asset: &'a mut Option<Box<Account<'info, Asset>>>,
    key: &Pubkey,
) -> Result<&'a mut Box<Account<'info, Asset>>> {
    let a = asset
        .as_mut()
        .ok_or_else(|| error!(Fi6900Error::WrongActionTarget))?;
    require!(a.mint == *key, Fi6900Error::WrongActionTarget);
    Ok(a)
}

pub fn execute_action(ctx: Context<ExecuteAction>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let action = &ctx.accounts.action;
    require_eta(action, slot)?;
    let fund = &mut ctx.accounts.fund;
    let asset_opt = &mut ctx.accounts.asset;

    match action.kind {
        ACTION_SET_FEES => apply_set_fees(fund, action.values[0] as u16, action.values[1] as u16, action.values[2] as u16)?,
        ACTION_SET_TARGET_WEIGHT => {
            let a = target_asset(asset_opt, &action.key)?;
            apply_set_target_weight(a, action.values[0] as u16)?;
        }
        ACTION_SET_REBALANCER => fund.rebalancer = action.key,
        ACTION_SET_FEE_RECIPIENT => apply_set_fee_recipient(fund, action.key)?,
        ACTION_REF_PRICE_OVERRIDE => {
            let a = target_asset(asset_opt, &action.key)?;
            let price = action.ref_price();
            let old = a.ref_price;
            apply_ref_price_override(a, price, slot)?;
            emit!(RefPriceSet {
                fund: fund.key(),
                asset: a.key(),
                mint: a.mint,
                old_price: old,
                new_price: price,
                signer: action.proposer,
                slot,
            });
        }
        ACTION_SET_MAX_AUCTION_DISCOUNT => apply_set_max_auction_discount(fund, action.values[0] as u16)?,
        ACTION_SET_TIMELOCK => fund.timelock_slots = action.values[0],
        ACTION_BEGIN_REMOVE_ASSET => {
            let a = target_asset(asset_opt, &action.key)?;
            apply_begin_remove_asset(fund, a)?;
        }
        ACTION_SET_REF_MOVE_POLICY => apply_set_ref_move_policy(fund, action.values[0] as u16, action.values[1])?,
        ACTION_ADD_ASSET | ACTION_SET_TOKEN_METADATA => return err!(Fi6900Error::WrongActionKind),
        _ => return err!(Fi6900Error::InvalidActionKind),
    }

    emit!(ActionExecuted {
        fund: fund.key(),
        action: action.key(),
        nonce: action.nonce,
        kind: action.kind,
        executor: ctx.accounts.executor.key(),
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// execute_action_add_asset (kind == ADD_ASSET; creates Asset + vault)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ExecuteActionAddAsset<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,
    #[account(mut)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(
        mut,
        close = proposer,
        has_one = fund,
        constraint = action.proposer == proposer.key() @ Fi6900Error::WrongActionTarget,
        constraint = action.kind == ACTION_ADD_ASSET @ Fi6900Error::WrongActionKind,
        constraint = action.key == mint.key() @ Fi6900Error::WrongActionTarget,
    )]
    pub action: Box<Account<'info, PendingAction>>,
    /// CHECK: receives the action rent; verified against action.proposer.
    #[account(mut)]
    pub proposer: UncheckedAccount<'info>,
    #[account(
        constraint = mint.key() != fund.index_mint @ Fi6900Error::InvalidMint,
        constraint = mint.to_account_info().owner == &token_program.key() @ Fi6900Error::InvalidMint,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = executor,
        space = 8 + Asset::INIT_SPACE,
        seeds = [ASSET_SEED, fund.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub asset: Box<Account<'info, Asset>>,
    #[account(
        init,
        payer = executor,
        associated_token::mint = mint,
        associated_token::authority = fund,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn execute_action_add_asset(ctx: Context<ExecuteActionAddAsset>) -> Result<()> {
    let slot = Clock::get()?.slot;
    require_eta(&ctx.accounts.action, slot)?;
    let asset_key = ctx.accounts.asset.key();
    let vault = ctx.accounts.vault.key();
    let token_program = ctx.accounts.token_program.key();
    let weight = ctx.accounts.action.values[0] as u16;
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
        weight,
    )?;
    emit!(ActionExecuted {
        fund: ctx.accounts.fund.key(),
        action: ctx.accounts.action.key(),
        nonce: ctx.accounts.action.nonce,
        kind: ACTION_ADD_ASSET,
        executor: ctx.accounts.executor.key(),
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// cancel_action
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CancelAction<'info> {
    pub authority: Signer<'info>,
    #[account(has_one = authority @ Fi6900Error::Unauthorized)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(
        mut,
        close = proposer,
        has_one = fund,
        constraint = action.proposer == proposer.key() @ Fi6900Error::WrongActionTarget,
    )]
    pub action: Box<Account<'info, PendingAction>>,
    /// CHECK: receives the action rent; verified against action.proposer.
    #[account(mut)]
    pub proposer: UncheckedAccount<'info>,
}

pub fn cancel_action(ctx: Context<CancelAction>) -> Result<()> {
    emit!(ActionCancelled {
        fund: ctx.accounts.fund.key(),
        action: ctx.accounts.action.key(),
        nonce: ctx.accounts.action.nonce,
        kind: ctx.accounts.action.kind,
    });
    Ok(())
}
