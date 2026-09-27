import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { getBase58Encoder, type Address, type Signature } from '@solana/kit';

import { isConfidentialInstructionData } from './accounts';
import type { SealedClient } from './client';

export type DecodedInstruction = { programAddress: Address; accounts: Address[]; data: Uint8Array };

export type DecodedTransaction = {
  signature: Signature;
  slot: bigint;
  blockTime: bigint | null;
  instructions: DecodedInstruction[];
};

/** Fetches a confirmed transaction with its top-level instructions resolved to addresses. */
export async function fetchDecodedTransaction(client: SealedClient, signature: Signature): Promise<DecodedTransaction> {
  const transaction = await client.rpc
    .getTransaction(signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
    .send();
  if (!transaction) throw new Error(`Transaction ${signature} not found.`);

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
   * accounts (as Sealed does). Its proof holds the amount encrypted to the recipient.
   */
  ciphertextValidityContext?: Address;
};

/** Confidential transfer instructions in a transaction. */
export function confidentialTransfersIn(transaction: DecodedTransaction): ConfidentialTransferRecord[] {
  return transaction.instructions.flatMap(({ programAddress, accounts, data }) => {
    if (programAddress !== TOKEN_2022_PROGRAM_ADDRESS) return [];
    if (!isConfidentialInstructionData(data, CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR)) return [];
    // Accounts: source, mint, destination, then either the three proof context accounts and the
    // authority (7 in total) or the instructions sysvar for inline proofs.
    const [sourceToken, , destinationToken] = accounts;
    if (!sourceToken || !destinationToken) return [];
    return [
      {
        signature: transaction.signature,
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        sourceToken,
        destinationToken,
        data,
        ...(accounts.length === 7 && accounts[4] ? { ciphertextValidityContext: accounts[4] } : {}),
      },
    ];
  });
}

/** Every confidential transfer into or out of `tokenAccount`, newest first. */
export async function fetchConfidentialTransfers(
  client: SealedClient,
  input: { tokenAccount: Address; limit?: number },
): Promise<ConfidentialTransferRecord[]> {
  const signatures = await client.rpc
    .getSignaturesForAddress(input.tokenAccount, { limit: input.limit ?? 100, commitment: 'confirmed' })
    .send();
  const transfers: ConfidentialTransferRecord[] = [];
  for (const { signature, err } of signatures) {
    if (err) continue;
    transfers.push(...confidentialTransfersIn(await fetchDecodedTransaction(client, signature)));
  }
  return transfers;
}
