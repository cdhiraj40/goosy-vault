import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { encode } from "@coral-xyz/anchor/dist/cjs/utils/bytes/utf8";
import { assert, expect } from "chai";
import { toBytesInt32 } from "../utils/toBytesInt32";
import { GoosyVault } from "../../target/types/goosy_vault";
import {
  Account,
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Context } from "mocha";

export default function suite() {
  let generateFundedKeypair: () => Promise<Keypair>;

  let program: Program<GoosyVault>,
    connection: anchor.web3.Connection,
    admin: Keypair,
    mint: PublicKey;

  let vaultPDA: PublicKey, vaultOwner: Keypair, vaultSplTokenAccount: Account;

  let adminSplTokenAccount: Account,
    adminVaultPDA: PublicKey,
    programInfoPDA: PublicKey;

  // Variables that will be used to deposit, withdraw funds
  let testVaultOwner: Keypair, testVaultSplTokenAccount: Account;

  const tokenDecimals = 6;

  before(async function () {
    ({ program, connection, admin, programInfoPDA, generateFundedKeypair } =
      setupContext(this.test.ctx));

    adminVaultPDA = getAdminVaultPDA()[0];
    mint = await mintToken(admin, 6); // 6 decimal places for token i.e. 1 SPL token = 1000000 smallest units

    try {
      ({ vaultPDA, vaultOwner, vaultSplTokenAccount, adminSplTokenAccount } =
        await setupVault(true));
    } catch (e) {
      console.log("Error minting token: ");
      console.log(e);
    }

    await createAdminVault();

    await preFundAdminVault();
  });

  // runs before each test, updates the Vault PDA, owner keypair, and vault spl token account
  beforeEach(async () => {
    const programInfo = await program.account.programInfo.fetch(programInfoPDA);

    vaultPDA = findVaultPDA(programInfo.vaultsCount);

    ({ vaultPDA, vaultOwner, vaultSplTokenAccount } = await setupVault());

    ({ testVaultOwner, testVaultSplTokenAccount } = await setupTestVault());
  });

  it("Creates a Vault", async () => {
    const vault = await createVault(vaultOwner);
    expect(vault.owner).to.eql(vaultOwner.publicKey);
    expect(vault.totalBalance.toNumber()).to.eql(0);
  });

  it("Is updating the number of vaults", async () => {
    await createVault(vaultOwner);
    const vaultsCount = (
      await program.account.programInfo.fetch(programInfoPDA)
    ).vaultsCount;
    expect(vaultsCount).to.eql(
      2,
      "The number of vaults should be incremented to 2 after creating a new vault"
    );
  });

  it("User can deposit tokens to vault", async () => {
    await createVault(vaultOwner);

    const amountToDeposit = new BN(100);
    await depositSPLTokens(
      testVaultSplTokenAccount.address,
      vaultSplTokenAccount.address,
      testVaultOwner,
      amountToDeposit
    );

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.totalBalance.toNumber()).to.eql(
      100,
      "Vault's total balance should be 100 after deposit"
    );

    const vaultSplTokenAccountBalance = await connection.getTokenAccountBalance(
      vaultSplTokenAccount.address
    );
    console.log(
      `Vault SPL token account balance after deposit: ${vaultSplTokenAccountBalance.value.uiAmount}`
    );
    expect(vaultSplTokenAccountBalance.value.uiAmount).to.eql(
      100 / 10 ** 6,
      "On-chain token account balance should match the deposited amount"
    );
  });

  it("User can withdraw funds", async () => {
    await createVault(vaultOwner);

    const amount = new BN(100);

    await depositSPLTokens(
      testVaultSplTokenAccount.address,
      vaultSplTokenAccount.address,
      testVaultOwner,
      amount
    );

    await withdrawSPLTokens(
      testVaultSplTokenAccount.address,
      vaultSplTokenAccount.address,
      testVaultOwner,
      vaultOwner,
      amount
    );

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.totalBalance.toNumber()).to.eql(
      0,
      "Vault's total balance should be 0 after withdrawal"
    );
  });

  it("A user cannot withdraw someone else's funds", async () => {
    await createVault(vaultOwner);

    const amountToDeposit = new BN(100);

    await depositSPLTokens(
      testVaultSplTokenAccount.address,
      vaultSplTokenAccount.address,
      testVaultOwner,
      amountToDeposit
    );

    let vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.totalBalance.toNumber()).to.eql(100);

    try {
      await program.methods
        .withdrawSplTokens(amountToDeposit)
        .accounts({
          vault: vaultPDA,
          owner: vaultOwner.publicKey,
          payer: testVaultOwner.publicKey,
          userSplTokenAccount: testVaultSplTokenAccount.address,
          vaultSplTokenAccount: vaultSplTokenAccount.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([testVaultOwner])
        .rpc();

      assert.fail("Withdrawal by non-owner should have failed");
    } catch (e: any) {
      console.log(`Expected error due to non-owner withdrawal: ${e}`);
    }
  });

  it("Cannot distribute interest cause a month has not passed", async () => {
    await createVault(vaultOwner);

    const amountToDeposit = new BN(100);
    await depositSPLTokens(
      testVaultSplTokenAccount.address,
      vaultSplTokenAccount.address,
      testVaultOwner,
      amountToDeposit
    );

    // Fetch the initial balance of the vault
    const initialBalance = await connection.getTokenAccountBalance(
      vaultSplTokenAccount.address
    );

    try {
      await distributeInterest(vaultPDA, vaultSplTokenAccount.address);

      // Uncomment to test distribution
      // NOTE: Do comment the time bound code inside instruction `distribute_interest.rs`
      // const expectedNewBalance = initialBalance.value.uiAmount + initialBalance.value.uiAmount * 0.01;
      //
      // // Fetch the balance after distributing interest
      // const updatedVaultBalance =
      //     await connection.getTokenAccountBalance(vaultSplTokenAccount.address);
      //
      // // Assert that the balance has not changed
      // expect(updatedVaultBalance.value.uiAmount)
      //     .to.equal(expectedNewBalance, "Vault balance should have increased by 1%");

      assert.fail(
        "Interest distribution should have failed due to time constraint"
      );
    } catch (e) {
      console.log(`Expected error due to time constraint: ${e}`);
    }

    const updatedBalance = await connection.getTokenAccountBalance(
      vaultSplTokenAccount.address
    );
    expect(updatedBalance.value.uiAmount).to.eql(
      initialBalance.value.uiAmount,
      "Vault balance should not have changed due to time constraint"
    );
  });

  /** Helper functions */
  function setupContext(ctx: Context) {
    const program = ctx.program;
    const connection = program.provider.connection;
    const admin = ctx.admin;
    const programInfoPDA = ctx.programInfoPDA;
    const generateFundedKeypair = ctx.generateFundedKeypair;
    return {
      program,
      connection,
      admin,
      programInfoPDA,
      generateFundedKeypair,
    };
  }

  async function setupVault(shouldSetupAdminVault = false) {
    const programInfo = await program.account.programInfo.fetch(programInfoPDA);

    const vaultPDA = findVaultPDA(programInfo.vaultsCount);
    const vaultOwner = await generateFundedKeypair();

    const vaultSplTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      vaultOwner,
      mint,
      vaultOwner.publicKey
    );

    let adminSplTokenAccount: Account;
    if (shouldSetupAdminVault) {
      adminSplTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        admin,
        mint,
        adminVaultPDA,
        true
      );
    }

    return {
      vaultPDA,
      vaultOwner,
      vaultSplTokenAccount,
      adminSplTokenAccount,
    };
  }

  async function setupTestVault() {
    const testVaultOwner = await generateFundedKeypair();
    const testVaultSplTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      testVaultOwner,
      mint,
      testVaultOwner.publicKey
    );

    return {
      testVaultOwner,
      testVaultSplTokenAccount,
    };
  }

  function findVaultPDA(vaultNumber: number) {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [encode("vault"), toBytesInt32(vaultNumber)],
      program.programId
    )[0];
  }

  function getAdminVaultPDA() {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [encode("admin-vault")],
      program.programId
    );
  }

  async function preFundAdminVault() {
    const adminVaultFund = new BN(1000000 * 10 ** 6); // pre fund 1 million tokens

    const tempAdminKey = await generateFundedKeypair();
    const tempAdminSplTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      tempAdminKey,
      mint,
      tempAdminKey.publicKey
    );
    await mintTokens(adminVaultFund, tempAdminSplTokenAccount.address);

    let balance = await connection.getTokenAccountBalance(
      adminSplTokenAccount.address
    );

    console.log(
      "admin spl token account: ",
      adminSplTokenAccount.address.toBase58(),
      " balance: ",
      balance.value.uiAmount
    );

    //  can have a separate rpc call to deposit tokens to admin vault
    try {
      await program.methods
        .depositSplTokens(new BN(adminVaultFund))
        .accounts({
          userVault: adminVaultPDA,
          userSplTokenAccount: tempAdminSplTokenAccount.address,
          destinationVaultSplTokenAccount: adminSplTokenAccount.address,
          feePayer: tempAdminKey.publicKey,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([tempAdminKey])
        .rpc();
    } catch (e: any) {
      console.log("Here is the error: ");
      console.log(e);
    }

    console.log(
      `Funded ${adminVaultFund}, balance ${
        balance.value.uiAmount
      } tokens to ${adminSplTokenAccount.address.toBase58()}`
    );
  }

  async function createVault(
    vaultOwner: Keypair,
    splTokenAccount: Account = vaultSplTokenAccount
  ) {
    await program.methods
      .createVault()
      .accounts({
        vault: vaultPDA,
        programInfo: programInfoPDA,
        owner: vaultOwner.publicKey,
        splTokenAccount: splTokenAccount.address,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([vaultOwner])
      .rpc();

    return program.account.vault.fetch(vaultPDA);
  }

  async function createAdminVault() {
    await program.methods
      .createAdminVault()
      .accounts({
        vault: adminVaultPDA,
        programInfo: programInfoPDA,
        owner: admin.publicKey,
        splTokenAccount: adminSplTokenAccount.address,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    return vaultPDA;
  }

  async function mintTokens(amount: BN, destinationSplTokenAddress: PublicKey) {
    try {
      await program.methods
        .mintTokensTo(amount)
        .accounts({
          mint: mint,
          destinationVaultSplTokenAccount: destinationSplTokenAddress,
          adminVault: adminVaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          feePayer: admin.publicKey,
        })
        .signers([admin])
        .rpc();
    } catch (e: any) {
      console.log("Mint tokens error: ");
      console.log(e);
    }
  }

  async function fundAccount(tokenAccountAddress: PublicKey, amount: number) {
    // Mint to the user's token account
    await mintTokens(new BN(amount), tokenAccountAddress);

    let balance = await connection.getTokenAccountBalance(tokenAccountAddress);

    console.log(
      `Funded ${amount}, balance ${
        balance.value.uiAmount
      } tokens to ${tokenAccountAddress.toBase58()}`
    );
  }

  async function depositSPLTokens(
    fromTokenAddress: PublicKey,
    vaultTokenAddress: PublicKey,
    payer: Keypair,
    amountToDeposit: BN
  ) {
    await fundAccount(
      fromTokenAddress,
      1000 * 10 ** 6
    );

    await program.methods
      .depositSplTokens(amountToDeposit)
      .accounts({
        userVault: vaultPDA,
        feePayer: payer.publicKey,
        userSplTokenAccount: fromTokenAddress,
        destinationVaultSplTokenAccount: vaultTokenAddress,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payer])
      .rpc();
  }

  async function withdrawSPLTokens(
    toTokenAddress: PublicKey,
    vaultTokenAddress: PublicKey,
    feePayer: Keypair,
    vaultOwner: Keypair,
    amountToWithdraw: BN
  ) {
    await program.methods
      .withdrawSplTokens(amountToWithdraw)
      .accounts({
        vault: vaultPDA,
        owner: vaultOwner.publicKey,
        payer: feePayer.publicKey,
        userSplTokenAccount: toTokenAddress,
        vaultSplTokenAccount: vaultTokenAddress,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([feePayer, vaultOwner])
      .rpc();
  }

  async function distributeInterest(
    destinationVault: PublicKey,
    destinationVaultSplTokenAccount: PublicKey
  ) {
    const [adminVaultPDA, _bump] = getAdminVaultPDA();

    let destinationVaultSplTokenBalance =
      await connection.getTokenAccountBalance(destinationVaultSplTokenAccount);
    console.log(
      `Destination vault balance before distribution: ${destinationVaultSplTokenBalance.value.uiAmount}`
    );

    // Distribute tokens to all vaults
    await program.methods
      .distributeInterest()
      .accounts({
        adminVault: adminVaultPDA,
        destinationVault: destinationVault,
        adminVaultSplTokenAccount: adminSplTokenAccount.address,
        destinationVaultSplTokenAccount: destinationVaultSplTokenAccount,
        mint: mint,
        programInfo: programInfoPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    destinationVaultSplTokenBalance = await connection.getTokenAccountBalance(
      destinationVaultSplTokenAccount
    );
    console.log(
      `Destination vault balance after distribution: ${destinationVaultSplTokenBalance.value.uiAmount}`
    );
  }

  async function mintToken(admin: Keypair, decimals = tokenDecimals) {
    console.log("minting token");

    let mindAddress = await createMint(
      connection,
      admin,
      adminVaultPDA,
      null,
      decimals
    );

    const mint = await getMint(connection, mindAddress);

    console.log("mint authority: ", mint.mintAuthority, "mint Address: ", mindAddress.toBase58());

    return mindAddress;
  }
}
