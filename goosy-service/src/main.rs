use anchor_client::anchor_lang::AccountDeserialize;
use anchor_client::anchor_lang::__private::base64::decode;
use dotenv::dotenv;
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::instruction::{AccountMeta, Instruction};
use solana_sdk::{
    commitment_config::CommitmentConfig,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use spl_associated_token_account::{get_associated_token_address, instruction};
use spl_token::id;
use std::env;
use std::error::Error;
use std::str::FromStr;

const PROGRAM_ID: &str = "5wsNMDzsM3RepTN9Z2A4DCJViqXE8o3KbFJfa3t5hmZh";
const PROGRAM_INFO_SEED: &[u8] = b"program_info";

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    dotenv().ok();

    let base64_prv_key = env::var("ADMIN_PRVKEY").expect("ADMIN_PRVKEY must be set");

    // Decode the private key and create a Keypair
    let prv_key_bytes = decode(base64_prv_key)?;
    let admin_keypair = Keypair::from_bytes(&prv_key_bytes)?;
    println!("Public Key: {}", admin_keypair.pubkey());

    // Initialize RPC client
    let rpc_client = initialize_rpc_client();

    // Get derive program info PDA
    let program_id = Pubkey::from_str(PROGRAM_ID)?;
    let (program_info_pda, _) = Pubkey::find_program_address(&[PROGRAM_INFO_SEED], &program_id);

    // Get the number of vaults and process them
    let vaults_count = fetch_vaults_count(&rpc_client, &program_info_pda).await?;
    process_vaults(&rpc_client, vaults_count, &program_id, &program_info_pda, &admin_keypair).await?;

    Ok(())
}

fn initialize_rpc_client() -> RpcClient {
    let rpc_url = env::var("RPC_URL").unwrap_or_else(|_| "http://localhost:8899".to_string());
    RpcClient::new_with_commitment(rpc_url, CommitmentConfig::confirmed())
}

async fn fetch_vaults_count(rpc_client: &RpcClient, program_info_pda: &Pubkey) -> Result<u32, Box<dyn Error>> {
    let program_info_data = rpc_client.get_account_data(program_info_pda).await?;
    let vaults_count = goosy_vault::state::ProgramInfo::try_deserialize(&mut program_info_data.as_slice())?
        .vaults_count;
    Ok(vaults_count)
}

async fn process_vaults(
    rpc_client: &RpcClient,
    vaults_count: u32,
    program_id: &Pubkey,
    program_info_pda: &Pubkey,
    payer: &Keypair,
) -> Result<(), Box<dyn Error>> {
    for i in 0..vaults_count {
        let vault_pda = derive_vault_pda(i, program_id)?;

        let vault_data = rpc_client.get_account_data(&vault_pda).await?;
        let vault = goosy_vault::state::Vault::try_deserialize(&mut vault_data.as_slice())?;

        println!("Vault index{}: {:?}", i, vault);

        distribute_interest_to_vaults(rpc_client, vec![vault_pda], program_id, program_info_pda, payer).await?;
    }
    Ok(())
}

fn derive_vault_pda(vault_index: u32, program_id: &Pubkey) -> Result<Pubkey, Box<dyn Error>> {
    let vault_index_bytes: &[u8] = &vault_index.to_be_bytes();
    let seeds: &[&[u8]] = &[b"vault", vault_index_bytes];
    Ok(Pubkey::find_program_address(seeds, program_id).0)
}

pub fn compute_anchor_discriminator(namespace: &str, name: &str) -> [u8; 8] {
    let preimage = format!("{}:{}", namespace, name);

    let mut discriminator = [0u8; 8];

    discriminator.copy_from_slice(
        &anchor_client::anchor_lang::solana_program::hash::hash(preimage.as_bytes()).to_bytes()[..8],
    );

    discriminator
}

async fn distribute_interest_to_vaults(
    rpc_client: &RpcClient,
    vaults: Vec<Pubkey>,
    program_id: &Pubkey,
    program_info_pda: &Pubkey,
    payer: &Keypair,
) -> Result<(), Box<dyn Error>> {
    let seeds: &[&[u8]] = &[b"admin-vault"];
    let (admin_vault_pda, _) = Pubkey::find_program_address(seeds, program_id);

    let mint_key = env::var("MINT_PUBKEY").expect("MINT_PUBKEY must be set");
    let mint = Pubkey::from_str(&mint_key)?;

    let admin_vault_spl_token_account =
        get_or_create_associated_token_account(rpc_client, payer, &mint, &payer.pubkey()).await?;

    println!("Payer public key: {}", payer.pubkey());

    for vault_pda in vaults {
        println!("Vault PDA: {}", vault_pda);
        let destination_vault_spl_associated_token_account =
            get_or_create_associated_token_account(rpc_client, payer, &mint, &vault_pda).await?;

        let interest_instruction = create_distribute_interest_instruction(
            program_id,
            &admin_vault_pda,
            &vault_pda,
            &admin_vault_spl_token_account,
            &destination_vault_spl_associated_token_account,
            &mint,
            program_info_pda,
            &id(),
            payer,
        );
        let mut transaction =
            Transaction::new_with_payer(&[interest_instruction], Some(&payer.pubkey()));
        transaction.sign(&[payer], rpc_client.get_latest_blockhash().await?);

        rpc_client
            .send_and_confirm_transaction(&transaction)
            .await
            .expect("TODO: panic message");

        let admin_vault_spl_token_account_balance = rpc_client
            .get_token_account_balance(&admin_vault_spl_token_account)
            .await?;

        let destination_vault_spl_token_account_balance = rpc_client
            .get_token_account_balance(&destination_vault_spl_associated_token_account)
            .await?;

        println!("Admin vault balance: {:?}", admin_vault_spl_token_account_balance.ui_amount);
        println!("Destination vault balance: {:?}", destination_vault_spl_token_account_balance.ui_amount);
        println!("Destination vault: {:?}", destination_vault_spl_associated_token_account);
    }

    Ok(())
}

fn create_distribute_interest_instruction(
    program_id: &Pubkey,
    admin_vault_pda: &Pubkey,
    destination_vault_pda: &Pubkey,
    admin_vault_spl_token_account: &Pubkey,
    destination_vault_spl_token_account: &Pubkey,
    mint: &Pubkey,
    program_info_pda: &Pubkey,
    token_program: &Pubkey,
    signer: &Keypair,
) -> Instruction {
    let discriminator = compute_anchor_discriminator("global", "distribute_interest");     // [161, 80, 239, 247, 115, 254, 122, 80]

    let data = Vec::from(discriminator);

    let accounts = vec![
        AccountMeta::new(*admin_vault_pda, false),
        AccountMeta::new(signer.pubkey(), true),
        AccountMeta::new(*destination_vault_pda, false),
        AccountMeta::new(*admin_vault_spl_token_account, false),
        AccountMeta::new(*destination_vault_spl_token_account, false),
        AccountMeta::new_readonly(*mint, false),
        AccountMeta::new_readonly(*program_info_pda, false),
        AccountMeta::new_readonly(*token_program, false),
    ];

    Instruction {
        program_id: *program_id,
        accounts,
        data,
    }
}

async fn get_or_create_associated_token_account(
    rpc_client: &RpcClient,
    payer: &Keypair,
    mint: &Pubkey,
    owner: &Pubkey,
) -> Result<Pubkey, Box<dyn Error>> {
    let associated_token_address = get_associated_token_address(owner, mint);

    match rpc_client.get_account(&associated_token_address).await {
        Ok(_) => {
            println!("Associated token account exists: {}", associated_token_address);
            Ok(associated_token_address)
        }
        Err(_) => {
            // Create the associated token account
            let create_account_instruction =
                instruction::create_associated_token_account(&payer.pubkey(), owner, mint, &id());

            let mut transaction = Transaction::new_with_payer(
                &[create_account_instruction],
                Some(&payer.pubkey()),
            );
            let recent_blockhash = rpc_client.get_latest_blockhash().await?;
            transaction.sign(&[payer], recent_blockhash);
            rpc_client
                .send_and_confirm_transaction(&transaction)
                .await?;

            println!(
                "Associated token account created: {}",
                associated_token_address
            );

            Ok(associated_token_address)
        }
    }
}
