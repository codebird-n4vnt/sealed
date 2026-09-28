/**
 * One-transaction confidential transfers and withdrawals, for the v1 transaction format (up to
 * 4,096 bytes; create the client with `transactionVersion: 1`).
 *
 * The standard flow verifies each proof into a context account in its own transaction, then
 * transfers and closes the accounts. Here the proofs are verified inline in the same transaction
 * as the transfer, which reads them through the instructions sysvar. No proof accounts are
 * created, so there is no rent to fund or reclaim, and a payment is a single transaction.
 *
 * The proofs come from the library's inline-proof plans, because its proof construction isn't
 * exported. This takes the proofs out of such a plan and rebuilds the instructions around them.
 * It throws if a plan holds anything it doesn't recognise, rather than guess.
 */
import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  CONFIDENTIAL_WITHDRAW_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  getConfidentialTransferInstruction,
  getConfidentialTransferInstructionDataDecoder,
  getConfidentialWithdrawInstruction,
  getConfidentialWithdrawInstructionDataDecoder,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import {
  flattenInstructionPlan,
  getAddressDecoder,
  getU32Decoder,
  type AccountMeta,
  type AccountSignerMeta,
  type Address,
  type Instruction,
  type InstructionPlan,
  type ReadonlyUint8Array,
} from '@solana/kit';

import { isConfidentialInstructionData } from './accounts';
import { SYSTEM_PROGRAM_ADDRESS, ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS } from './sponsor';

export const INSTRUCTIONS_SYSVAR_ADDRESS = 'Sysvar1nstructions1111111111111111111111111' as Address;

// ZK ElGamal proof program instructions.
const ZK_CLOSE_CONTEXT_STATE = 0;
export const ZK_VERIFY_CIPHERTEXT_COMMITMENT_EQUALITY = 3;
export const ZK_VERIFY_BATCHED_RANGE_PROOF_U64 = 6;
export const ZK_VERIFY_BATCHED_RANGE_PROOF_U128 = 7;
export const ZK_VERIFY_BATCHED_GROUPED_CIPHERTEXT_3_HANDLES_VALIDITY = 12;
const SYSTEM_CREATE_ACCOUNT = 0;

type Parts = { verifies: Map<number, ReadonlyUint8Array>; main?: Instruction };

/**
 * An RPC for building a plan that will be repacked. Rent lookups are answered locally (with 0),
 * because the proof context accounts they're for are dropped; everything else goes to `rpc`.
 * Saves a round trip per proof.
 */
export function planningRpc<TRpc extends object>(rpc: TRpc): TRpc {
  return new Proxy(rpc, {
    get: (target, property) =>
      property === 'getMinimumBalanceForRentExemption'
        ? () => ({ send: async () => 0n })
        : Reflect.get(target, property),
  });
}

/** Sorts a plan's instructions into proof data and the one Token-2022 instruction. */
function takeApart(plan: InstructionPlan, mainKind: number, verifyKinds: number[]): Parts {
  const parts: Parts = { verifies: new Map() };
  const leaves = flattenInstructionPlan(plan);
  // Record writes are packed across transactions; one-transaction delivery has no records.
  if (leaves.some(leaf => leaf.kind !== 'single')) throw new Error('Plans that stage proofs in record accounts cannot be repacked.');
  for (const leaf of leaves) {
    if (leaf.kind !== 'single') continue;
    const { instruction } = leaf;
    const data = instruction.data ?? new Uint8Array();

    if (instruction.programAddress === SYSTEM_PROGRAM_ADDRESS) {
      // Only the creation of proof context accounts, which inline verification doesn't need.
      const createsContextAccount =
        data.length === 52 &&
        getU32Decoder().decode(data) === SYSTEM_CREATE_ACCOUNT &&
        getAddressDecoder().decode(data.slice(20, 52)) === ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS;
      if (!createsContextAccount) throw new Error('Unexpected System instruction in the plan.');
    } else if (instruction.programAddress === ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS) {
      const kind = data[0] ?? -1;
      if (kind === ZK_CLOSE_CONTEXT_STATE) continue;
      if (!verifyKinds.includes(kind)) throw new Error(`Unexpected ZK proof instruction ${kind} in the plan.`);
      // A 5-byte instruction reads its proof from an account; inline ones carry it.
      if (data.length <= 5) throw new Error('The plan reads a proof from an account; expected inline proofs.');
      if (parts.verifies.has(kind)) throw new Error(`The plan verifies proof ${kind} twice.`);
      parts.verifies.set(kind, data);
    } else if (instruction.programAddress === TOKEN_2022_PROGRAM_ADDRESS && isConfidentialInstructionData(data, mainKind)) {
      if (parts.main) throw new Error('The plan holds two Token-2022 instructions.');
      parts.main = instruction;
    } else {
      throw new Error(`Unexpected instruction for program ${instruction.programAddress} in the plan.`);
    }
  }
  for (const kind of verifyKinds) {
    if (!parts.verifies.has(kind)) throw new Error(`The plan has no proof ${kind}.`);
  }
  if (!parts.main) throw new Error('The plan has no Token-2022 instruction.');
  return parts;
}

/** An inline, verify-only proof instruction: no context account, nothing to close. */
const verifyInline = (data: ReadonlyUint8Array): Instruction => ({
  programAddress: ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  accounts: [],
  data,
});

/** The account's signer if the plan attached one, so the client can sign with it. */
const signerOrAddress = (meta: AccountMeta | undefined) => {
  if (!meta) throw new Error('The Token-2022 instruction is missing its authority.');
  return 'signer' in meta ? (meta as AccountSignerMeta).signer : meta.address;
};

/**
 * Repacks a `getConfidentialTransferInstructionPlan` plan (inline proofs, not the record variant)
 * into one transaction: the equality, ciphertext-validity and range verifications, then the
 * transfer reading them at offsets -3, -2 and -1.
 */
export function oneTransactionTransfer(plan: InstructionPlan): Instruction[] {
  const { verifies, main } = takeApart(plan, CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR, [
    ZK_VERIFY_CIPHERTEXT_COMMITMENT_EQUALITY,
    ZK_VERIFY_BATCHED_GROUPED_CIPHERTEXT_3_HANDLES_VALIDITY,
    ZK_VERIFY_BATCHED_RANGE_PROOF_U128,
  ]);
  // With context accounts: source, mint, destination, equality, validity, range, authority.
  const accounts = main!.accounts ?? [];
  if (accounts.length !== 7) throw new Error('Expected a single-signer transfer that reads proof context accounts.');
  const decoded = getConfidentialTransferInstructionDataDecoder().decode(main!.data!);
  return [
    verifyInline(verifies.get(ZK_VERIFY_CIPHERTEXT_COMMITMENT_EQUALITY)!),
    verifyInline(verifies.get(ZK_VERIFY_BATCHED_GROUPED_CIPHERTEXT_3_HANDLES_VALIDITY)!),
    verifyInline(verifies.get(ZK_VERIFY_BATCHED_RANGE_PROOF_U128)!),
    getConfidentialTransferInstruction(
      {
        sourceToken: accounts[0]!.address,
        mint: accounts[1]!.address,
        destinationToken: accounts[2]!.address,
        instructionsSysvar: INSTRUCTIONS_SYSVAR_ADDRESS,
        authority: signerOrAddress(accounts[6]),
        newSourceDecryptableAvailableBalance: decoded.newSourceDecryptableAvailableBalance,
        transferAmountAuditorCiphertextLo: decoded.transferAmountAuditorCiphertextLo,
        transferAmountAuditorCiphertextHi: decoded.transferAmountAuditorCiphertextHi,
        equalityProofInstructionOffset: -3,
        ciphertextValidityProofInstructionOffset: -2,
        rangeProofInstructionOffset: -1,
      },
      { programAddress: main!.programAddress },
    ),
  ];
}

/**
 * Repacks a `getConfidentialWithdrawInstructionPlan` plan (inline proofs) into one transaction:
 * the equality and range verifications, then the withdraw reading them at offsets -2 and -1.
 */
export function oneTransactionWithdraw(plan: InstructionPlan): Instruction[] {
  const { verifies, main } = takeApart(plan, CONFIDENTIAL_WITHDRAW_CONFIDENTIAL_TRANSFER_DISCRIMINATOR, [
    ZK_VERIFY_CIPHERTEXT_COMMITMENT_EQUALITY,
    ZK_VERIFY_BATCHED_RANGE_PROOF_U64,
  ]);
  // With context accounts: token, mint, equality, range, authority.
  const accounts = main!.accounts ?? [];
  if (accounts.length !== 5) throw new Error('Expected a single-signer withdraw that reads proof context accounts.');
  const decoded = getConfidentialWithdrawInstructionDataDecoder().decode(main!.data!);
  return [
    verifyInline(verifies.get(ZK_VERIFY_CIPHERTEXT_COMMITMENT_EQUALITY)!),
    verifyInline(verifies.get(ZK_VERIFY_BATCHED_RANGE_PROOF_U64)!),
    getConfidentialWithdrawInstruction(
      {
        token: accounts[0]!.address,
        mint: accounts[1]!.address,
        instructionsSysvar: INSTRUCTIONS_SYSVAR_ADDRESS,
        authority: signerOrAddress(accounts[4]),
        amount: decoded.amount,
        decimals: decoded.decimals,
        newDecryptableAvailableBalance: decoded.newDecryptableAvailableBalance,
        equalityProofInstructionOffset: -2,
        rangeProofInstructionOffset: -1,
      },
      { programAddress: main!.programAddress },
    ),
  ];
}
