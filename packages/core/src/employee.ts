import { CONFIDENTIAL_WITHDRAW_CONFIDENTIAL_TRANSFER_DISCRIMINATOR, fetchToken } from '@solana-program/token-2022';
import {
  fetchConfidentialTransferBalance,
  getConfidentialWithdrawInstructionPlan,
  getConfidentialWithdrawWithRecordInstructionPlan,
  type ConfidentialTransferBalance,
} from '@solana-program/token-2022/confidential';
import type { Address, ReadonlyUint8Array, Signature, TransactionSigner } from '@solana/kit';
import { GroupedElGamalCiphertext3Handles, type ElGamalSecretKey } from '@solana/zk-sdk/bundler';

import { signatureOfConfidentialInstruction, tokenAccountAddress } from './accounts';
import { TRANSFER_AMOUNT_LO_BIT_LENGTH } from './auditor';
import type { SealedClient } from './client';
import { fetchConfidentialTransfers, fetchDecodedTransaction, withReadRetry } from './history';
import type { ConfidentialKeys } from './keys';
import { oneTransactionWithdraw, ZK_VERIFY_BATCHED_GROUPED_CIPHERTEXT_3_HANDLES_VALIDITY } from './one-transaction';
import { ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS } from './sponsor';

/**
 * Decrypts the owner's confidential balance. `pendingBalance` is pay received but not yet
 * applied; `availableBalance` can be withdrawn. Only the owner's keys can do this.
 */
export async function getConfidentialBalance(
  client: SealedClient,
  input: { owner: Address; mint: Address; keys: ConfidentialKeys },
): Promise<ConfidentialTransferBalance> {
  return await fetchConfidentialTransferBalance({
    rpc: client.rpc,
    token: await tokenAccountAddress(input.owner, input.mint),
    elgamalSecretKey: input.keys.elgamal.secret(),
    aesKey: input.keys.ae,
  });
}

/**
 * Moves `amount` from the owner's available confidential balance to their public balance,
 * where it can be sent to an exchange or off-ramp. The client's fee payer covers the fees.
 * The withdrawn amount is public.
 *
 * `proofDelivery`: `record` (default) stages the range proof in a record account, which works
 * with default client settings. `inline` sends it in the verify instruction: fewer transactions,
 * no record accounts, but it needs a client with `estimateResourceLimits: false`.
 * `one-transaction` sends both proofs and the withdraw as one v1 transaction with no proof
 * accounts; it needs a `transactionVersion: 1` client and a cluster that supports v1.
 */
export async function withdrawConfidential(
  client: SealedClient,
  input: {
    owner: TransactionSigner;
    mint: Address;
    keys: ConfidentialKeys;
    amount: bigint;
    decimals: number;
    proofDelivery?: 'record' | 'inline' | 'one-transaction';
  },
): Promise<Signature> {
  const token = await tokenAccountAddress(input.owner.address, input.mint);
  const { data: tokenAccount } = await fetchToken(client.rpc, token);
  const planInput = {
    payer: client.payer,
    rpc: client.rpc,
    token,
    mint: input.mint,
    tokenAccount,
    authority: input.owner,
    amount: input.amount,
    decimals: input.decimals,
    elgamalKeypair: input.keys.elgamal,
    aesKey: input.keys.ae,
  };
  if (input.proofDelivery === 'one-transaction') {
    const instructions = oneTransactionWithdraw(await getConfidentialWithdrawInstructionPlan(planInput));
    return (await client.sendTransaction(instructions)).context.signature;
  }
  const plan =
    input.proofDelivery === 'inline'
      ? await getConfidentialWithdrawInstructionPlan(planInput)
      : await getConfidentialWithdrawWithRecordInstructionPlan(planInput);
  const result = await client.sendTransactions(plan);
  return signatureOfConfidentialInstruction(result, CONFIDENTIAL_WITHDRAW_CONFIDENTIAL_TRANSFER_DISCRIMINATOR);
}

export type ReceivedPayment = {
  signature: Signature;
  slot: bigint;
  blockTime: bigint | null;
  sourceToken: Address;
  /** Decrypted with the recipient's key; null if the proof couldn't be found. */
  amount: bigint | null;
};

// VerifyBatchedGroupedCiphertext3HandlesValidity, with the proof inline: 1 discriminator byte,
// then the proof context: three 32-byte ElGamal pubkeys (source, destination, auditor) and the
// lo and hi grouped ciphertexts (a 32-byte commitment plus one 32-byte handle per pubkey).
const GROUPED_LO = [1 + 96, 1 + 224] as const;
const GROUPED_HI = [1 + 224, 1 + 352] as const;
const DESTINATION_HANDLE = 1;

/**
 * Decrypts the recipient's copy of a transfer amount from a ciphertext-validity proof
 * instruction's data. Null if the data isn't that proof, with the proof inline.
 */
export function decryptValidityProofAmount(data: ReadonlyUint8Array, elgamalSecret: ElGamalSecretKey): bigint | null {
  if (data[0] !== ZK_VERIFY_BATCHED_GROUPED_CIPHERTEXT_3_HANDLES_VALIDITY || data.length < GROUPED_HI[1]) return null;
  const decrypt = ([start, end]: readonly [number, number]) =>
    GroupedElGamalCiphertext3Handles.fromBytes(new Uint8Array(data.slice(start, end))).decrypt(elgamalSecret, DESTINATION_HANDLE);
  return decrypt(GROUPED_LO) + (decrypt(GROUPED_HI) << TRANSFER_AMOUNT_LO_BIT_LENGTH);
}

/**
 * Recovers a transfer's amount as the recipient. The transfer instruction only carries the
 * auditor's copy; the recipient's copy is in the ciphertext-validity proof, verified into
 * `contextAccount` by an earlier transaction of the same payment.
 */
export async function decryptReceivedAmount(
  client: SealedClient,
  input: { contextAccount: Address; elgamalSecret: ElGamalSecretKey },
): Promise<bigint | null> {
  const signatures = await withReadRetry(() =>
    client.rpc.getSignaturesForAddress(input.contextAccount, { limit: 10, commitment: 'confirmed' }).send(),
  );
  for (const { signature, err } of [...signatures].reverse()) {
    if (err) continue;
    const transaction = await fetchDecodedTransaction(client, signature);
    for (const { programAddress, accounts, data } of transaction.instructions) {
      if (programAddress !== ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS || accounts[0] !== input.contextAccount) continue;
      const amount = decryptValidityProofAmount(data, input.elgamalSecret);
      if (amount !== null) return amount;
    }
  }
  return null;
}

/** Payments the owner received, newest first, with amounts decrypted locally. */
export async function fetchReceivedPayments(
  client: SealedClient,
  input: { owner: Address; mint: Address; keys: ConfidentialKeys; limit?: number },
): Promise<ReceivedPayment[]> {
  const token = await tokenAccountAddress(input.owner, input.mint);
  const transfers = await fetchConfidentialTransfers(client, { tokenAccount: token, limit: input.limit ?? 50 });
  const elgamalSecret = input.keys.elgamal.secret();
  const payments: ReceivedPayment[] = [];
  for (const transfer of transfers) {
    if (transfer.destinationToken !== token) continue;
    payments.push({
      signature: transfer.signature,
      slot: transfer.slot,
      blockTime: transfer.blockTime,
      sourceToken: transfer.sourceToken,
      amount: transfer.ciphertextValidityProof
        ? decryptValidityProofAmount(transfer.ciphertextValidityProof, elgamalSecret)
        : transfer.ciphertextValidityContext
          ? await decryptReceivedAmount(client, { contextAccount: transfer.ciphertextValidityContext, elgamalSecret })
          : null,
    });
  }
  return payments;
}
