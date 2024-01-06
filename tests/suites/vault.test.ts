import * as anchor from "@coral-xyz/anchor";
import { AnchorError, BN, Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { encode } from "@coral-xyz/anchor/dist/cjs/utils/bytes/utf8";
import { assert, expect } from "chai";
import { toBytesInt32 } from "../utils/toBytesInt32";
import { GoosyVault } from "../../target/types/goosy_vault";
import {
  Account,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintToChecked,
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
  let testVaultPDA: PublicKey,
    testVaultOwner: Keypair,
    testVaultSplTokenAccount: Account;

  const tokenDecimals = 6;

  before(async function () {
    ({ program, connection, admin, programInfoPDA, generateFundedKeypair } =
      setupContext(this.test.ctx));

    mint = await mintToken(admin, 6); // 6 decimal places for token i.e. 1 SPL token = 1000000 smallest units
    ({
      vaultPDA,
      vaultOwner,
      vaultSplTokenAccount,
      adminSplTokenAccount,
      adminVaultPDA,
    } = await setupVault(true));

    await createAdminVault();

    await preFundAdminVault();
  });

  // runs before each test, updates the Vault PDA, owner keypair, and vault spl token account
  beforeEach(async () => {
    const programInfo = await program.account.programInfo.fetch(programInfoPDA);

    vaultPDA = findVaultPDA(programInfo.vaultsCount);

    ({ vaultPDA, vaultOwner, vaultSplTokenAccount } = await setupVault());

    ({ testVaultPDA, testVaultOwner, testVaultSplTokenAccount } =
      await setupTestVault());
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
    expect(vaultsCount).to.eql(2);
  });

  it("author can deposit tokens to vault", async () => {
    await createVault(vaultOwner);

    const amountToDeposit = new BN(100);

    await depositSPLTokens(
      testVaultSplTokenAccount.address,
      vaultSplTokenAccount.address,
      testVaultOwner,
      amountToDeposit
    );

    const vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.totalBalance.toNumber()).to.eql(100);

    const vaultSplTokenAccountBalance = await connection.getTokenAccountBalance(
      vaultSplTokenAccount.address
    );

    console.log(
      "Deposited to vault spl address: ",
      vaultSplTokenAccount.address.toBase58()
    );

    expect(vaultSplTokenAccountBalance.value.amount).to.eql("100");
  });

  it("author can withdraw funds", async () => {
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

    await fundAccount(
      testVaultOwner,
      admin,
      testVaultSplTokenAccount.address,
      mint,
      1000 * 10 ** 6
    ); // Fund user with 1000 tokens

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
      .signers([testVaultOwner, vaultOwner])
      .rpc();

    vault = await program.account.vault.fetch(vaultPDA);
    expect(vault.totalBalance.toNumber()).to.eql(0);
  });

  it("A user cannot withdraw someone else's funds", async () => {
    try {
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

      await fundAccount(
        testVaultOwner,
        admin,
        testVaultSplTokenAccount.address,
        mint,
        1000 * 10 ** 6
      ); // Fund user with 1000 tokens

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
        .signers([testVaultOwner, testVaultOwner])
        .rpc();

      assert.fail("Should have thrown an error");
    } catch (e: any) {
      if (e instanceof AnchorError) {
        console.log("AnchorError: " + e, "This is expected");
      } else {
        console.log("Error: " + e + "This is expected");
      }
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

    try {
      await distributeInterest(vaultPDA, vaultSplTokenAccount.address);
      assert.fail("Should have thrown an error");
    } catch (e) {
      console.log("Error: " + e + "This is expected");
    }
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

    let adminVaultPDA: PublicKey, adminSplTokenAccount: Account;
    if (shouldSetupAdminVault) {
      adminVaultPDA = getAdminVaultPDA();
      adminSplTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        admin,
        mint,
        admin.publicKey
      );
    }

    return {
      vaultPDA,
      vaultOwner,
      vaultSplTokenAccount,
      adminVaultPDA,
      adminSplTokenAccount,
    };
  }

  async function setupTestVault() {
    const programInfo = await program.account.programInfo.fetch(programInfoPDA);

    const testVaultPDA = findVaultPDA(programInfo.vaultsCount);
    const testVaultOwner = await generateFundedKeypair();
    const testVaultSplTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      testVaultOwner,
      mint,
      testVaultOwner.publicKey
    );

    return {
      testVaultPDA,
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
    )[0];
  }

  async function preFundAdminVault() {
    const adminVaultFund = 1000000 * 10 ** 6; // pre fund 1 million tokens

    const tempAdminKey = await generateFundedKeypair();
    const tempAdminSplTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      tempAdminKey,
      mint,
      tempAdminKey.publicKey
    );
    await mintToChecked(
      connection,
      tempAdminKey,
      mint,
      tempAdminSplTokenAccount.address,
      admin,
      adminVaultFund,
      tokenDecimals
    );

    let balance = await connection.getTokenAccountBalance(
      adminSplTokenAccount.address
    );

    await program.methods
      .depositSplTokens(new BN(adminVaultFund))
      .accounts({
        vault: adminVaultPDA,
        payer: tempAdminKey.publicKey,
        userSplTokenAccount: tempAdminSplTokenAccount.address,
        vaultSplTokenAccount: adminSplTokenAccount.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([tempAdminKey])
      .rpc();

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

  async function fundAccount(
    signer: Keypair,
    admin: Keypair,
    tokenAccountAddress: PublicKey,
    mint: PublicKey,
    amount: number
  ) {
    // Mint to the user's token account
    await mintToChecked(
      connection,
      signer,
      mint,
      tokenAccountAddress,
      admin,
      amount,
      tokenDecimals
    );

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
      testVaultOwner,
      admin,
      fromTokenAddress,
      mint,
      1000 * 10 ** 6
    );

    await program.methods
      .depositSplTokens(amountToDeposit)
      .accounts({
        vault: vaultPDA,
        payer: payer.publicKey,
        userSplTokenAccount: fromTokenAddress,
        vaultSplTokenAccount: vaultTokenAddress,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([payer])
      .rpc();
  }

  async function distributeInterest(
    destinationVault: PublicKey,
    destinationVaultSplTokenAccount: PublicKey
  ) {
    // Distribute tokens to all vaults
    await program.methods
      .distributeInterest()
      .accounts({
        adminVault: adminVaultPDA,
        payer: admin.publicKey,
        destinationVault: destinationVault,
        adminVaultSplTokenAccount: adminSplTokenAccount.address,
        destinationVaultSplTokenAccount: destinationVaultSplTokenAccount,
        mint: mint,
        programInfo: programInfoPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([admin])
      .rpc();

    const vault = await program.account.vault.fetch(destinationVault);
    console.log(
        `Distributed ${vault.totalBalance.toNumber()} tokens to ${destinationVault.toBase58()}`
    );

    const vaultSplTokenAccountBalance = await connection.getTokenAccountBalance(
      destinationVaultSplTokenAccount
    );

    console.log(
        `Balance of ${destinationVaultSplTokenAccount.toBase58()} is ${
            vaultSplTokenAccountBalance.value.uiAmount
        }`
    );

    return vaultSplTokenAccountBalance;
  }

  async function mintToken(admin: Keypair, decimals = tokenDecimals) {
    console.log("minting token");
    return await createMint(connection, admin, admin.publicKey, null, decimals);
  }
}
