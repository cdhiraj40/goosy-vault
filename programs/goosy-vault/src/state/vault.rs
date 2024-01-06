use anchor_lang::prelude::*;

#[account]
#[derive(Default, Debug)]
pub struct Vault {
    pub bump: u8,                  // 1
    pub owner: Pubkey,             // 32
    total_balance: u64,            // 16
    pub spl_token_account: Pubkey, // 32, SPL token account for this vault
    pub spl_token_mint: Pubkey,    // 32, Mint of the SPL token
    pub vault_num: u32,            // 8
    pub creation_date: i64,        // 8
}

impl Vault {
    pub const MAXIMUM_SPACE: usize = 1 + 16 + 32 + 32 + 32 + 8 + 8;

    pub fn new(
        bump: u8,
        owner: Pubkey,
        vault_num: u32,
        spl_token_account: Pubkey,
        spl_token_mint: Pubkey,
        creation_date: i64,
    ) -> Self {
        Vault {
            bump,
            owner,
            vault_num,
            spl_token_account,
            spl_token_mint,
            creation_date,
            ..Default::default()
        }
    }

    pub fn has_sufficient_balance(&self, amount: u64) -> bool {
        self.total_balance >= amount
    }

    pub fn verify_spl_token_type(&self, passed_spl_token_account_mint: Pubkey) -> bool {
        if passed_spl_token_account_mint != self.spl_token_mint {
            return false;
        }
        true
    }

    pub fn update_balance_after_deposit(&mut self, amount: u64) {
        self.total_balance += amount;
    }

    pub fn update_balance_after_withdrawal(&mut self, amount: u64) {
        if self.total_balance >= amount {
            self.total_balance -= amount;
        }
    }
}
