use crate::state::ProgramInfo;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
    init,
    payer = payer,
    seeds = [ProgramInfo::SEED.as_bytes().as_ref()],
    bump,
    space = 8 + ProgramInfo::MAXIMUM_SPACE,
    )]
    program_info: Account<'info, ProgramInfo>,

    #[account(mut)]
    payer: Signer<'info>,

    system_program: Program<'info, System>,
}

pub fn initialise_program_info(ctx: Context<Initialize>) -> Result<()> {
    ctx.accounts.program_info.set_inner(ProgramInfo::new(
        ctx.bumps.program_info,
        ctx.accounts.payer.key(),
        0,
    ));

    Ok(())
}
