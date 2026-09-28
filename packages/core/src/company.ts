import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  decodeMint,
  decodeToken,
  extension,
  fetchToken,
  getApproveConfidentialTransferAccountInstruction,
  getConfidentialDepositInstruction,
  getMintToInstruction,
} from '@solana-program/token-2022';
import {
  getConfidentialTransferInstructionPlan,
  getConfidentialTransferWithRecordInstructionPlan,
} from '@solana-program/token-2022/confidential';
import {
  assertAccountExists,
  fetchEncodedAccounts,
  none,
  some,
  type Address,
  type EncodedAccount,
  type Signature,
  type TransactionSigner,
} from '@solana/kit';

import {
  applyPendingBalance,
  confidentialState,
  signatureOfConfidentialInstruction,
  tokenAccountAddress,
} from './accounts';
import { DEFAULT_DECIMALS } from './amounts';
import type { SealedClient } from './client';
import type { ConfidentialKeys } from './keys';
import { withReadRetry } from './history';
import { oneTransactionTransfer, planningRpc } from './one-transaction';

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
    /** Called once the proofs are generated, just before the first transaction is sent. */
    onProofsReady?: () => void | Promise<void>;
    /**
     * `record` (default) stages the range proof in a record account, so it works in legacy/v0
     * transactions with default client settings. `one-transaction` sends the proofs and the
     * transfer as one v1 transaction, with no proof accounts; it needs a `transactionVersion: 1`
     * client and a cluster that supports v1.
     */
    proofDelivery?: 'record' | 'one-transaction';
  },
): Promise<Payment> {
  const sourceToken = await tokenAccountAddress(input.from.owner.address, input.mint);
  const destinationToken = await tokenAccountAddress(input.to, input.mint);

  if (input.proofDelivery === 'one-transaction') {
    // One read for both token accounts and the mint (for its auditor key), retried if the RPC is busy.
    const [source, destination, mint] = await withReadRetry(() =>
      fetchEncodedAccounts(client.rpc, [sourceToken, destinationToken, input.mint]),
    );
    for (const account of [source, destination, mint]) assertAccountExists(account!);
    const plan = await getConfidentialTransferInstructionPlan({
      payer: client.payer,
      rpc: planningRpc(client.rpc),
      mint: input.mint,
      mintAccount: decodeMint(mint as EncodedAccount).data,
      sourceToken,
      sourceTokenAccount: decodeToken(source as EncodedAccount).data,
      destinationToken,
      destinationTokenAccount: decodeToken(destination as EncodedAccount).data,
      authority: input.from.owner,
      amount: input.amount,
      sourceElgamalKeypair: input.from.keys.elgamal,
      aesKey: input.from.keys.ae,
    });
    const instructions = oneTransactionTransfer(plan);
    await input.onProofsReady?.();
    const result = await client.sendTransaction(instructions);
    return { signature: result.context.signature, sourceToken, destinationToken };
  }

  const [{ data: sourceTokenAccount }, { data: destinationTokenAccount }] = await Promise.all([
    fetchToken(client.rpc, sourceToken),
    fetchToken(client.rpc, destinationToken),
  ]);
  const planInput = {
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
  };

  // The record-staged range proof leaves room in each transaction for the compute-unit
  // limit the executor sets, so this works with the client's default settings on any RPC.
  const plan = await getConfidentialTransferWithRecordInstructionPlan(planInput);
  await input.onProofsReady?.();
  const result = await client.sendTransactions(plan);
  return {
    signature: signatureOfConfidentialInstruction(result, CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR),
    sourceToken,
    destinationToken,
  };
}
