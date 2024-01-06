use crate::state::ProgramInfo;
use crate::{errors::VaultError, state::Vault};
use anchor_lang::context::{Context, CpiContext};
use anchor_lang::prelude::*;
use anchor_lang::{Accounts, ToAccountInfo};
use anchor_spl::token;
use anchor_spl::token::{Mint, Token, TokenAccount, TransferChecked};

#[derive(Accounts)]
pub struct DistributeInterest<'info> {
    #[account(mut)]
    admin_vault: Account<'info, Vault>,

    #[account(signer)]
    payer: Signer<'info>,

    #[account(mut)]
    destination_vault: Account<'info, Vault>,

    #[account(mut)]
    admin_vault_spl_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    destination_vault_spl_token_account: Account<'info, TokenAccount>,

    #[account(constraint = admin_vault_spl_token_account.mint == mint.key())]
    mint: Account<'info, Mint>,

    #[account(
        constraint = admin_vault.owner == program_info.admin,
        constraint = payer.key() == admin_vault.owner
    )]
    program_info: Account<'info, ProgramInfo>,

    token_program: Program<'info, Token>,
}

pub fn distribute_interest(ctx: Context<DistributeInterest>) -> Result<()> {
    let admin_vault = &mut ctx.accounts.admin_vault;
    let destination_vault = &mut ctx.accounts.destination_vault;
    let destination_vault_spl_token_account = &mut ctx.accounts.destination_vault_spl_token_account;

    // check if the admin is calling this function
    if ctx.accounts.payer.key() != admin_vault.owner {
        msg!("Invalid vault owner");
        return Err(VaultError::InvalidVaultOwner.into());
    }

    // calculate the interest amount
    let interest_amount = destination_vault_spl_token_account.amount / 100;
    msg!("Interest amount to be transferred: {}", interest_amount);

    // check if sufficient balance in admin's token account
    if ctx.accounts.admin_vault_spl_token_account.amount < interest_amount {
        msg!("Insufficient balance in admin's token account");
        return Err(VaultError::InsufficientBalance.into());
    }

    // check if it's not been a month since creation of the vault
    let current_time = Clock::get()?.unix_timestamp;
    let one_month = 30 * 24 * 60 * 60; // Approximate number of seconds in a month
    if current_time - destination_vault.creation_date < one_month {
        return Err(VaultError::InterestNotAccruedYet.into());
    }

    // Perform SPL token transfer from admin vault to all vaults
    let transfer_instruction = TransferChecked {
        from: ctx.accounts.admin_vault_spl_token_account.to_account_info().clone(),
        to: destination_vault_spl_token_account.to_account_info().clone(),
        authority: ctx.accounts.payer.to_account_info().clone(),
        mint: ctx.accounts.mint.to_account_info().clone(),
    };

    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_instruction);
    token::transfer_checked(cpi_ctx, interest_amount, ProgramInfo::TOKEN_DECIMALS)?;

    // Update vault balances
    destination_vault.update_balance_after_deposit(interest_amount);
    admin_vault.update_balance_after_withdrawal(interest_amount);

    // Log post-transfer balances
    msg!("Admin vault balance after transfer: {}", ctx.accounts.admin_vault_spl_token_account.amount);
    msg!("Destination vault balance after transfer: {}", destination_vault_spl_token_account.amount);

    Ok(())
}
