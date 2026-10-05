use crate::errors::Fi6900Error;
use crate::events::{AuctionClosed, AuctionFilled, AuctionStarted};
use crate::math::{buy_amount_for, linear_price, min_end_price, ratio_q64};
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

// ---------------------------------------------------------------------------
// start_auction
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct StartAuction<'info> {
    #[account(mut)]
    pub rebalancer: Signer<'info>,
    #[account(mut, has_one = rebalancer @ Fi6900Error::Unauthorized)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(has_one = fund, has_one = vault @ Fi6900Error::WrongRemainingAccounts)]
    pub sell_asset: Box<Account<'info, Asset>>,
    #[account(
        has_one = fund,
        constraint = buy_asset.status == ASSET_STATUS_ACTIVE @ Fi6900Error::WrongAssetStatus,
        constraint = buy_asset.key() != sell_asset.key() @ Fi6900Error::InvalidArgument,
    )]
    pub buy_asset: Box<Account<'info, Asset>>,
    /// The sell asset's vault (checked against sell_asset.vault via has_one).
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = rebalancer,
        space = 8 + Auction::INIT_SPACE,
        seeds = [AUCTION_SEED, fund.key().as_ref(), &fund.auction_nonce.to_le_bytes()],
        bump
    )]
    pub auction: Box<Account<'info, Auction>>,
    pub system_program: Program<'info, System>,
}

pub fn start_auction(
    ctx: Context<StartAuction>,
    sell_amount: u64,
    start_price: u128,
    end_price: u128,
    duration_slots: u64,
) -> Result<()> {
    let fund = &mut ctx.accounts.fund;
    require!(!fund.is_paused(PAUSE_AUCTIONS), Fi6900Error::Paused);
    require!(sell_amount > 0, Fi6900Error::ZeroAmount);
    require!(duration_slots > 0, Fi6900Error::InvalidArgument);
    require!(end_price > 0 && start_price >= end_price, Fi6900Error::InvalidArgument);

    let effective = ctx
        .accounts
        .sell_asset
        .effective_balance(ctx.accounts.vault.amount)?;
    require!(sell_amount <= effective, Fi6900Error::InsufficientBalance);

    // Price bound: end_price >= (ref_sell / ref_buy) * (1 - max_auction_discount_bps).
    // Both ref prices are Q64.64 numeraire-per-raw-unit, so their ratio is buy-raw per sell-raw.
    let ref_sell = ctx.accounts.sell_asset.ref_price;
    let ref_buy = ctx.accounts.buy_asset.ref_price;
    require!(ref_sell > 0 && ref_buy > 0, Fi6900Error::RefPriceUnset);
    let fair = ratio_q64(ref_sell, ref_buy)?;
    let min_end = min_end_price(fair, fund.max_auction_discount_bps)?;
    require!(end_price >= min_end, Fi6900Error::PriceBelowBound);

    let slot = Clock::get()?.slot;
    let nonce = fund.auction_nonce;
    fund.auction_nonce = nonce.checked_add(1).ok_or(Fi6900Error::MathOverflow)?;
    fund.open_auctions = fund
        .open_auctions
        .checked_add(1)
        .ok_or(Fi6900Error::MathOverflow)?;

    let auction = &mut ctx.accounts.auction;
    auction.fund = fund.key();
    auction.sell_asset = ctx.accounts.sell_asset.key();
    auction.buy_asset = ctx.accounts.buy_asset.key();
    auction.sell_remaining = sell_amount;
    auction.sell_total = sell_amount;
    auction.start_price = start_price;
    auction.end_price = end_price;
    auction.start_slot = slot;
    auction.end_slot = slot
        .checked_add(duration_slots)
        .ok_or(Fi6900Error::MathOverflow)?;
    auction.bought_total = 0;
    auction.status = AUCTION_STATUS_OPEN;
    auction.nonce = nonce;

    emit!(AuctionStarted {
        fund: fund.key(),
        auction: auction.key(),
        sell_asset: auction.sell_asset,
        buy_asset: auction.buy_asset,
        sell_total: sell_amount,
        start_price,
        end_price,
        start_slot: auction.start_slot,
        end_slot: auction.end_slot,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// fill_auction
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct FillAuction<'info> {
    pub filler: Signer<'info>,
    #[account(mut)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(
        mut,
        has_one = fund,
        has_one = sell_asset,
        has_one = buy_asset,
    )]
    pub auction: Box<Account<'info, Auction>>,
    #[account(has_one = fund)]
    pub sell_asset: Box<Account<'info, Asset>>,
    #[account(has_one = fund)]
    pub buy_asset: Box<Account<'info, Asset>>,
    #[account(mut, address = sell_asset.vault @ Fi6900Error::WrongRemainingAccounts)]
    pub sell_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = buy_asset.vault @ Fi6900Error::WrongRemainingAccounts)]
    pub buy_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Filler's account that receives the sold tokens.
    #[account(mut, constraint = filler_sell_token.mint == sell_asset.mint @ Fi6900Error::InvalidMint)]
    pub filler_sell_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Filler's account that pays the bought tokens (filler must be its authority).
    #[account(mut, constraint = filler_buy_token.mint == buy_asset.mint @ Fi6900Error::InvalidMint)]
    pub filler_buy_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = sell_asset.mint @ Fi6900Error::InvalidMint)]
    pub sell_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = buy_asset.mint @ Fi6900Error::InvalidMint)]
    pub buy_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(address = sell_asset.token_program)]
    pub sell_token_program: Interface<'info, TokenInterface>,
    #[account(address = buy_asset.token_program)]
    pub buy_token_program: Interface<'info, TokenInterface>,
}

/// `gross_buy_amount` (default = the price-implied `buy_amount`) is what the filler sends; the
/// vault must RECEIVE at least `buy_amount` (balance delta), otherwise `ShortFill`. A Token-2022
/// transfer fee on the buy token is therefore borne by the filler (SDK: `grossForNet`); any excess
/// stays in the vault. The sell leg is unchanged: the vault is debited exactly `sell_amount` and a
/// fee on the sell token is withheld from what the filler receives.
pub fn fill_auction(ctx: Context<FillAuction>, sell_amount: u64, gross_buy_amount: Option<u64>) -> Result<()> {
    let fund = &mut ctx.accounts.fund;
    let auction = &mut ctx.accounts.auction;
    require!(!fund.is_paused(PAUSE_AUCTIONS), Fi6900Error::Paused);
    require!(auction.status == AUCTION_STATUS_OPEN, Fi6900Error::AuctionNotOpen);
    require!(sell_amount > 0, Fi6900Error::ZeroAmount);
    require!(sell_amount <= auction.sell_remaining, Fi6900Error::ExceedsRemaining);

    let slot = Clock::get()?.slot;
    require!(slot <= auction.end_slot, Fi6900Error::AuctionEnded);
    let elapsed = slot.saturating_sub(auction.start_slot);
    let duration = auction
        .end_slot
        .checked_sub(auction.start_slot)
        .ok_or(Fi6900Error::MathOverflow)?;
    let price = linear_price(auction.start_price, auction.end_price, elapsed, duration)?;
    let buy_amount = buy_amount_for(sell_amount, price)?;
    require!(buy_amount > 0, Fi6900Error::ZeroAmount);

    // Never dip into balances reserved for open mint/redeem sessions.
    let effective = ctx
        .accounts
        .sell_asset
        .effective_balance(ctx.accounts.sell_vault.amount)?;
    require!(sell_amount <= effective, Fi6900Error::InsufficientBalance);

    // Filler pays buy_token into the buy vault; credit what actually arrived.
    let gross_buy = gross_buy_amount.unwrap_or(buy_amount);
    require!(gross_buy >= buy_amount, Fi6900Error::ShortFill);
    let buy_before = ctx.accounts.buy_vault.amount;
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.buy_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.filler_buy_token.to_account_info(),
                mint: ctx.accounts.buy_mint.to_account_info(),
                to: ctx.accounts.buy_vault.to_account_info(),
                authority: ctx.accounts.filler.to_account_info(),
            },
        ),
        gross_buy,
        ctx.accounts.buy_mint.decimals,
    )?;
    ctx.accounts.buy_vault.reload()?;
    let received = ctx
        .accounts
        .buy_vault
        .amount
        .checked_sub(buy_before)
        .ok_or(Fi6900Error::MathOverflow)?;
    require!(received >= buy_amount, Fi6900Error::ShortFill);

    // Vault pays sell_token to the filler.
    let index_mint = fund.index_mint;
    let bump = fund.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[FUND_SEED, index_mint.as_ref(), &[bump]]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.sell_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.sell_vault.to_account_info(),
                mint: ctx.accounts.sell_mint.to_account_info(),
                to: ctx.accounts.filler_sell_token.to_account_info(),
                authority: fund.to_account_info(),
            },
            signer_seeds,
        ),
        sell_amount,
        ctx.accounts.sell_mint.decimals,
    )?;

    auction.sell_remaining = auction
        .sell_remaining
        .checked_sub(sell_amount)
        .ok_or(Fi6900Error::MathOverflow)?;
    auction.bought_total = auction
        .bought_total
        .checked_add(received)
        .ok_or(Fi6900Error::MathOverflow)?;
    fund.epoch = fund.epoch.checked_add(1).ok_or(Fi6900Error::MathOverflow)?;

    emit!(AuctionFilled {
        fund: fund.key(),
        auction: auction.key(),
        filler: ctx.accounts.filler.key(),
        sell_amount,
        buy_amount: received,
        price,
        epoch: fund.epoch,
    });

    if auction.sell_remaining == 0 {
        auction.status = AUCTION_STATUS_FILLED;
        fund.open_auctions = fund
            .open_auctions
            .checked_sub(1)
            .ok_or(Fi6900Error::MathOverflow)?;
        emit!(AuctionClosed {
            fund: fund.key(),
            auction: auction.key(),
            status: AUCTION_STATUS_FILLED,
        });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// cancel_auction
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CancelAuction<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub fund: Box<Account<'info, Fund>>,
    #[account(mut, has_one = fund)]
    pub auction: Box<Account<'info, Auction>>,
}

/// Rebalancer may cancel at any time; anyone may expire it after end_slot.
pub fn cancel_auction(ctx: Context<CancelAuction>) -> Result<()> {
    let fund = &mut ctx.accounts.fund;
    let auction = &mut ctx.accounts.auction;
    require!(auction.status == AUCTION_STATUS_OPEN, Fi6900Error::AuctionNotOpen);

    let status = if ctx.accounts.signer.key() == fund.rebalancer {
        AUCTION_STATUS_CANCELLED
    } else {
        let slot = Clock::get()?.slot;
        require!(slot > auction.end_slot, Fi6900Error::AuctionNotEnded);
        AUCTION_STATUS_EXPIRED
    };

    auction.status = status;
    fund.open_auctions = fund
        .open_auctions
        .checked_sub(1)
        .ok_or(Fi6900Error::MathOverflow)?;

    emit!(AuctionClosed {
        fund: fund.key(),
        auction: auction.key(),
        status,
    });
    Ok(())
}
