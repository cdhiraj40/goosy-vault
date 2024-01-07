use anchor_lang::prelude::*;
use instructions::*;

mod errors;
mod instructions;
pub mod state;

declare_id!("5wsNMDzsM3RepTN9Z2A4DCJViqXE8o3KbFJfa3t5hmZh");

#[program]
pub(crate) mod goosy_vault {
    use super::*;

    pub fn initialise_program_info(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialise_program_info(ctx)
    }

    pub fn create_vault(ctx: Context<CreateVault>) -> Result<()> {
        instructions::create_vault(ctx)
    }

    pub fn create_admin_vault(ctx: Context<CreateAdminVault>) -> Result<()> {
        instructions::create_admin_vault(ctx)
    }

    pub fn deposit_spl_tokens(ctx: Context<DepositSPLTokens>, deposit_amount: u64) -> Result<()> {
        instructions::deposit_spl_tokens(ctx, deposit_amount)
    }

    pub fn withdraw_spl_tokens(
        ctx: Context<WithdrawSPLTokens>,
        withdrawal_amount: u64,
    ) -> Result<()> {
        instructions::withdraw_spl_tokens(ctx, withdrawal_amount)
    }

    pub fn distribute_interest(ctx: Context<DistributeInterest>) -> Result<()> {
        instructions::distribute_interest(ctx)
    }

    pub fn mint_tokens_to(ctx: Context<MintTokensTo>, amount: u64) -> Result<()> {
        instructions::mint_tokens_to(ctx, amount)
    }
}
