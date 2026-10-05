//! `set_token_metadata`: Metaplex token-metadata for the index mint (name / symbol / uri).
//!
//! The index mint's mint authority is the fund PDA, and `CreateMetadataAccountV3` requires the
//! mint authority to sign, so the program CPIs into mpl-token-metadata with the fund PDA as the
//! signer. The fund PDA is also the update authority, so later changes go through this same
//! instruction. Timelock: while `timelock_slots == 0` the authority calls it directly; once the
//! timelock is armed the change must be queued first (`ACTION_SET_TOKEN_METADATA`, whose `key`
//! commits to the payload hash) and this instruction then executes the due action.
//!
//! The two CPIs are hand-encoded (instruction discriminators 33 / 15 of mpl-token-metadata,
//! borsh `DataV2` with no creators / collection / uses) instead of pulling in the
//! `mpl-token-metadata` crate: the crate adds ~55 KB to the .so, which would force a
//! `solana program extend` on the live program for two instructions' worth of encoding.
use crate::errors::Fi6900Error;
use crate::events::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_interface::Mint;

/// mpl-token-metadata program (`metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`).
pub const TOKEN_METADATA_PROGRAM_ID: Pubkey = pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
pub const METADATA_SEED: &[u8] = b"metadata";
/// mpl-token-metadata `DataV2` limits (bytes).
pub const MAX_NAME_LENGTH: usize = 32;
pub const MAX_SYMBOL_LENGTH: usize = 10;
pub const MAX_URI_LENGTH: usize = 200;

const IX_CREATE_METADATA_ACCOUNT_V3: u8 = 33;
const IX_UPDATE_METADATA_ACCOUNT_V2: u8 = 15;

/// Anchor `Program<'info, TokenMetadata>` marker for the mpl-token-metadata program.
#[derive(Clone)]
pub struct TokenMetadata;

impl Id for TokenMetadata {
    fn id() -> Pubkey {
        TOKEN_METADATA_PROGRAM_ID
    }
}

/// Commitment to a metadata payload for the timelock queue: sha256 over the three strings, each
/// prefixed with its u32-LE byte length (mirrored by the SDK's `tokenMetadataHash`).
pub fn token_metadata_hash(name: &str, symbol: &str, uri: &str) -> Pubkey {
    let n = (name.len() as u32).to_le_bytes();
    let s = (symbol.len() as u32).to_le_bytes();
    let u = (uri.len() as u32).to_le_bytes();
    Pubkey::new_from_array(hashv(&[&n, name.as_bytes(), &s, symbol.as_bytes(), &u, uri.as_bytes()]).to_bytes())
}

/// borsh `DataV2 { name, symbol, uri, seller_fee_basis_points: 0, creators: None, collection: None, uses: None }`.
fn encode_data_v2(out: &mut Vec<u8>, name: &str, symbol: &str, uri: &str) -> Result<()> {
    name.to_string().serialize(out)?;
    symbol.to_string().serialize(out)?;
    uri.to_string().serialize(out)?;
    0u16.serialize(out)?; // seller_fee_basis_points
    out.extend_from_slice(&[0, 0, 0]); // creators / collection / uses = None
    Ok(())
}

#[derive(Accounts)]
pub struct SetTokenMetadata<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(has_one = authority @ Fi6900Error::Unauthorized, has_one = index_mint)]
    pub fund: Box<Account<'info, Fund>>,
    pub index_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: Metaplex metadata PDA ["metadata", mpl program, mint]; created or updated by the CPI.
    #[account(
        mut,
        seeds = [METADATA_SEED, token_metadata_program.key().as_ref(), index_mint.key().as_ref()],
        seeds::program = token_metadata_program.key(),
        bump,
    )]
    pub metadata: UncheckedAccount<'info>,
    /// Required while the timelock is armed: a due ACTION_SET_TOKEN_METADATA whose key is the payload hash.
    #[account(mut, has_one = fund)]
    pub action: Option<Box<Account<'info, PendingAction>>>,
    /// CHECK: receives the action rent; verified against action.proposer.
    #[account(mut)]
    pub proposer: Option<UncheckedAccount<'info>>,
    pub token_metadata_program: Program<'info, TokenMetadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn set_token_metadata(ctx: Context<SetTokenMetadata>, name: String, symbol: String, uri: String) -> Result<()> {
    require!(!name.is_empty() && name.len() <= MAX_NAME_LENGTH, Fi6900Error::InvalidArgument);
    require!(!symbol.is_empty() && symbol.len() <= MAX_SYMBOL_LENGTH, Fi6900Error::InvalidArgument);
    require!(uri.len() <= MAX_URI_LENGTH, Fi6900Error::InvalidArgument);

    let fund = &ctx.accounts.fund;
    // A queued action is mandatory while the timelock is armed; one passed at timelock 0 is still
    // validated and consumed (so a queued change can be executed after the lock was lowered).
    if fund.timelock_enabled() || ctx.accounts.action.is_some() {
        let action = ctx
            .accounts
            .action
            .as_ref()
            .ok_or_else(|| error!(Fi6900Error::TimelockRequired))?;
        require!(action.kind == ACTION_SET_TOKEN_METADATA, Fi6900Error::WrongActionKind);
        require!(Clock::get()?.slot >= action.eta_slot, Fi6900Error::TimelockNotElapsed);
        require!(
            action.key == token_metadata_hash(&name, &symbol, &uri),
            Fi6900Error::WrongActionTarget
        );
        let proposer = ctx
            .accounts
            .proposer
            .as_ref()
            .ok_or_else(|| error!(Fi6900Error::WrongActionTarget))?;
        require_keys_eq!(proposer.key(), action.proposer, Fi6900Error::WrongActionTarget);
        emit!(ActionExecuted {
            fund: fund.key(),
            action: action.key(),
            nonce: action.nonce,
            kind: action.kind,
            executor: ctx.accounts.authority.key(),
        });
        action.close(proposer.to_account_info())?;
    }

    let index_mint = fund.index_mint;
    let bump = fund.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[FUND_SEED, index_mint.as_ref(), &[bump]]];
    let program_id = ctx.accounts.token_metadata_program.key();
    let created = ctx.accounts.metadata.data_is_empty();

    let mut data = Vec::with_capacity(16 + name.len() + symbol.len() + uri.len());
    let (accounts, infos): (Vec<AccountMeta>, Vec<AccountInfo>) = if created {
        // CreateMetadataAccountV3 { data, is_mutable: true, collection_details: None }
        data.push(IX_CREATE_METADATA_ACCOUNT_V3);
        encode_data_v2(&mut data, &name, &symbol, &uri)?;
        data.push(1); // is_mutable
        data.push(0); // collection_details = None
        (
            vec![
                AccountMeta::new(ctx.accounts.metadata.key(), false),
                AccountMeta::new_readonly(ctx.accounts.index_mint.key(), false),
                AccountMeta::new_readonly(fund.key(), true), // mint_authority
                AccountMeta::new(ctx.accounts.authority.key(), true), // payer
                AccountMeta::new_readonly(fund.key(), true), // update_authority (signer)
                AccountMeta::new_readonly(ctx.accounts.system_program.key(), false),
                AccountMeta::new_readonly(ctx.accounts.rent.key(), false),
            ],
            vec![
                ctx.accounts.metadata.to_account_info(),
                ctx.accounts.index_mint.to_account_info(),
                fund.to_account_info(),
                ctx.accounts.authority.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
                ctx.accounts.rent.to_account_info(),
                ctx.accounts.token_metadata_program.to_account_info(),
            ],
        )
    } else {
        // UpdateMetadataAccountV2 { data: Some(..), new_update_authority: None, primary_sale_happened: None, is_mutable: None }
        data.push(IX_UPDATE_METADATA_ACCOUNT_V2);
        data.push(1); // data = Some
        encode_data_v2(&mut data, &name, &symbol, &uri)?;
        data.push(0); // new_update_authority = None
        data.push(0); // primary_sale_happened = None
        data.push(0); // is_mutable = None
        (
            vec![
                AccountMeta::new(ctx.accounts.metadata.key(), false),
                AccountMeta::new_readonly(fund.key(), true), // update_authority
            ],
            vec![
                ctx.accounts.metadata.to_account_info(),
                fund.to_account_info(),
                ctx.accounts.token_metadata_program.to_account_info(),
            ],
        )
    };
    invoke_signed(&Instruction { program_id, accounts, data }, &infos, signer_seeds)?;

    emit!(TokenMetadataSet {
        fund: fund.key(),
        index_mint,
        metadata: ctx.accounts.metadata.key(),
        name,
        symbol,
        uri,
        created,
    });
    Ok(())
}
