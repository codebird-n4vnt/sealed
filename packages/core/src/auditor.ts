import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  getConfidentialTransferInstructionDataDecoder,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import { getBase58Encoder, type Address, type ReadonlyUint8Array, type Signature } from '@solana/kit';
import { ElGamalCiphertext, type ElGamalSecretKey } from '@solana/zk-sdk/bundler';

import { isConfidentialInstructionData } from './accounts';
import type { SealedClient } from './client';

// Transfer amounts are encrypted in two halves: the low 16 bits and the high 32 bits.
const TRANSFER_AMOUNT_LO_BIT_LENGTH = 16n;

export type AuditedTransfer = {
  signature: Signature;
  slot: bigint;
  blockTime: bigint | null;
  sourceToken: Address;
  destinationToken: Address;
  /** The decrypted amount, in base units. */
  amount: bigint;
};

/**
 * Decrypts a confidential transfer's amount from its instruction data with the mint's
 * auditor key. The auditor sees transfer amounts only, never account balances.
 */
export function decryptAuditorAmount(instructionData: ReadonlyUint8Array, auditorSecret: ElGamalSecretKey): bigint {
  const data = getConfidentialTransferInstructionDataDecoder().decode(instructionData);
  const lo = auditorSecret.decrypt(parseCiphertext(data.transferAmountAuditorCiphertextLo));
  const hi = auditorSecret.decrypt(parseCiphertext(data.transferAmountAuditorCiphertextHi));
  return lo + (hi << TRANSFER_AMOUNT_LO_BIT_LENGTH);
}

function parseCiphertext(bytes: ReadonlyUint8Array): ElGamalCiphertext {
  const ciphertext = ElGamalCiphertext.fromBytes(new Uint8Array(bytes));
  if (!ciphertext) throw new Error('Invalid ElGamal ciphertext in transfer instruction.');
  return ciphertext;
}

/** Decrypts every confidential transfer in one transaction. */
export async function auditTransaction(
  client: SealedClient,
  input: { signature: Signature; auditorSecret: ElGamalSecretKey },
): Promise<AuditedTransfer[]> {
  const transaction = await client.rpc
    .getTransaction(input.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' })
    .send();
  if (!transaction) throw new Error(`Transaction ${input.signature} not found.`);

  const { message } = transaction.transaction;
  const loaded = transaction.meta?.loadedAddresses;
  const keys = [...message.accountKeys, ...(loaded?.writable ?? []), ...(loaded?.readonly ?? [])];
  const base58 = getBase58Encoder();

  return message.instructions.flatMap(instruction => {
    if (keys[instruction.programIdIndex] !== TOKEN_2022_PROGRAM_ADDRESS) return [];
    const data = base58.encode(instruction.data);
    if (!isConfidentialInstructionData(data, CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR)) return [];

    // Transfer accounts start with: source token, mint, destination token.
    const sourceToken = keys[instruction.accounts[0] ?? -1];
    const destinationToken = keys[instruction.accounts[2] ?? -1];
    if (!sourceToken || !destinationToken) throw new Error('Malformed confidential transfer instruction.');
    return [
      {
        signature: input.signature,
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        sourceToken,
        destinationToken,
        amount: decryptAuditorAmount(data, input.auditorSecret),
      },
    ];
  });
}

/**
 * The accountant view: decrypts every confidential transfer into or out of `tokenAccount`
 * (e.g. the company treasury), newest first.
 */
export async function fetchAuditedTransfers(
  client: SealedClient,
  input: { tokenAccount: Address; auditorSecret: ElGamalSecretKey; limit?: number },
): Promise<AuditedTransfer[]> {
  const signatures = await client.rpc
    .getSignaturesForAddress(input.tokenAccount, { limit: input.limit ?? 100, commitment: 'confirmed' })
    .send();
  const transfers: AuditedTransfer[] = [];
  for (const { signature, err } of signatures) {
    if (err) continue;
    transfers.push(...(await auditTransaction(client, { signature, auditorSecret: input.auditorSecret })));
  }
  return transfers;
}
