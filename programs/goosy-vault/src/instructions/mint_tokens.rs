use crate::state::Vault;
use anchor_lang::prelude::*;
use anchor_spl::token;
use anchor_spl::token::{Mint, MintTo, Token, TokenAccount};

#[derive(Accounts)]
pub struct MintTokensTo<'info> {
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub destination_vault_spl_token_account: Account<'info, TokenAccount>,
    #[account()]
    admin_vault: Account<'info, Vault>,
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub fee_payer: Signer<'info>,
}

pub fn mint_tokens_to(ctx: Context<MintTokensTo>, amount: u64) -> Result<()> {
    let seeds = &[b"admin-vault".as_ref(), &[ctx.accounts.admin_vault.bump]];
    let signer_seeds = &[&seeds[..]];

    let cpi_program = ctx.accounts.token_program.to_account_info();

    // Log pre-transfer balances
    msg!(
        "Destination vault balance before transfer: {}",
        ctx.accounts.destination_vault_spl_token_account.amount
    );

    let cpi_accounts = MintTo {
        mint: ctx.accounts.mint.to_account_info(),
        to: ctx
            .accounts
            .destination_vault_spl_token_account
            .to_account_info(),
        authority: ctx.accounts.admin_vault.to_account_info(),
    };

    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

    token::mint_to(cpi_ctx, amount)?;

    // Fetch updated accounts post transfer
    ctx.accounts.destination_vault_spl_token_account.reload()?;

    // Log post-transfer balances
    msg!(
        "Destination vault balance after transfer: {}",
        ctx.accounts.destination_vault_spl_token_account.amount
    );

    Ok(())
}
