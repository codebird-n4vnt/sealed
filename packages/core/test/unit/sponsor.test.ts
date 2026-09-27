import { getCreateAccountInstruction, getTransferSolInstruction } from '@solana-program/system';
import {
  ExtensionType,
  getApplyConfidentialPendingBalanceInstruction,
  getConfigureConfidentialTransferAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
  getReallocateInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionEncoder,
  getU64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  checkSponsoredTransaction,
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  SponsorPolicyError,
  ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  type SponsorPolicy,
} from '../../src/sponsor';

let policy: SponsorPolicy;
let sponsor: Address, owner: Address, token: Address, mint: Address, stranger: Address, context: Address;

beforeAll(async () => {
  [sponsor, owner, token, mint, stranger, context] = (
    await Promise.all(Array.from({ length: 6 }, () => generateKeyPairSigner()))
  ).map(signer => signer.address) as [Address, Address, Address, Address, Address, Address];
  policy = { sponsor, owner, token, mint };
});

function wire(instructions: Instruction[], feePayer: Address = sponsor) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    m => setTransactionMessageFeePayer(feePayer, m),
    m => setTransactionMessageLifetimeUsingBlockhash(
      { blockhash: '11111111111111111111111111111111' as Blockhash, lastValidBlockHeight: 0n },
      m,
    ),
    m => appendTransactionMessageInstructions(instructions, m),
  );
  return getTransactionEncoder().encode(compileTransaction(message));
}

const signer = (address: Address) => createNoopSigner(address);
const rent = (space: number) => BigInt((128 + space) * 6_960);

const createContextAccount = (overrides: { lamports?: bigint; programAddress?: Address; payer?: Address } = {}) =>
  getCreateAccountInstruction({
    payer: signer(overrides.payer ?? sponsor),
    newAccount: signer(context),
    lamports: overrides.lamports ?? rent(200),
    space: 200,
    programAddress: overrides.programAddress ?? ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  });

const verifyIntoContext = (authority: Address = sponsor): Instruction => ({
  programAddress: ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  accounts: [
    { address: context, role: AccountRole.WRITABLE },
    { address: authority, role: AccountRole.READONLY },
  ],
  data: new Uint8Array([3, ...new Uint8Array(64)]), // VerifyCiphertextCommitmentEquality
});

const closeContext = (destination: Address = sponsor): Instruction => ({
  programAddress: ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  accounts: [
    { address: context, role: AccountRole.WRITABLE },
    { address: destination, role: AccountRole.WRITABLE },
    { address: sponsor, role: AccountRole.READONLY_SIGNER },
  ],
  data: new Uint8Array([0]),
});

const applyPending = (account: Address = token) =>
  getApplyConfidentialPendingBalanceInstruction({
    token: account,
    authority: signer(owner),
    expectedPendingBalanceCreditCounter: 1n,
    newDecryptableAvailableBalance: new Uint8Array(36),
  });

const computeUnitPrice = (microLamports: bigint): Instruction => ({
  programAddress: COMPUTE_BUDGET_PROGRAM_ADDRESS,
  data: new Uint8Array([3, ...getU64Encoder().encode(microLamports)]),
});

describe('checkSponsoredTransaction allows the employee flows', () => {
  it('account setup: create token account, reallocate, configure, inline pubkey proof', () => {
    const tx = wire([
      getCreateAssociatedTokenIdempotentInstruction({ ata: token, mint, owner, payer: signer(sponsor), tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }),
      getReallocateInstruction({ token, payer: signer(sponsor), owner: signer(owner), newExtensionTypes: [ExtensionType.ConfidentialTransferAccount] }),
      getConfigureConfidentialTransferAccountInstruction({
        token,
        mint,
        authority: signer(owner),
        decryptableZeroBalance: new Uint8Array(36),
        maximumPendingBalanceCreditCounter: 65_536n,
        proofInstructionOffset: 1,
      }),
      { programAddress: ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS, data: new Uint8Array([4, ...new Uint8Array(96)]) },
    ]);
    expect(() => checkSponsoredTransaction(tx, policy)).not.toThrow();
  });

  it('collecting pay', () => {
    expect(() => checkSponsoredTransaction(wire([applyPending()]), policy)).not.toThrow();
  });

  it('proof setup and cleanup with the company as context authority', () => {
    expect(() => checkSponsoredTransaction(wire([createContextAccount(), verifyIntoContext()]), policy)).not.toThrow();
    expect(() => checkSponsoredTransaction(wire([closeContext()]), policy)).not.toThrow();
  });

  it('a large proof\'s account created and verified in separate transactions', () => {
    expect(() => checkSponsoredTransaction(wire([createContextAccount()]), policy)).not.toThrow();
    expect(() => checkSponsoredTransaction(wire([verifyIntoContext()]), policy)).not.toThrow();
  });

  it('a modest priority fee', () => {
    expect(() => checkSponsoredTransaction(wire([computeUnitPrice(5_000n), applyPending()]), policy)).not.toThrow();
  });
});

describe('checkSponsoredTransaction refuses', () => {
  const refuses = (instructions: Instruction[], reason: RegExp, feePayer?: Address) => {
    expect(() => checkSponsoredTransaction(wire(instructions, feePayer), policy)).toThrow(SponsorPolicyError);
    expect(() => checkSponsoredTransaction(wire(instructions, feePayer), policy)).toThrow(reason);
  };

  it('a different fee payer', () => refuses([applyPending()], /fee payer/, stranger));

  it('moving the company SOL', () =>
    refuses([getTransferSolInstruction({ source: signer(sponsor), destination: stranger, amount: 1n })], /only CreateAccount/));

  it('minting with the company as mint authority', () =>
    refuses([getMintToInstruction({ mint, token, mintAuthority: signer(sponsor), amount: 1n })], /Token-2022 instruction 7/));

  it('touching someone else\'s token account', () => refuses([applyPending(stranger)], /employee's own token account/));

  it('creating a token account for another owner or mint', () =>
    refuses(
      [getCreateAssociatedTokenIdempotentInstruction({ ata: token, mint: stranger, owner, payer: signer(sponsor), tokenProgram: TOKEN_2022_PROGRAM_ADDRESS })],
      /own token account/,
    ));

  it('overfunding a new account', () =>
    refuses([createContextAccount({ lamports: rent(200) + 1n }), verifyIntoContext()], /more lamports than rent/));

  it('creating accounts owned by other programs', () =>
    refuses([createContextAccount({ programAddress: TOKEN_2022_PROGRAM_ADDRESS }), verifyIntoContext()], /ZK proof context/));

  it('more than two new accounts in one transaction', async () => {
    const accounts = await Promise.all([1, 2, 3].map(() => generateKeyPairSigner()));
    refuses(
      accounts.map(newAccount =>
        getCreateAccountInstruction({ payer: signer(sponsor), newAccount, lamports: rent(200), space: 200, programAddress: ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS }),
      ),
      /too many new accounts/,
    );
  });

  it('proof contexts someone else can close', () =>
    refuses([createContextAccount(), verifyIntoContext(stranger)], /context authority/));

  it('sending proof rent anywhere but the company', () => refuses([closeContext(stranger)], /rent must return/));

  it('an excessive priority fee', () => refuses([computeUnitPrice(10_000_000n), applyPending()], /priority fee/));

  it('unknown programs', async () => {
    const program = (await generateKeyPairSigner()).address;
    refuses([{ programAddress: program, data: new Uint8Array([1]) }], /not allowed/);
  });
});
