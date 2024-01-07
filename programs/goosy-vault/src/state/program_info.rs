use anchor_lang::prelude::*;

#[account]
#[derive(Default, Debug)]
pub struct ProgramInfo {
    pub admin: Pubkey,     // 32
    pub bump: u8,          // 1
    pub vaults_count: u32, // 8
}

impl ProgramInfo {
    pub const MAXIMUM_SPACE: usize = 1 + 32 + 8;
    pub const SEED: &'static str = "program_info";

    pub const TOKEN_DECIMALS: u8 = 6;

    pub fn new(bump: u8, admin: Pubkey, vaults_count: u32) -> Self {
        Self {
            bump,
            admin,
            vaults_count,
            // ..Default::default()
        }
    }

    /// Increment the vault count.
    pub fn increment_vaults_count(&mut self) {
        self.vaults_count += 1;
    }
}
