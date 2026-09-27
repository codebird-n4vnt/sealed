import {
  CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  fetchMaybeToken,
  fetchToken,
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Extension,
  type Token,
} from '@solana-program/token-2022';
import {
  getApplyConfidentialPendingBalanceInstructionFromToken,
  getCreateConfidentialTransferAccountInstructionPlan,
} from '@solana-program/token-2022/confidential';
import {
  flattenTransactionPlanResult,
  isSome,
  type Address,
  type Instruction,
  type ReadonlyUint8Array,
  type Signature,
  type TransactionPlanResult,
  type TransactionSigner,
} from '@solana/kit';

import type { SealedClient } from './client';
import type { ConfidentialKeys } from './keys';

/** The owner's Token-2022 associated token account for `mint`. Sealed uses one per wallet. */
export async function tokenAccountAddress(owner: Address, mint: Address): Promise<Address> {
  const [token] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  return token;
}

type ConfidentialTransferAccount = Extract<Extension, { __kind: 'ConfidentialTransferAccount' }>;

/** The account's confidential-transfer state (encryption key, ciphertexts, counters), if configured. */
export function confidentialState(token: Token): ConfidentialTransferAccount | undefined {
  if (!isSome(token.extensions)) return undefined;
  return token.extensions.value.find(
    (e): e is ConfidentialTransferAccount => e.__kind === 'ConfidentialTransferAccount',
  );
}

/**
 * Creates the owner's token account and configures it for confidential transfers, with the
 * client's fee payer covering fees and rent. Only the owner can sign this, because it
 * registers the owner's encryption key. Does nothing if the account is already configured.
 */
export async function setupConfidentialAccount(
  client: SealedClient,
  input: { owner: TransactionSigner; mint: Address; keys: ConfidentialKeys },
): Promise<Address> {
  const token = await tokenAccountAddress(input.owner.address, input.mint);
  const existing = await fetchMaybeToken(client.rpc, token);
  if (existing.exists && confidentialState(existing.data)) return token;

  await client.sendTransactions(
    await getCreateConfidentialTransferAccountInstructionPlan({
      payer: client.payer,
      owner: input.owner,
      mint: input.mint,
      rpc: client.rpc,
      elgamalKeypair: input.keys.elgamal,
      aesKey: input.keys.ae,
    }),
  );
  return token;
}

/**
 * Moves the owner's pending confidential balance (deposits and incoming payments) into the
 * available balance, so it can be transferred or withdrawn. Returns null if nothing was pending.
 */
export async function applyPendingBalance(
  client: SealedClient,
  input: { owner: TransactionSigner; mint: Address; keys: ConfidentialKeys },
): Promise<Signature | null> {
  const token = await tokenAccountAddress(input.owner.address, input.mint);
  const { data: tokenAccount } = await fetchToken(client.rpc, token);
  const state = confidentialState(tokenAccount);
  if (!state) throw new Error(`Token account ${token} is not configured for confidential transfers.`);
  if (state.pendingBalanceCreditCounter === 0n) return null;

  const result = await client.sendTransaction(
    getApplyConfidentialPendingBalanceInstructionFromToken({
      token,
      tokenAccount,
      authority: input.owner,
      elgamalSecretKey: input.keys.elgamal.secret(),
      aesKey: input.keys.ae,
    }),
  );
  return result.context.signature;
}

/**
 * All confidential-transfer instructions share Token-2022's extension prefix byte and are told
 * apart by the second byte, e.g. CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR.
 */
export function isConfidentialInstructionData(data: ReadonlyUint8Array | undefined, kind: number): boolean {
  return data?.[0] === CONFIDENTIAL_TRANSFER_DISCRIMINATOR && data[1] === kind;
}

/**
 * The signature of the transaction in `result` that carries the confidential instruction of
 * `kind`. Proof plans send several transactions (proof setup, the instruction, cleanup), and
 * this is the one worth showing and auditing.
 */
export function signatureOfConfidentialInstruction(result: TransactionPlanResult, kind: number): Signature {
  const matches = (instruction: Instruction) =>
    instruction.programAddress === TOKEN_2022_PROGRAM_ADDRESS && isConfidentialInstructionData(instruction.data, kind);
  for (const single of flattenTransactionPlanResult(result)) {
    if (single.status === 'successful' && single.plannedMessage.instructions.some(matches)) {
      return single.context.signature;
    }
  }
  throw new Error('No sent transaction carries the expected confidential instruction.');
}
