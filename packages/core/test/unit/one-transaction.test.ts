/**
 * One-transaction transfers and withdrawals, checked without a cluster: real plans from the
 * library (synthetic keys and balances), repacked, then checked for what the chain will check.
 */
import { getTransferSolInstruction } from '@solana-program/system';
import {
  AccountState,
  getConfidentialTransferInstructionDataDecoder,
  getConfidentialWithdrawInstructionDataDecoder,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Token,
} from '@solana-program/token-2022';
import {
  getConfidentialTransferInstructionPlan,
  getConfidentialWithdrawInstructionPlan,
  getConfidentialWithdrawWithRecordInstructionPlan,
} from '@solana-program/token-2022/confidential';
import { verifyCiphertextCommitmentEquality } from '@solana-program/zk-elgamal-proof';
import {
  AccountRole,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressDecoder,
  getTransactionEncoder,
  getTransactionSize,
  none,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessagePriorityFeeLamports,
  some,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type TransactionMessage,
} from '@solana/kit';
import {
  AeKey,
  BatchedGroupedCiphertext3HandlesValidityProofData,
  BatchedRangeProofU128Data,
  BatchedRangeProofU64Data,
  CiphertextCommitmentEqualityProofData,
  ElGamalKeypair,
  PedersenOpening,
} from '@solana/zk-sdk/bundler';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  checkSponsoredTransaction,
  confidentialTransfersIn,
  decryptAuditorAmount,
  decryptValidityProofAmount,
  INSTRUCTIONS_SYSVAR_ADDRESS,
  oneTransactionTransfer,
  oneTransactionWithdraw,
  SponsorPolicyError,
  ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  type DecodedTransaction,
} from '../../src';

const BALANCE = 150_000_000_000n; // 150,000 at 6 decimals
const AMOUNT = 4_200_000_000n;
const WITHDRAW = 1_000_000_000n;

const toAddress = (bytes: Uint8Array) => getAddressDecoder().decode(bytes);
// Only context-account rent needs RPC; the repacked transaction drops those accounts.
const rpc = { getMinimumBalanceForRentExemption: () => ({ send: async () => 1_000_000n }) } as never;

const sender = new ElGamalKeypair();
const senderAes = new AeKey();
const recipient = new ElGamalKeypair();
const auditor = new ElGamalKeypair();

/** A token account holding BALANCE in its available confidential balance. */
function tokenAccount(owner: Address, mint: Address): Token {
  const zeros = new Uint8Array(64);
  return {
    mint,
    owner,
    amount: 0n,
    delegate: none(),
    state: AccountState.Initialized,
    isNative: none(),
    delegatedAmount: 0n,
    closeAuthority: none(),
    extensions: some([
      {
        __kind: 'ConfidentialTransferAccount',
        approved: true,
        elgamalPubkey: toAddress(sender.pubkey().toBytes()),
        pendingBalanceLow: zeros,
        pendingBalanceHigh: zeros,
        availableBalance: sender.pubkey().encryptWith(BALANCE, new PedersenOpening()).toBytes(),
        decryptableAvailableBalance: senderAes.encrypt(BALANCE).toBytes(),
        allowConfidentialCredits: true,
        allowNonConfidentialCredits: true,
        pendingBalanceCreditCounter: 0n,
        maximumPendingBalanceCreditCounter: 65_536n,
        expectedPendingBalanceCreditCounter: 0n,
        actualPendingBalanceCreditCounter: 0n,
      },
    ]),
  } as Token;
}

function v1Message(feePayer: KeyPairSigner, instructions: Instruction[]) {
  return pipe(
    createTransactionMessage({ version: 1 }),
    m => setTransactionMessageFeePayerSigner(feePayer, m),
    m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 0n }, m),
    m => appendTransactionMessageInstructions(instructions, m),
  );
}

const wire = (message: TransactionMessage & Parameters<typeof compileTransaction>[0]) =>
  new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));

/** What an RPC `getTransaction` decode would give for these instructions. */
const asDecoded = (instructions: Instruction[]): DecodedTransaction => ({
  signature: '1111111111111111111111111111111111111111111111111111111111111111' as never,
  slot: 1n,
  blockTime: null,
  instructions: instructions.map(({ programAddress, accounts, data }) => ({
    programAddress,
    accounts: (accounts ?? []).map(meta => meta.address),
    data: new Uint8Array(data ?? []),
  })),
});

let company: KeyPairSigner;
let employee: KeyPairSigner;
let mint: Address;
let source: Address;
let destination: Address;

beforeAll(async () => {
  [company, employee] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
  const [mintSigner, sourceSigner, destinationSigner] = await Promise.all([
    generateKeyPairSigner(),
    generateKeyPairSigner(),
    generateKeyPairSigner(),
  ]);
  [mint, source, destination] = [mintSigner.address, sourceSigner.address, destinationSigner.address];
});

describe('one-transaction transfer', () => {
  const transferPlan = () =>
    getConfidentialTransferInstructionPlan({
      payer: company,
      rpc,
      mint,
      sourceToken: source,
      sourceTokenAccount: tokenAccount(company.address, mint),
      destinationToken: destination,
      destinationElgamalPubkey: toAddress(recipient.pubkey().toBytes()),
      auditorElgamalPubkey: toAddress(auditor.pubkey().toBytes()),
      authority: company,
      amount: AMOUNT,
      sourceElgamalKeypair: sender,
      aesKey: senderAes,
    });

  it('is three inline verifications, then the transfer reading them through the sysvar', async () => {
    const instructions = oneTransactionTransfer(await transferPlan());
    expect(instructions.map(i => [i.programAddress, i.data?.[0], i.accounts?.length ?? 0])).toEqual([
      [ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS, 3, 0],
      [ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS, 12, 0],
      [ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS, 7, 0],
      [TOKEN_2022_PROGRAM_ADDRESS, 27, 5],
    ]);
    const transfer = instructions[3]!;
    expect(transfer.accounts!.map(meta => meta.address)).toEqual([source, mint, destination, INSTRUCTIONS_SYSVAR_ADDRESS, company.address]);
    expect(transfer.accounts![4]!.role).toBe(AccountRole.READONLY_SIGNER);
    const data = getConfidentialTransferInstructionDataDecoder().decode(transfer.data!);
    expect([data.equalityProofInstructionOffset, data.ciphertextValidityProofInstructionOffset, data.rangeProofInstructionOffset]).toEqual([-3, -2, -1]);
  });

  it('builds the same verify instruction as the library does without a context account', async () => {
    const [equality] = oneTransactionTransfer(await transferPlan());
    const [expected] = await verifyCiphertextCommitmentEquality({ rpc, payer: company, proofData: equality!.data!.slice(1) });
    expect(equality).toEqual(expected);
  });

  it('carries proofs that verify', async () => {
    const [equality, validity, range] = oneTransactionTransfer(await transferPlan());
    expect(() => CiphertextCommitmentEqualityProofData.fromBytes(new Uint8Array(equality!.data!.slice(1))).verify()).not.toThrow();
    expect(() => BatchedGroupedCiphertext3HandlesValidityProofData.fromBytes(new Uint8Array(validity!.data!.slice(1))).verify()).not.toThrow();
    expect(() => BatchedRangeProofU128Data.fromBytes(new Uint8Array(range!.data!.slice(1))).verify()).not.toThrow();
  });

  it('fits one v1 transaction, and not a legacy one', async () => {
    const size = getTransactionSize(compileTransaction(v1Message(company, oneTransactionTransfer(await transferPlan()))));
    expect(size).toBeLessThanOrEqual(4_096);
    expect(size).toBeGreaterThan(1_232);
  });

  it('lets the recipient and the accountant decrypt the amount from the transaction', async () => {
    const [record] = confidentialTransfersIn(asDecoded(oneTransactionTransfer(await transferPlan())));
    expect(record).toMatchObject({ sourceToken: source, destinationToken: destination });
    expect(record!.ciphertextValidityContext).toBeUndefined();
    expect(decryptValidityProofAmount(record!.ciphertextValidityProof!, recipient.secret())).toBe(AMOUNT);
    expect(decryptAuditorAmount(record!.data, auditor.secret())).toBe(AMOUNT);
  });
});

describe('one-transaction withdraw', () => {
  const withdrawInput = () => ({
    payer: company,
    rpc,
    token: source,
    mint,
    tokenAccount: tokenAccount(employee.address, mint),
    authority: employee,
    amount: WITHDRAW,
    decimals: 6,
    elgamalKeypair: sender,
    aesKey: senderAes,
  });
  const policy = () => ({ sponsor: company.address, owner: employee.address, token: source, mint });

  it('is two inline verifications, then the withdraw reading them through the sysvar', async () => {
    const instructions = oneTransactionWithdraw(await getConfidentialWithdrawInstructionPlan(withdrawInput()));
    expect(instructions.map(i => [i.programAddress, i.data?.[0], i.accounts?.length ?? 0])).toEqual([
      [ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS, 3, 0],
      [ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS, 6, 0],
      [TOKEN_2022_PROGRAM_ADDRESS, 27, 4],
    ]);
    const withdraw = instructions[2]!;
    expect(withdraw.accounts!.map(meta => meta.address)).toEqual([source, mint, INSTRUCTIONS_SYSVAR_ADDRESS, employee.address]);
    const data = getConfidentialWithdrawInstructionDataDecoder().decode(withdraw.data!);
    expect(data).toMatchObject({ amount: WITHDRAW, decimals: 6, equalityProofInstructionOffset: -2, rangeProofInstructionOffset: -1 });
    expect(() => CiphertextCommitmentEqualityProofData.fromBytes(new Uint8Array(instructions[0]!.data!.slice(1))).verify()).not.toThrow();
    expect(() => BatchedRangeProofU64Data.fromBytes(new Uint8Array(instructions[1]!.data!.slice(1))).verify()).not.toThrow();
  });

  it('passes the sponsor policy as a v1 transaction, funding no accounts', async () => {
    const instructions = oneTransactionWithdraw(await getConfidentialWithdrawInstructionPlan(withdrawInput()));
    expect(checkSponsoredTransaction(wire(v1Message(company, instructions)), policy())).toEqual({ newAccounts: 0 });
  });

  it('is refused with a priority fee above the cap', async () => {
    const instructions = oneTransactionWithdraw(await getConfidentialWithdrawInstructionPlan(withdrawInput()));
    const message = setTransactionMessagePriorityFeeLamports(1_000_000n, v1Message(company, instructions));
    expect(() => checkSponsoredTransaction(wire(message), policy())).toThrow(SponsorPolicyError);
  });

  it('is refused with anything extra that spends the company SOL', async () => {
    const instructions = oneTransactionWithdraw(await getConfidentialWithdrawInstructionPlan(withdrawInput()));
    const drain = getTransferSolInstruction({ source: company, destination: employee.address, amount: 1_000_000_000n });
    expect(() => checkSponsoredTransaction(wire(v1Message(company, [...instructions, drain])), policy())).toThrow(/System program/);
  });

  it('refuses to repack a plan that stages proofs in record accounts', async () => {
    const plan = await getConfidentialWithdrawWithRecordInstructionPlan(withdrawInput());
    expect(() => oneTransactionWithdraw(plan)).toThrow(/record accounts/);
  });
});
