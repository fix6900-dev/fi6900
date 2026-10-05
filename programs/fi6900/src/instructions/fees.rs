use crate::errors::Fi6900Error;
use crate::events::FeesAccrued;
use crate::math::mgmt_fee_units;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface};

#[derive(Accounts)]
pub struct AccrueManagementFee<'info> {
    #[account(mut, has_one = index_mint)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(mut)]
    pub index_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        constraint = fee_recipient_ata.mint == fund.index_mint @ Fi6900Error::InvalidMint,
        constraint = fee_recipient_ata.owner == fund.fee_recipient @ Fi6900Error::Unauthorized,
    )]
    pub fee_recipient_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

/// Permissionless. Mints supply * mgmt_bps * dt / (10_000 * 31_557_600) to the
/// fee recipient and advances `last_fee_accrual_ts`. A no-op (but still
/// advances the timestamp) when the computed amount is zero.
pub fn accrue_management_fee(ctx: Context<AccrueManagementFee>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let fund = &mut ctx.accounts.fund;
    let dt = now.saturating_sub(fund.last_fee_accrual_ts);
    let amount = mgmt_fee_units(ctx.accounts.index_mint.supply, fund.mgmt_fee_bps, dt)?;

    if amount > 0 {
        let index_mint = fund.index_mint;
        let bump = fund.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[FUND_SEED, index_mint.as_ref(), &[bump]]];
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
            amount,
        )?;
    }

    // Only advance the clock when something was minted or supply is zero, so
    // sub-threshold calls do not silently forfeit fee time.
    if amount > 0 || ctx.accounts.index_mint.supply == 0 || fund.mgmt_fee_bps == 0 {
        fund.last_fee_accrual_ts = now;
    }

    emit!(FeesAccrued {
        fund: fund.key(),
        amount,
        ts: now,
    });
    Ok(())
}
