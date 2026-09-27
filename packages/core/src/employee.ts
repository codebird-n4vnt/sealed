import { CONFIDENTIAL_WITHDRAW_CONFIDENTIAL_TRANSFER_DISCRIMINATOR, fetchToken } from '@solana-program/token-2022';
import {
  fetchConfidentialTransferBalance,
  getConfidentialWithdrawWithRecordInstructionPlan,
  type ConfidentialTransferBalance,
} from '@solana-program/token-2022/confidential';
import type { Address, Signature, TransactionSigner } from '@solana/kit';

import { signatureOfConfidentialInstruction, tokenAccountAddress } from './accounts';
import type { SealedClient } from './client';
import type { ConfidentialKeys } from './keys';

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
 */
export async function withdrawConfidential(
  client: SealedClient,
  input: { owner: TransactionSigner; mint: Address; keys: ConfidentialKeys; amount: bigint; decimals: number },
): Promise<Signature> {
  const token = await tokenAccountAddress(input.owner.address, input.mint);
  const { data: tokenAccount } = await fetchToken(client.rpc, token);
  const result = await client.sendTransactions(
    await getConfidentialWithdrawWithRecordInstructionPlan({
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
    }),
  );
  return signatureOfConfidentialInstruction(result, CONFIDENTIAL_WITHDRAW_CONFIDENTIAL_TRANSFER_DISCRIMINATOR);
}
