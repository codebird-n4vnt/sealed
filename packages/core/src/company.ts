import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  extension,
  fetchToken,
  getApproveConfidentialTransferAccountInstruction,
  getConfidentialDepositInstruction,
  getMintToInstruction,
} from '@solana-program/token-2022';
import { getConfidentialTransferWithRecordInstructionPlan } from '@solana-program/token-2022/confidential';
import { none, some, type Address, type Signature, type TransactionSigner } from '@solana/kit';

import {
  applyPendingBalance,
  confidentialState,
  signatureOfConfidentialInstruction,
  tokenAccountAddress,
} from './accounts';
import { DEFAULT_DECIMALS } from './amounts';
import type { SealedClient } from './client';
import type { ConfidentialKeys } from './keys';

/**
 * `manual`: the company must approve each account before it can use confidential transfers,
 * which keeps a company's token to that company's team. `auto`: any wallet can configure one.
 */
export type ApprovePolicy = 'manual' | 'auto';

/**
 * Creates a company's stablecoin mint with confidential transfers enabled. This can only be
 * done at mint creation, which is why an existing mint like USDC can't be used directly.
 *
 * `authority` becomes both the mint authority and the confidential-transfer authority, which
 * approves accounts under the `manual` policy (the default). When `auditorElgamalPubkey` is
 * set, every confidential transfer also encrypts its amount to that key for the accountant.
 */
export async function createPayrollMint(
  client: SealedClient,
  input: {
    mint: TransactionSigner;
    authority: TransactionSigner;
    decimals?: number;
    approvePolicy?: ApprovePolicy;
    auditorElgamalPubkey?: Address;
  },
): Promise<Signature> {
  const result = await client.token2022.instructions
    .createMint({
      newMint: input.mint,
      decimals: input.decimals ?? DEFAULT_DECIMALS,
      mintAuthority: input.authority,
      extensions: [
        extension('ConfidentialTransferMint', {
          authority: some(input.authority.address),
          autoApproveNewAccounts: (input.approvePolicy ?? 'manual') === 'auto',
          auditorElgamalPubkey: input.auditorElgamalPubkey ? some(input.auditorElgamalPubkey) : none(),
        }),
      ],
    })
    .sendTransaction();
  return result.context.signature;
}

/**
 * Under the `manual` policy, lets the owner's configured account send and receive confidential
 * transfers. Signed by the mint's confidential-transfer authority. Returns null if the
 * account was already approved.
 */
export async function approveConfidentialAccount(
  client: SealedClient,
  input: { mint: Address; authority: TransactionSigner; owner: Address },
): Promise<Signature | null> {
  const token = await tokenAccountAddress(input.owner, input.mint);
  const { data: tokenAccount } = await fetchToken(client.rpc, token);
  const state = confidentialState(tokenAccount);
  if (!state) throw new Error(`Token account ${token} is not configured for confidential transfers.`);
  if (state.approved) return null;

  const result = await client.sendTransaction(
    getApproveConfidentialTransferAccountInstruction({ token, mint: input.mint, authority: input.authority }),
  );
  return result.context.signature;
}

/** Devnet only: mints test stablecoins to the owner's public balance. */
export async function mintTestTokens(
  client: SealedClient,
  input: { mint: Address; authority: TransactionSigner; owner: Address; amount: bigint },
): Promise<Signature> {
  const result = await client.sendTransaction(
    getMintToInstruction({
      mint: input.mint,
      token: await tokenAccountAddress(input.owner, input.mint),
      mintAuthority: input.authority,
      amount: input.amount,
    }),
  );
  return result.context.signature;
}

/**
 * Moves `amount` from the owner's public balance into their confidential balance, then
 * applies it so it's available to pay out. The deposit amount itself is public, like any
 * funding of the payroll account; individual salaries paid from it are not.
 */
export async function depositToConfidential(
  client: SealedClient,
  input: { owner: TransactionSigner; mint: Address; keys: ConfidentialKeys; amount: bigint; decimals: number },
): Promise<void> {
  await client.sendTransaction(
    getConfidentialDepositInstruction({
      token: await tokenAccountAddress(input.owner.address, input.mint),
      mint: input.mint,
      authority: input.owner,
      amount: input.amount,
      decimals: input.decimals,
    }),
  );
  await applyPendingBalance(client, input);
}

export type Payment = {
  /** The transaction carrying the confidential transfer instruction. */
  signature: Signature;
  sourceToken: Address;
  destinationToken: Address;
};

/**
 * Pays `amount` from the employer's available confidential balance to the employee's
 * account. The amount is encrypted to the employee (and the mint's auditor, if set) and
 * lands in the employee's pending balance. The client's fee payer covers every fee.
 *
 * Generates three zero-knowledge proofs (equality, ciphertext validity, range) and sends
 * them as context-state accounts over several transactions, then closes them to reclaim rent.
 */
export async function payConfidential(
  client: SealedClient,
  input: {
    mint: Address;
    from: { owner: TransactionSigner; keys: ConfidentialKeys };
    /** The employee's wallet address. Their token account must already be configured. */
    to: Address;
    amount: bigint;
  },
): Promise<Payment> {
  const sourceToken = await tokenAccountAddress(input.from.owner.address, input.mint);
  const destinationToken = await tokenAccountAddress(input.to, input.mint);
  const [{ data: sourceTokenAccount }, { data: destinationTokenAccount }] = await Promise.all([
    fetchToken(client.rpc, sourceToken),
    fetchToken(client.rpc, destinationToken),
  ]);

  // The record-staged range proof leaves room in each transaction for the compute-unit
  // limit the executor sets, so this works with the client's default settings on any RPC.
  const result = await client.sendTransactions(
    await getConfidentialTransferWithRecordInstructionPlan({
      payer: client.payer,
      rpc: client.rpc,
      mint: input.mint,
      sourceToken,
      sourceTokenAccount,
      destinationToken,
      destinationTokenAccount,
      authority: input.from.owner,
      amount: input.amount,
      sourceElgamalKeypair: input.from.keys.elgamal,
      aesKey: input.from.keys.ae,
    }),
  );
  return {
    signature: signatureOfConfidentialInstruction(result, CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR),
    sourceToken,
    destinationToken,
  };
}
