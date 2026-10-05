use anchor_lang::prelude::*;

/// 512 constituent slots, bitmap-indexed as `[u64; 8]`.
pub const MAX_ASSETS: usize = 512;
pub const BITMAP_WORDS: usize = MAX_ASSETS / 64;

pub type Bitmap = [u64; BITMAP_WORDS];

pub const FUND_SEED: &[u8] = b"fund";
pub const ASSET_SEED: &[u8] = b"asset";
pub const MINT_SESSION_SEED: &[u8] = b"mint_session";
pub const REDEEM_SESSION_SEED: &[u8] = b"redeem_session";
pub const AUCTION_SEED: &[u8] = b"auction";
pub const PENDING_SEED: &[u8] = b"pending";

pub const PAUSE_MINT: u8 = 1 << 0;
pub const PAUSE_REDEEM: u8 = 1 << 1;
pub const PAUSE_AUCTIONS: u8 = 1 << 2;

pub const ASSET_STATUS_ACTIVE: u8 = 0;
pub const ASSET_STATUS_REMOVING: u8 = 1;

pub const AUCTION_STATUS_OPEN: u8 = 0;
pub const AUCTION_STATUS_FILLED: u8 = 1;
pub const AUCTION_STATUS_CANCELLED: u8 = 2;
pub const AUCTION_STATUS_EXPIRED: u8 = 3;

pub const BPS_DENOMINATOR: u128 = 10_000;
pub const SECONDS_PER_YEAR: u128 = 31_557_600;
pub const MAX_FEE_BPS: u16 = 1_000; // 10% hard cap on any single fee
pub const INDEX_DECIMALS: u8 = 6;

/// Governance defaults (initialize_fund).
pub const DEFAULT_MAX_AUCTION_DISCOUNT_BPS: u16 = 500;
pub const DEFAULT_MAX_REF_MOVE_BPS: u16 = 2_000;
pub const DEFAULT_REF_MOVE_PERIOD_SLOTS: u64 = 216_000; // ~1 day
pub const MAX_AUCTION_DISCOUNT_CAP_BPS: u16 = 5_000; // the bound itself can never exceed 50%

/// Pending action kinds (PendingAction.kind).
pub const ACTION_SET_FEES: u8 = 0; // values[0..3] = mint, redeem, mgmt bps
pub const ACTION_SET_TARGET_WEIGHT: u8 = 1; // key = mint, values[0] = bps
pub const ACTION_SET_REBALANCER: u8 = 2; // key = new rebalancer
pub const ACTION_SET_FEE_RECIPIENT: u8 = 3; // key = new fee recipient
pub const ACTION_REF_PRICE_OVERRIDE: u8 = 4; // key = mint, values[0] = lo64, values[1] = hi64 of the Q64.64 price
pub const ACTION_SET_MAX_AUCTION_DISCOUNT: u8 = 5; // values[0] = bps
pub const ACTION_SET_TIMELOCK: u8 = 6; // values[0] = slots
pub const ACTION_ADD_ASSET: u8 = 7; // key = mint, values[0] = target weight bps
pub const ACTION_BEGIN_REMOVE_ASSET: u8 = 8; // key = mint
pub const ACTION_SET_REF_MOVE_POLICY: u8 = 9; // values[0] = max_ref_move_bps, values[1] = ref_move_period_slots
pub const ACTION_SET_TOKEN_METADATA: u8 = 10; // key = token_metadata_hash(name, symbol, uri); executed by set_token_metadata
pub const ACTION_KIND_COUNT: u8 = 11;

// ---------------------------------------------------------------------------
// Bitmap helpers
// ---------------------------------------------------------------------------

#[inline]
pub fn bitmap_get(b: &Bitmap, slot: u16) -> bool {
    let s = slot as usize;
    s < MAX_ASSETS && b[s / 64] & (1u64 << (s % 64)) != 0
}

#[inline]
pub fn bitmap_set(b: &mut Bitmap, slot: u16) {
    let s = slot as usize;
    b[s / 64] |= 1u64 << (s % 64);
}

#[inline]
pub fn bitmap_clear(b: &mut Bitmap, slot: u16) {
    let s = slot as usize;
    b[s / 64] &= !(1u64 << (s % 64));
}

#[inline]
pub fn bitmap_is_empty(b: &Bitmap) -> bool {
    b.iter().all(|w| *w == 0)
}

#[inline]
pub fn bitmap_count(b: &Bitmap) -> u32 {
    b.iter().map(|w| w.count_ones()).sum()
}

/// Lowest set slot >= `from`, if any.
pub fn bitmap_next_set(b: &Bitmap, from: u16) -> Option<u16> {
    let mut s = from as usize;
    while s < MAX_ASSETS {
        let w = b[s / 64] >> (s % 64);
        if w == 0 {
            s = (s / 64 + 1) * 64;
            continue;
        }
        return Some((s + w.trailing_zeros() as usize) as u16);
    }
    None
}

/// The fund. PDA: ["fund", index_mint].
#[account]
#[derive(InitSpace)]
pub struct Fund {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub rebalancer: Pubkey,
    pub fee_recipient: Pubkey,
    pub index_mint: Pubkey,
    pub bump: u8,
    pub asset_count: u16,
    /// bit i set if asset slot i is Active (participates in mint/redeem).
    pub active_bitmap: [u64; 8],
    pub mint_fee_bps: u16,
    pub redeem_fee_bps: u16,
    pub mgmt_fee_bps: u16,
    pub last_fee_accrual_ts: i64,
    /// Increments on every auction fill; invalidates open mint sessions.
    pub epoch: u64,
    pub open_auctions: u16,
    /// bit0 = mint paused, bit1 = redeem paused, bit2 = auctions paused.
    pub paused: u8,
    pub auction_nonce: u64,
    /// bit i set if asset slot i is occupied by an Asset account (Active or Removing).
    pub occupied_bitmap: [u64; 8],
    /// Auction `end_price` may not be more than this far below the ref-price fair value.
    pub max_auction_discount_bps: u16,
    /// Rebalancer ref-price updates may move at most this far from the period anchor.
    pub max_ref_move_bps: u16,
    /// Length of the ref-price move window in slots.
    pub ref_move_period_slots: u64,
    /// Admin timelock in slots (0 = direct admin ixs allowed; localnet/tests).
    pub timelock_slots: u64,
    /// Next PendingAction nonce.
    pub action_nonce: u64,
    pub reserved: [u8; 64],
}

impl Fund {
    pub fn is_paused(&self, mask: u8) -> bool {
        self.paused & mask != 0
    }

    pub fn is_active(&self, slot: u16) -> bool {
        bitmap_get(&self.active_bitmap, slot)
    }

    pub fn next_free_slot(&self) -> Option<u16> {
        (0..MAX_ASSETS as u16).find(|i| !bitmap_get(&self.occupied_bitmap, *i))
    }

    pub fn timelock_enabled(&self) -> bool {
        self.timelock_slots > 0
    }
}

/// A constituent. PDA: ["asset", fund, mint].
#[account]
#[derive(InitSpace)]
pub struct Asset {
    pub fund: Pubkey,
    pub mint: Pubkey,
    /// ATA(fund PDA, mint)
    pub vault: Pubkey,
    pub token_program: Pubkey,
    /// slot 0..511
    pub index: u16,
    /// 0 = Active, 1 = Removing
    pub status: u8,
    pub decimals: u8,
    pub target_weight_bps: u16,
    /// tokens sitting in vault from unfinalized mint sessions (excluded from NAV).
    /// Credited with the amount the vault actually received (balance delta), so it can never
    /// exceed `vault.amount` even for Token-2022 fee-on-transfer mints.
    pub pending_deposits: u64,
    /// tokens reserved by open redeem sessions (excluded from NAV)
    pub pending_withdrawals: u64,
    /// PDA bump, lets begin_mint/redeem verify Asset PDAs with create_program_address
    pub bump: u8,
    /// Reference price, Q64.64, fund numeraire per raw base unit of the token
    /// (off-chain convention: numeraire = 1e-9 USD). 0 = unset (auctions on this asset are blocked).
    pub ref_price: u128,
    pub ref_price_updated_slot: u64,
    /// ref_price at the start of the current move window; the move cap is measured against it.
    pub ref_price_anchor: u128,
    pub ref_price_anchor_slot: u64,
    pub reserved: [u8; 32],
}

impl Asset {
    /// vault.amount - pending_deposits - pending_withdrawals
    ///
    /// Invariant: never underflows. `pending_deposits` is credited with received amounts (balance
    /// delta), and every vault debit (withdraw, refund, auction sell) is exact on the source side,
    /// so `vault.amount >= pending_deposits + pending_withdrawals` holds for fee-on-transfer mints too.
    pub fn effective_balance(&self, vault_amount: u64) -> Result<u64> {
        vault_amount
            .checked_sub(self.pending_deposits)
            .and_then(|v| v.checked_sub(self.pending_withdrawals))
            .ok_or_else(|| error!(crate::errors::Fi6900Error::MathOverflow))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(pending_deposits: u64, pending_withdrawals: u64) -> Asset {
        Asset {
            fund: Pubkey::default(),
            mint: Pubkey::default(),
            vault: Pubkey::default(),
            token_program: Pubkey::default(),
            index: 0,
            status: ASSET_STATUS_ACTIVE,
            decimals: 6,
            target_weight_bps: 0,
            pending_deposits,
            pending_withdrawals,
            bump: 0,
            ref_price: 0,
            ref_price_updated_slot: 0,
            ref_price_anchor: 0,
            ref_price_anchor_slot: 0,
            reserved: [0u8; 32],
        }
    }

    #[test]
    fn effective_balance_subtracts_both_reservations() {
        assert_eq!(asset(30, 20).effective_balance(100).unwrap(), 50);
        assert_eq!(asset(50, 50).effective_balance(100).unwrap(), 0);
    }

    #[test]
    fn effective_balance_refuses_to_underflow() {
        // A fee mint that credited the instructed (gross) amount instead of the received one
        // would end up here; the delta-based credit makes this unreachable.
        assert!(asset(70, 40).effective_balance(100).is_err());
        assert!(asset(101, 0).effective_balance(100).is_err());
    }

    #[test]
    fn session_layouts_are_unchanged() {
        // Layout compatibility with the deployed program (ARCHITECTURE.md section 2).
        assert_eq!(MintSession::LEN, 4264);
        assert_eq!(RedeemSession::LEN, 4256);
    }
}

/// In-kind creation session. PDA: ["mint_session", fund, owner, nonce_le].
/// Zero-copy (4.2 KB): `required` has one u64 per slot.
#[account(zero_copy)]
pub struct MintSession {
    pub fund: Pubkey,
    pub owner: Pubkey,
    pub nonce: u64,
    /// index units requested (gross, before fee)
    pub units: u64,
    /// fund.epoch at begin; finalize requires equality
    pub epoch: u64,
    pub created_slot: u64,
    /// Chunked begin: the next active slot to compute `required` for. Slots below are done.
    pub next_slot: u16,
    /// 1 once every active slot has been computed (gates deposit / finalize).
    pub ready: u8,
    pub _pad: [u8; 5],
    pub deposited_bitmap: Bitmap,
    /// per-slot required deposit, computed at begin (possibly over several chunks).
    /// `deposit` overwrites the slot with the amount the vault actually received (>= required),
    /// which is what `finalize_mint` / `cancel_mint_refund` release from `pending_deposits`.
    pub required: [u64; MAX_ASSETS],
}

impl MintSession {
    pub const LEN: usize = core::mem::size_of::<MintSession>();
}

/// In-kind redemption session. PDA: ["redeem_session", fund, owner, nonce_le].
#[account(zero_copy)]
pub struct RedeemSession {
    pub fund: Pubkey,
    pub owner: Pubkey,
    pub nonce: u64,
    /// net units burned
    pub units: u64,
    pub created_slot: u64,
    pub next_slot: u16,
    pub ready: u8,
    pub _pad: [u8; 5],
    pub withdrawn_bitmap: Bitmap,
    /// per-slot amount owed, computed & reserved at begin (possibly over several chunks)
    pub entitled: [u64; MAX_ASSETS],
}

impl RedeemSession {
    pub const LEN: usize = core::mem::size_of::<RedeemSession>();

    /// Every slot with a non-zero entitlement has been withdrawn.
    pub fn is_complete(&self) -> bool {
        self.entitled
            .iter()
            .enumerate()
            .all(|(i, e)| *e == 0 || bitmap_get(&self.withdrawn_bitmap, i as u16))
    }
}

/// Dutch auction. PDA: ["auction", fund, auction_nonce_le].
#[account]
#[derive(InitSpace)]
pub struct Auction {
    pub fund: Pubkey,
    /// Asset PDA being sold from vault
    pub sell_asset: Pubkey,
    /// Asset PDA being bought into vault
    pub buy_asset: Pubkey,
    pub sell_remaining: u64,
    pub sell_total: u64,
    /// buy_token per sell_token, Q64.64 — decays linearly to end_price
    pub start_price: u128,
    pub end_price: u128,
    pub start_slot: u64,
    pub end_slot: u64,
    pub bought_total: u64,
    /// 0 open, 1 filled, 2 cancelled, 3 expired
    pub status: u8,
    /// fund.auction_nonce at creation (seed). Appended to the spec layout.
    pub nonce: u64,
}

/// Timelocked admin action. PDA: ["pending", fund, nonce_le].
#[account]
#[derive(InitSpace)]
pub struct PendingAction {
    pub fund: Pubkey,
    pub nonce: u64,
    pub kind: u8,
    pub proposer: Pubkey,
    pub queued_slot: u64,
    pub eta_slot: u64,
    /// Pubkey payload (asset mint / new rebalancer / new fee recipient), kind-dependent.
    pub key: Pubkey,
    /// Numeric payload, kind-dependent (see ACTION_* docs).
    pub values: [u64; 4],
    pub bump: u8,
}

impl PendingAction {
    pub fn ref_price(&self) -> u128 {
        (self.values[0] as u128) | ((self.values[1] as u128) << 64)
    }
}
