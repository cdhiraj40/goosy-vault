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

    #[account(mut)]
    destination_vault: Account<'info, Vault>,

    #[account(
        mut,
        associated_token::mint=mint,
        associated_token::authority=admin_vault.key(),
    )]
    admin_vault_spl_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    destination_vault_spl_token_account: Account<'info, TokenAccount>,

    #[account(constraint = admin_vault_spl_token_account.mint == mint.key())]
    mint: Account<'info, Mint>,

    #[account(constraint = admin_vault.owner == program_info.admin)]
    program_info: Account<'info, ProgramInfo>,

    token_program: Program<'info, Token>,
}

pub fn distribute_interest(ctx: Context<DistributeInterest>) -> Result<()> {
    let admin_vault = &mut ctx.accounts.admin_vault;
    let destination_vault = &mut ctx.accounts.destination_vault;

    // calculate the interest amount
    let interest_amount = ctx.accounts.destination_vault_spl_token_account.amount / 100;
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

    let seeds = &[b"admin-vault".as_ref(), &[admin_vault.bump]];
    let signer_seeds = &[&seeds[..]];

    // Log pre-transfer balances
    msg!(
        "Admin vault balance before transfer: {}",
        ctx.accounts.admin_vault_spl_token_account.amount
    );
    msg!(
        "Destination vault balance before transfer: {}",
        ctx.accounts.destination_vault_spl_token_account.amount
    );

    // Perform SPL token transfer from admin vault to all vaults
    let cpi_accounts = TransferChecked {
        from: ctx.accounts.admin_vault_spl_token_account.to_account_info(),
        to: ctx
            .accounts
            .destination_vault_spl_token_account
            .to_account_info(),
        mint: ctx.accounts.mint.to_account_info(),
        authority: admin_vault.to_account_info(), // PDA as authority
    };

    let cpi_program = ctx.accounts.token_program.to_account_info();
    let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
    token::transfer_checked(cpi_ctx, interest_amount, ProgramInfo::TOKEN_DECIMALS)?;

    // Update vault balances
    destination_vault.update_balance_after_deposit(interest_amount);
    admin_vault.update_balance_after_withdrawal(interest_amount);

    // Fetch updated accounts post transfer
    ctx.accounts.admin_vault_spl_token_account.reload()?;
    ctx.accounts.destination_vault_spl_token_account.reload()?;

    // Log post-transfer balances
    msg!(
        "Admin vault balance after transfer: {}",
        ctx.accounts.admin_vault_spl_token_account.amount
    );
    msg!(
        "Destination vault balance after transfer: {}",
        ctx.accounts.destination_vault_spl_token_account.amount
    );

    Ok(())
}
