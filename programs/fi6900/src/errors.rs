use anchor_lang::prelude::*;

#[error_code]
pub enum Fi6900Error {
    #[msg("Operation is paused")]
    Paused,
    #[msg("Cannot begin mint while auctions are open")]
    AuctionsOpen,
    #[msg("Fund epoch changed since session began")]
    StaleEpoch,
    #[msg("Not every active slot has been deposited")]
    IncompleteDeposits,
    #[msg("Not every entitled slot has been withdrawn")]
    IncompleteWithdrawals,
    #[msg("Remaining accounts do not match the fund's active slots")]
    WrongRemainingAccounts,
    #[msg("Slot is not active")]
    SlotNotActive,
    #[msg("Slot already deposited")]
    AlreadyDeposited,
    #[msg("Auction is not open")]
    AuctionNotOpen,
    #[msg("Auction has ended")]
    AuctionEnded,
    #[msg("Auction has not ended")]
    AuctionNotEnded,
    #[msg("Amount exceeds remaining")]
    ExceedsRemaining,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Index supply is zero")]
    SupplyZero,
    #[msg("Index supply must be zero")]
    SupplyNotZero,
    #[msg("Maximum number of assets reached")]
    MaxAssets,
    #[msg("Asset vault is not empty or has pending balances")]
    AssetNotEmpty,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Math overflow")]
    MathOverflow,
    // --- additions beyond the spec list ---
    #[msg("Invalid mint")]
    InvalidMint,
    #[msg("Invalid argument")]
    InvalidArgument,
    #[msg("Vault is empty")]
    EmptyVault,
    #[msg("Insufficient effective vault balance")]
    InsufficientBalance,
    #[msg("Slot already withdrawn")]
    AlreadyWithdrawn,
    #[msg("Asset is not in the expected status")]
    WrongAssetStatus,
    // --- 512 slots / chunked begin ---
    #[msg("Session is not ready (begin chunks incomplete)")]
    SessionNotReady,
    #[msg("Session is already ready")]
    SessionAlreadyReady,
    // --- auction price bounds ---
    #[msg("Reference price not set for an auction asset")]
    RefPriceUnset,
    #[msg("Reference price move exceeds max_ref_move_bps for this period")]
    RefPriceMoveTooLarge,
    #[msg("Auction end price is below the reference-price bound")]
    PriceBelowBound,
    // --- admin timelock ---
    #[msg("Timelock is enabled; queue this change with queue_action")]
    TimelockRequired,
    #[msg("Pending action eta has not elapsed")]
    TimelockNotElapsed,
    #[msg("Unknown pending action kind")]
    InvalidActionKind,
    #[msg("Pending action kind does not match this instruction")]
    WrongActionKind,
    #[msg("Account does not match the pending action payload")]
    WrongActionTarget,
    // --- Token-2022 fee-on-transfer constituents ---
    #[msg("Vault received less than the required deposit (transfer fee?); send a larger gross_amount")]
    ShortDeposit,
    #[msg("Buy vault received less than the auction price (transfer fee?); send a larger gross_buy_amount")]
    ShortFill,
}
