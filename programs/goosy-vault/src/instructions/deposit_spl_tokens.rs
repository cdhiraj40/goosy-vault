use crate::state::ProgramInfo;
use crate::{errors::VaultError, state::Vault};
use anchor_lang::context::{Context, CpiContext};
use anchor_lang::prelude::*;
use anchor_lang::{Accounts, ToAccountInfo};
use anchor_spl::token;
use anchor_spl::token::{Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
pub struct DepositSPLTokens<'info> {
    #[account(mut)]
    user_vault: Account<'info, Vault>,
    #[account(
        mut,
        associated_token::mint=mint,
        associated_token::authority=fee_payer.key(),
    )]
    user_spl_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    destination_vault_spl_token_account: Account<'info, TokenAccount>,
    #[account()]
    mint: Account<'info, Mint>,
    #[account(signer)]
    pub fee_payer: Signer<'info>,
    token_program: Program<'info, Token>,
}

pub fn deposit_spl_tokens(ctx: Context<DepositSPLTokens>, amount: u64) -> Result<()> {
    let user_vault = &mut ctx.accounts.user_vault;

    // verify if the vault mint matches the mint of the token account
    if !user_vault.verify_spl_token_type(ctx.accounts.user_spl_token_account.mint) {
        return Err(VaultError::InvalidSPLTokenType.into());
    }

    // Log pre-transfer balances
    msg!(
        "User vault balance before transfer: {}",
        ctx.accounts.user_spl_token_account.amount
    );
    msg!(
        "Destination vault balance before transfer: {}",
        ctx.accounts.destination_vault_spl_token_account.amount
    );

    // Perform SPL token transfer from user to vault
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.user_spl_token_account.to_account_info(),
        to: ctx
            .accounts
            .destination_vault_spl_token_account
            .to_account_info(),
        authority: ctx.accounts.fee_payer.to_account_info(), // PDA as authority
        mint: ctx.accounts.mint.to_account_info(),
    };
    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
    token::transfer_checked(cpi_ctx, amount, ProgramInfo::TOKEN_DECIMALS)?;

    // Update vault balance
    user_vault.update_balance_after_deposit(amount);

    // Fetch updated accounts post transfer
    ctx.accounts.user_spl_token_account.reload()?;
    ctx.accounts.destination_vault_spl_token_account.reload()?;

    // Log post-transfer balances
    msg!(
        "User vault balance after transfer: {}",
        ctx.accounts.user_spl_token_account.amount
    );
    msg!(
        "Destination vault balance after transfer: {}",
        ctx.accounts.destination_vault_spl_token_account.amount
    );

    Ok(())
}
