pub mod admin;
pub mod auction;
pub mod fees;
pub mod governance;
pub mod metadata;
pub mod mint;
pub mod redeem;

pub use admin::*;
pub use auction::*;
pub use fees::*;
pub use governance::*;
pub use metadata::*;
pub use mint::*;
pub use redeem::*;

use crate::errors::Fi6900Error;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

/// Iterate active slots in index order starting at `from`.
pub fn active_slots_from(bitmap: &Bitmap, from: u16) -> impl Iterator<Item = u16> + '_ {
    let mut cur = from;
    core::iter::from_fn(move || {
        let s = bitmap_next_set(bitmap, cur)?;
        cur = s + 1;
        Some(s)
    })
}

/// Iterate every active slot in index order.
pub fn active_slots(bitmap: &Bitmap) -> impl Iterator<Item = u16> + '_ {
    active_slots_from(bitmap, 0)
}

/// Deserialize and fully verify an `Asset` passed via remaining_accounts:
/// owned by this program, belongs to `fund`, sits in `slot`, and its key is
/// the canonical PDA ["asset", fund, mint, bump].
pub fn load_asset_checked(info: &AccountInfo, fund: &Pubkey, slot: u16) -> Result<Asset> {
    require_keys_eq!(*info.owner, crate::ID, Fi6900Error::WrongRemainingAccounts);
    let data = info.try_borrow_data()?;
    let asset = Asset::try_deserialize(&mut &data[..])
        .map_err(|_| error!(Fi6900Error::WrongRemainingAccounts))?;
    require!(asset.fund == *fund, Fi6900Error::WrongRemainingAccounts);
    require!(asset.index == slot, Fi6900Error::WrongRemainingAccounts);
    let expected = Pubkey::create_program_address(
        &[ASSET_SEED, fund.as_ref(), asset.mint.as_ref(), &[asset.bump]],
        &crate::ID,
    )
    .map_err(|_| error!(Fi6900Error::WrongRemainingAccounts))?;
    require_keys_eq!(info.key(), expected, Fi6900Error::WrongRemainingAccounts);
    Ok(asset)
}

/// Persist a mutated `Asset` back into its account.
pub fn store_asset(info: &AccountInfo, asset: &Asset) -> Result<()> {
    require!(info.is_writable, Fi6900Error::WrongRemainingAccounts);
    let mut data = info.try_borrow_mut_data()?;
    let mut cursor: &mut [u8] = &mut data[..];
    asset.try_serialize(&mut cursor)
}

/// Read `amount` from the vault account after checking it is `asset.vault`.
pub fn read_vault_amount(info: &AccountInfo, asset: &Asset) -> Result<u64> {
    require_keys_eq!(info.key(), asset.vault, Fi6900Error::WrongRemainingAccounts);
    let data = info.try_borrow_data()?;
    let acct = TokenAccount::try_deserialize(&mut &data[..])
        .map_err(|_| error!(Fi6900Error::WrongRemainingAccounts))?;
    Ok(acct.amount)
}

pub type AssetVaultPair<'a, 'info> = (u16, &'a AccountInfo<'info>, Asset, u64);

/// Pull `[Asset, vault]` pairs for consecutive active slots starting at `from`
/// from remaining accounts (a chunk). Consumes every remaining account; errors
/// if the count is odd, zero, or exceeds the active slots left. Returns the
/// pairs in index order and the slot after the last one processed.
pub fn collect_asset_vault_chunk<'a, 'info>(
    remaining: &'a [AccountInfo<'info>],
    fund: &Pubkey,
    bitmap: &Bitmap,
    from: u16,
) -> Result<(Vec<AssetVaultPair<'a, 'info>>, u16)> {
    require!(
        remaining.len() >= 2 && remaining.len() % 2 == 0,
        Fi6900Error::WrongRemainingAccounts
    );
    let mut out = Vec::with_capacity(remaining.len() / 2);
    let mut slots = active_slots_from(bitmap, from);
    let mut next = from;
    for pair in remaining.chunks(2) {
        let slot = slots
            .next()
            .ok_or_else(|| error!(Fi6900Error::WrongRemainingAccounts))?;
        let asset = load_asset_checked(&pair[0], fund, slot)?;
        let amount = read_vault_amount(&pair[1], &asset)?;
        out.push((slot, &pair[0], asset, amount));
        next = slot + 1;
    }
    Ok((out, next))
}

/// `[Asset, vault]` pairs for EVERY active slot (single-transaction paths).
pub fn collect_asset_vault_pairs<'a, 'info>(
    remaining: &'a [AccountInfo<'info>],
    fund: &Pubkey,
    bitmap: &Bitmap,
) -> Result<Vec<AssetVaultPair<'a, 'info>>> {
    let (pairs, next) = collect_asset_vault_chunk(remaining, fund, bitmap, 0)?;
    require!(
        bitmap_next_set(bitmap, next).is_none(),
        Fi6900Error::WrongRemainingAccounts
    );
    Ok(pairs)
}

/// True when no active slot remains at or after `next`.
pub fn chunk_complete(bitmap: &Bitmap, next: u16) -> bool {
    bitmap_next_set(bitmap, next).is_none()
}
