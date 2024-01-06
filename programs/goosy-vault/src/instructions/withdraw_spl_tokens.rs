use crate::{errors::VaultError, state::Vault};
use anchor_lang::context::{Context, CpiContext};
use anchor_lang::prelude::*;
use anchor_lang::{Accounts, ToAccountInfo};
use anchor_spl::token;
use anchor_spl::token::{Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct WithdrawSPLTokens<'info> {
    #[account(mut)]
    vault: Account<'info, Vault>,
    #[account(mut)]
    vault_spl_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    user_spl_token_account: Account<'info, TokenAccount>,
    #[account(signer)]
    payer: Signer<'info>,
    #[account(signer, constraint = owner.key() == vault.owner)]
    owner: Signer<'info>,
    token_program: Program<'info, Token>,
}

pub fn withdraw_spl_tokens(ctx: Context<WithdrawSPLTokens>, amount: u64) -> Result<()> {
    let vault = &mut ctx.accounts.vault;

    // verify the owner of the vault
    if ctx.accounts.owner.key() != vault.owner {
        return Err(VaultError::InvalidVaultOwner.into());
    }

    // verify if the vault mint matches the mint of the token account
    if !vault.verify_spl_token_type(ctx.accounts.user_spl_token_account.mint) {
        return Err(VaultError::InvalidSPLTokenType.into());
    }

    // check if sufficient balance in user's token account
    if ctx.accounts.user_spl_token_account.amount < amount {
        return Err(VaultError::InsufficientBalance.into());
    }

    // Perform SPL token transfer from vault to user
    let transfer_instruction = Transfer {
        from: ctx
            .accounts
            .vault_spl_token_account
            .to_account_info()
            .clone(),
        to: ctx
            .accounts
            .user_spl_token_account
            .to_account_info()
            .clone(),
        authority: ctx.accounts.owner.to_account_info().clone(),
    };

    let cpi_ctx = CpiContext::new(
        ctx.accounts.token_program.to_account_info(),
        transfer_instruction,
    );
    token::transfer(cpi_ctx, amount)?;

    // Update vault balance
    vault.update_balance_after_withdrawal(amount);

    Ok(())
}
