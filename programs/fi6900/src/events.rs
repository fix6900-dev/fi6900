use anchor_lang::prelude::*;

#[event]
pub struct FundInitialized {
    pub fund: Pubkey,
    pub index_mint: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct AssetAdded {
    pub fund: Pubkey,
    pub asset: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub index: u16,
    pub target_weight_bps: u16,
}

#[event]
pub struct AssetRemoved {
    pub fund: Pubkey,
    pub asset: Pubkey,
    pub mint: Pubkey,
    pub index: u16,
}

#[event]
pub struct MintFinalized {
    pub fund: Pubkey,
    pub owner: Pubkey,
    pub units: u64,
    pub fee: u64,
}

#[event]
pub struct RedeemBegun {
    pub fund: Pubkey,
    pub owner: Pubkey,
    pub units: u64,
    pub fee: u64,
}

#[event]
pub struct AuctionStarted {
    pub fund: Pubkey,
    pub auction: Pubkey,
    pub sell_asset: Pubkey,
    pub buy_asset: Pubkey,
    pub sell_total: u64,
    pub start_price: u128,
    pub end_price: u128,
    pub start_slot: u64,
    pub end_slot: u64,
}

#[event]
pub struct AuctionFilled {
    pub fund: Pubkey,
    pub auction: Pubkey,
    pub filler: Pubkey,
    pub sell_amount: u64,
    pub buy_amount: u64,
    pub price: u128,
    pub epoch: u64,
}

#[event]
pub struct AuctionClosed {
    pub fund: Pubkey,
    pub auction: Pubkey,
    pub status: u8,
}

#[event]
pub struct FeesAccrued {
    pub fund: Pubkey,
    pub amount: u64,
    pub ts: i64,
}

#[event]
pub struct RefPriceSet {
    pub fund: Pubkey,
    pub asset: Pubkey,
    pub mint: Pubkey,
    pub old_price: u128,
    pub new_price: u128,
    pub signer: Pubkey,
    pub slot: u64,
}

#[event]
pub struct ActionQueued {
    pub fund: Pubkey,
    pub action: Pubkey,
    pub nonce: u64,
    pub kind: u8,
    pub key: Pubkey,
    pub values: [u64; 4],
    pub eta_slot: u64,
    pub proposer: Pubkey,
}

#[event]
pub struct ActionExecuted {
    pub fund: Pubkey,
    pub action: Pubkey,
    pub nonce: u64,
    pub kind: u8,
    pub executor: Pubkey,
}

#[event]
pub struct ActionCancelled {
    pub fund: Pubkey,
    pub action: Pubkey,
    pub nonce: u64,
    pub kind: u8,
}
