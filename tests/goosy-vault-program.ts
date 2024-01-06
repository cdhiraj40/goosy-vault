import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { encode } from "@coral-xyz/anchor/dist/cjs/utils/bytes/utf8";
import { GoosyVault } from "../target/types/goosy_vault";
import { expect } from "chai";
import { describe } from "mocha";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import vault from "./suites/vault.test";

describe("goosy-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.GoosyVault as Program<GoosyVault>;
  const programWallet = (program.provider as anchor.AnchorProvider).wallet;
  let programInfoPDA: PublicKey;

  before(async function () {
    this.provider = provider;
    this.program = program;
    this.programWallet = programWallet;
    this.admin = await generateFundedKeypair();
    this.generateFundedKeypair = generateFundedKeypair;
    programInfoPDA = await initializeProgramInfo(this.admin);
    this.programInfoPDA = programInfoPDA;
  });

  it("Initializes Vault Program Info!", async function () {
    const programInfo = await program.account.programInfo.fetch(
      this.programInfoPDA
    );

    expect(programInfo.vaultsCount).to.eql(0);

    // will only for the first time unless admin key is stored
    expect(programInfo.admin.toString()).to.eql(
      this.admin.publicKey.toString()
    );
  });

  describe("Vault", vault.bind(this)); // execute the vault suite

  async function initializeProgramInfo(admin: Keypair) {
    const [newProgramInfoPDA, _bump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [encode("program_info")],
        program.programId
      );

    const programInfo = await program.account.programInfo.fetchNullable(
      newProgramInfoPDA
    );

    if (programInfo === null) {
      const _tx = await program.methods
        .initialiseProgramInfo()
        .accounts({
          payer: admin.publicKey,
          programInfo: newProgramInfoPDA,
        })
        .signers([admin])
        .rpc();
    } else {
      // can deposit some SPL tokens to any vaults to test out things...
    }

    return newProgramInfoPDA;
  }

  async function generateFundedKeypair(): Promise<anchor.web3.Keypair> {
    const newKeypair = anchor.web3.Keypair.generate();

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: programWallet.publicKey,
        toPubkey: newKeypair.publicKey,
        lamports: 5 * LAMPORTS_PER_SOL,
      })
    );

    await (program.provider as anchor.AnchorProvider).sendAndConfirm(
      transaction
    );

    return newKeypair;
  }
});
