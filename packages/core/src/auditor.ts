import { getConfidentialTransferInstructionDataDecoder } from '@solana-program/token-2022';
import type { Address, ReadonlyUint8Array, Signature } from '@solana/kit';
import { ElGamalCiphertext, type ElGamalSecretKey } from '@solana/zk-sdk/bundler';

import type { SealedClient } from './client';
import {
  confidentialTransfersIn,
  fetchConfidentialTransfers,
  fetchDecodedTransaction,
  type ConfidentialTransferRecord,
} from './history';

// Transfer amounts are encrypted in two halves: the low 16 bits and the high 32 bits.
export const TRANSFER_AMOUNT_LO_BIT_LENGTH = 16n;

export type AuditedTransfer = Omit<ConfidentialTransferRecord, 'data' | 'ciphertextValidityContext'> & {
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

function audit(
  { data, ciphertextValidityContext: _, ...transfer }: ConfidentialTransferRecord,
  auditorSecret: ElGamalSecretKey,
): AuditedTransfer {
  return { ...transfer, amount: decryptAuditorAmount(data, auditorSecret) };
}

/** Decrypts every confidential transfer in one transaction. */
export async function auditTransaction(
  client: SealedClient,
  input: { signature: Signature; auditorSecret: ElGamalSecretKey },
): Promise<AuditedTransfer[]> {
  const transaction = await fetchDecodedTransaction(client, input.signature);
  return confidentialTransfersIn(transaction).map(transfer => audit(transfer, input.auditorSecret));
}

/**
 * The accountant view: decrypts every confidential transfer into or out of `tokenAccount`
 * (e.g. the company treasury), newest first.
 */
export async function fetchAuditedTransfers(
  client: SealedClient,
  input: { tokenAccount: Address; auditorSecret: ElGamalSecretKey; limit?: number },
): Promise<AuditedTransfer[]> {
  const transfers = await fetchConfidentialTransfers(client, input);
  return transfers.map(transfer => audit(transfer, input.auditorSecret));
}
