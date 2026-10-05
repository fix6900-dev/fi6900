//! FI6900 — an on-chain memecoin index fund.
//!
//! See ARCHITECTURE.md §2 for the account layouts and instruction semantics.

use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod state;

use instructions::*;

declare_id!("Cdzgsq1LMMkqA7t69t1K4NCNDy27ZNhPfFgMNcVvRnCV");

#[program]
pub mod fi6900 {
    use super::*;

    // ----- Admin / setup -------------------------------------------------

    pub fn initialize_fund(
        ctx: Context<InitializeFund>,
        mint_fee_bps: u16,
        redeem_fee_bps: u16,
        mgmt_fee_bps: u16,
        timelock_slots: u64,
    ) -> Result<()> {
        instructions::initialize_fund(ctx, mint_fee_bps, redeem_fee_bps, mgmt_fee_bps, timelock_slots)
    }

    /// Direct (timelock must be 0). Otherwise queue ACTION_ADD_ASSET.
    pub fn add_asset(ctx: Context<AddAsset>, target_weight_bps: u16) -> Result<()> {
        instructions::add_asset(ctx, target_weight_bps)
    }

    /// Direct (timelock must be 0). Otherwise queue ACTION_SET_TARGET_WEIGHT.
    pub fn set_target_weight(ctx: Context<AssetAdmin>, target_weight_bps: u16) -> Result<()> {
        instructions::set_target_weight(ctx, target_weight_bps)
    }

    /// Direct (timelock must be 0). Otherwise queue ACTION_SET_FEES.
    pub fn set_fees(
        ctx: Context<FundAdmin>,
        mint_fee_bps: u16,
        redeem_fee_bps: u16,
        mgmt_fee_bps: u16,
    ) -> Result<()> {
        instructions::set_fees(ctx, mint_fee_bps, redeem_fee_bps, mgmt_fee_bps)
    }

    /// Direct (timelock must be 0). Otherwise queue ACTION_SET_REBALANCER.
    pub fn set_rebalancer(ctx: Context<FundAdmin>, new_rebalancer: Pubkey) -> Result<()> {
        instructions::set_rebalancer(ctx, new_rebalancer)
    }

    /// Direct (timelock must be 0). Otherwise queue ACTION_SET_FEE_RECIPIENT.
    pub fn set_fee_recipient(ctx: Context<FundAdmin>, new_fee_recipient: Pubkey) -> Result<()> {
        instructions::set_fee_recipient(ctx, new_fee_recipient)
    }

    /// Protective; never timelocked.
    pub fn set_paused(ctx: Context<FundAdmin>, mask: u8) -> Result<()> {
        instructions::set_paused(ctx, mask)
    }

    /// Enables the timelock while it is 0. Changing it afterwards requires ACTION_SET_TIMELOCK.
    pub fn set_timelock(ctx: Context<FundAdmin>, timelock_slots: u64) -> Result<()> {
        instructions::set_timelock(ctx, timelock_slots)
    }

    /// Direct (timelock must be 0): max_auction_discount_bps, max_ref_move_bps, ref_move_period_slots.
    pub fn set_auction_params(
        ctx: Context<FundAdmin>,
        max_auction_discount_bps: u16,
        max_ref_move_bps: u16,
        ref_move_period_slots: u64,
    ) -> Result<()> {
        instructions::set_auction_params(ctx, max_auction_discount_bps, max_ref_move_bps, ref_move_period_slots)
    }

    /// Direct (timelock must be 0). Otherwise queue ACTION_BEGIN_REMOVE_ASSET.
    pub fn begin_remove_asset(ctx: Context<AssetAdmin>) -> Result<()> {
        instructions::begin_remove_asset(ctx)
    }

    pub fn finalize_remove_asset(ctx: Context<FinalizeRemoveAsset>) -> Result<()> {
        instructions::finalize_remove_asset(ctx)
    }

    pub fn propose_authority(ctx: Context<FundAdmin>, new_authority: Pubkey) -> Result<()> {
        instructions::propose_authority(ctx, new_authority)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::accept_authority(ctx)
    }

    pub fn bootstrap_mint<'info>(
        ctx: Context<'_, '_, 'info, 'info, BootstrapMint<'info>>,
        units: u64,
    ) -> Result<()> {
        instructions::bootstrap_mint(ctx, units)
    }

    // ----- Governance: reference prices + timelock -----------------------

    /// Rebalancer or authority. Q64.64 numeraire per raw base unit.
    pub fn set_ref_price(ctx: Context<SetRefPrice>, price: u128) -> Result<()> {
        instructions::set_ref_price(ctx, price)
    }

    /// Authority. Creates PendingAction ["pending", fund, action_nonce] with eta = now + timelock.
    pub fn queue_action(ctx: Context<QueueAction>, kind: u8, key: Pubkey, values: [u64; 4]) -> Result<()> {
        instructions::queue_action(ctx, kind, key, values)
    }

    /// Anyone, after eta. Every kind except ADD_ASSET.
    pub fn execute_action(ctx: Context<ExecuteAction>) -> Result<()> {
        instructions::execute_action(ctx)
    }

    /// Anyone, after eta. ADD_ASSET only (creates the Asset PDA and vault ATA).
    pub fn execute_action_add_asset(ctx: Context<ExecuteActionAddAsset>) -> Result<()> {
        instructions::execute_action_add_asset(ctx)
    }

    /// Authority.
    pub fn cancel_action(ctx: Context<CancelAction>) -> Result<()> {
        instructions::cancel_action(ctx)
    }

    // ----- Fees ----------------------------------------------------------

    pub fn accrue_management_fee(ctx: Context<AccrueManagementFee>) -> Result<()> {
        instructions::accrue_management_fee(ctx)
    }

    // ----- Creation (in-kind) -------------------------------------------

    pub fn begin_mint<'info>(
        ctx: Context<'_, '_, 'info, 'info, BeginMint<'info>>,
        units: u64,
        nonce: u64,
    ) -> Result<()> {
        instructions::begin_mint(ctx, units, nonce)
    }

    pub fn begin_mint_continue<'info>(
        ctx: Context<'_, '_, 'info, 'info, BeginMintContinue<'info>>,
    ) -> Result<()> {
        instructions::begin_mint_continue(ctx)
    }

    /// `gross_amount` defaults to `required[slot]`; Token-2022 fee mints need a gross whose net
    /// (after the transfer fee) is >= required, otherwise `ShortDeposit`.
    pub fn deposit(ctx: Context<MintSessionSlot>, slot: u16, gross_amount: Option<u64>) -> Result<()> {
        instructions::deposit(ctx, slot, gross_amount)
    }

    pub fn finalize_mint<'info>(
        ctx: Context<'_, '_, 'info, 'info, FinalizeMint<'info>>,
    ) -> Result<()> {
        instructions::finalize_mint(ctx)
    }

    pub fn cancel_mint_refund(ctx: Context<MintSessionSlot>, slot: u16) -> Result<()> {
        instructions::cancel_mint_refund(ctx, slot)
    }

    pub fn cancel_mint_close(ctx: Context<CancelMintClose>) -> Result<()> {
        instructions::cancel_mint_close(ctx)
    }

    // ----- Redemption (in-kind) -----------------------------------------

    pub fn begin_redeem<'info>(
        ctx: Context<'_, '_, 'info, 'info, BeginRedeem<'info>>,
        units: u64,
        nonce: u64,
    ) -> Result<()> {
        instructions::begin_redeem(ctx, units, nonce)
    }

    pub fn begin_redeem_continue<'info>(
        ctx: Context<'_, '_, 'info, 'info, BeginRedeemContinue<'info>>,
    ) -> Result<()> {
        instructions::begin_redeem_continue(ctx)
    }

    pub fn withdraw(ctx: Context<Withdraw>, slot: u16) -> Result<()> {
        instructions::withdraw(ctx, slot)
    }

    pub fn close_redeem(ctx: Context<CloseRedeem>) -> Result<()> {
        instructions::close_redeem(ctx)
    }

    // ----- Rebalancing (Dutch auctions) ---------------------------------

    pub fn start_auction(
        ctx: Context<StartAuction>,
        sell_amount: u64,
        start_price: u128,
        end_price: u128,
        duration_slots: u64,
    ) -> Result<()> {
        instructions::start_auction(ctx, sell_amount, start_price, end_price, duration_slots)
    }

    /// `gross_buy_amount` defaults to the price-implied buy amount; the buy vault must receive at
    /// least that much (`ShortFill` otherwise), so a fee on the buy token is paid by the filler.
    pub fn fill_auction(ctx: Context<FillAuction>, sell_amount: u64, gross_buy_amount: Option<u64>) -> Result<()> {
        instructions::fill_auction(ctx, sell_amount, gross_buy_amount)
    }

    pub fn cancel_auction(ctx: Context<CancelAuction>) -> Result<()> {
        instructions::cancel_auction(ctx)
    }
}
