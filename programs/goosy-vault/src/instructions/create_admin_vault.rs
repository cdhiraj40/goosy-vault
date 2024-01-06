use crate::state::{ProgramInfo, Vault};
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

#[derive(Accounts)]
pub struct CreateAdminVault<'info> {
    #[account(
    init,
    payer = owner,
    seeds = [b"admin-vault"],
    bump,
    space = 8 + Vault::MAXIMUM_SPACE
    )]
    vault: Account<'info, Vault>,

    #[account(mut)]
    owner: Signer<'info>,

    #[account(mut, seeds = [ProgramInfo::SEED.as_bytes().as_ref()], bump = program_info.bump)]
    program_info: Account<'info, ProgramInfo>,

    spl_token_account: Account<'info, TokenAccount>,

    system_program: Program<'info, System>,
}

pub fn create_admin_vault(ctx: Context<CreateAdminVault>) -> Result<()> {
    ctx.accounts.vault.set_inner(Vault::new(
        ctx.bumps.vault,
        ctx.accounts.owner.key(),
        ctx.accounts.program_info.vaults_count,
        ctx.accounts.spl_token_account.key(),
        ctx.accounts.spl_token_account.mint,
        Clock::get()?.unix_timestamp,
    ));

    Ok(())
}
