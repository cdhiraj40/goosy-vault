use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("The vault does not have enough balance to complete the transaction.")]
    InsufficientBalance,
    #[msg("The SPL token type provided is invalid")]
    InvalidSPLTokenType,
    #[msg("Action not permitted. The vault owner is not the signer of the transaction.")]
    InvalidVaultOwner,
    #[msg("Interest has not been accrued yet. Please try again after a month.")]
    InterestNotAccruedYet,
}
