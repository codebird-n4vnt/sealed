import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  getConfidentialTransferInstructionDataDecoder,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { getBase58Encoder, type Address, type Signature } from '@solana/kit';

import { isConfidentialInstructionData } from './accounts';
import type { SealedClient } from './client';
import { ZK_VERIFY_BATCHED_GROUPED_CIPHERTEXT_3_HANDLES_VALIDITY } from './one-transaction';
import { ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS } from './sponsor';

/**
 * Retries a chain read. Public RPCs (devnet especially) intermittently fail history queries,
 * e.g. "Failed to query long-term storage", and rate-limit bursts in 10-second windows, so the
 * backoff (1, 2, 4, 8, 8 seconds) outlasts a window. Reads are safe to repeat.
 */
export async function withReadRetry<T>(read: () => Promise<T>, attempts = 6): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(1_000 * 2 ** (attempt - 1), 8_000)));
    }
  }
}

export type DecodedInstruction = { programAddress: Address; accounts: Address[]; data: Uint8Array };

export type DecodedTransaction = {
  signature: Signature;
  slot: bigint;
  blockTime: bigint | null;
  instructions: DecodedInstruction[];
};

/**
 * Somewhere to keep decoded transactions between reads (e.g. the browser's storage). Transactions
 * never change, and public RPCs strictly rate-limit history reads, so a cache saves most of them.
 * Only finalized transactions are stored, so a transaction dropped with a fork can't linger.
 */
export type TransactionCache = {
  get(signature: Signature): DecodedTransaction | undefined;
  set(signature: Signature, transaction: DecodedTransaction): void;
};

export type HistoryReadOptions = {
  cache?: TransactionCache;
  /** Called after each transaction is read: how many are done, out of how many. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
};

/** Fetches a confirmed transaction with its top-level instructions resolved to addresses. */
export async function fetchDecodedTransaction(client: SealedClient, signature: Signature): Promise<DecodedTransaction> {
  // A just-confirmed transaction can take a moment to be served, so "not found" is retried too.
  const transaction = await withReadRetry(async () => {
    const result = await client.rpc
      .getTransaction(signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' })
      .send();
    if (!result) throw new Error(`Transaction ${signature} not found.`);
    return result;
  });

  const { message } = transaction.transaction;
  const loaded = transaction.meta?.loadedAddresses;
  const keys = [...message.accountKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
  const key = (index: number) => {
    const address = keys[index];
    if (!address) throw new Error(`Transaction ${signature} references a missing account.`);
    return address;
  };
  const base58 = getBase58Encoder();

  return {
    signature,
    slot: transaction.slot,
    blockTime: transaction.blockTime,
    instructions: message.instructions.map(instruction => ({
      programAddress: key(instruction.programIdIndex),
      accounts: instruction.accounts.map(key),
      data: new Uint8Array(base58.encode(instruction.data)),
    })),
  };
}

export type ConfidentialTransferRecord = {
  signature: Signature;
  slot: bigint;
  blockTime: bigint | null;
  sourceToken: Address;
  destinationToken: Address;
  /** Transfer instruction data; carries the amount encrypted to the mint's auditor. */
  data: Uint8Array;
  /**
   * The ciphertext-validity proof context account, when proofs were verified into context
   * accounts. Its proof holds the amount encrypted to the recipient.
   */
  ciphertextValidityContext?: Address;
  /**
   * The ciphertext-validity proof instruction's data, when the proof was verified inline in the
   * same transaction (one-transaction transfers). It holds the amount encrypted to the recipient.
   */
  ciphertextValidityProof?: Uint8Array;
};

/** Confidential transfer instructions in a transaction. */
export function confidentialTransfersIn(transaction: DecodedTransaction): ConfidentialTransferRecord[] {
  return transaction.instructions.flatMap(({ programAddress, accounts, data }, position) => {
    if (programAddress !== TOKEN_2022_PROGRAM_ADDRESS) return [];
    if (!isConfidentialInstructionData(data, CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR)) return [];
    // Accounts: source, mint, destination, then either the three proof context accounts and the
    // authority (7 in total) or the instructions sysvar for inline proofs.
    const [sourceToken, , destinationToken] = accounts;
    if (!sourceToken || !destinationToken) return [];
    // An inline proof sits in a sibling instruction, at the offset the transfer names.
    const offset = getConfidentialTransferInstructionDataDecoder().decode(data).ciphertextValidityProofInstructionOffset;
    const sibling = offset !== 0 ? transaction.instructions[position + offset] : undefined;
    const inlineProof =
      sibling?.programAddress === ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS &&
      sibling.data[0] === ZK_VERIFY_BATCHED_GROUPED_CIPHERTEXT_3_HANDLES_VALIDITY
        ? sibling.data
        : undefined;
    return [
      {
        signature: transaction.signature,
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        sourceToken,
        destinationToken,
        data,
        ...(accounts.length === 7 && accounts[4] ? { ciphertextValidityContext: accounts[4] } : {}),
        ...(inlineProof ? { ciphertextValidityProof: inlineProof } : {}),
      },
    ];
  });
}

/** Every confidential transfer into or out of `tokenAccount`, newest first. */
export async function fetchConfidentialTransfers(
  client: SealedClient,
  input: { tokenAccount: Address; limit?: number } & HistoryReadOptions,
): Promise<ConfidentialTransferRecord[]> {
  const signatures = await withReadRetry(() =>
    client.rpc.getSignaturesForAddress(input.tokenAccount, { limit: input.limit ?? 100, commitment: 'confirmed' }).send(),
  );
  const landed = signatures.filter(({ err }) => !err);
  const transfers: ConfidentialTransferRecord[] = [];
  for (const [index, { signature, confirmationStatus }] of landed.entries()) {
    input.signal?.throwIfAborted();
    let transaction = input.cache?.get(signature);
    if (!transaction) {
      transaction = await fetchDecodedTransaction(client, signature);
      if (confirmationStatus === 'finalized') input.cache?.set(signature, transaction);
    }
    transfers.push(...confidentialTransfersIn(transaction));
    input.onProgress?.(index + 1, landed.length);
  }
  return transfers;
}
