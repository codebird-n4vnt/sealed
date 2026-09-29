import type { Address } from '@solana/kit';

import { checkSponsoredTransaction, sponsorTransaction, tokenAccountAddress, usdcAccountAddress } from '@sealed/core';

import { USDC_MINT } from '@/lib/config';

import { loadOwnMembership } from '@/lib/server/access';
import { badRequest, HttpError, json, readJson, route } from '@/lib/server/http';
import { Member } from '@/lib/server/models';
import { requireWallet } from '@/lib/server/session';
import { companyChain } from '@/lib/server/solana';

const WINDOW_MS = 60 * 60_000;
const MAX_TRANSACTIONS_PER_WINDOW = 60;
/** Bounds the rent at risk from proof accounts (see the note in packages/core/src/sponsor.ts). */
const MAX_NEW_ACCOUNTS_PER_WINDOW = 16;

/**
 * Co-signs an employee's transaction as fee payer, so employees never need SOL. The transaction
 * must pass the sponsor policy: it can only touch the employee's own account for this company.
 */
export const POST = route<{ memberId: string }>(async (request, { params }) => {
  const wallet = await requireWallet();
  const { member, company } = await loadOwnMembership((await params).memberId, wallet);
  if (company.status !== 'ready') throw badRequest('This company is not set up yet.');

  const { transaction } = await readJson<{ transaction?: string }>(request);
  const wire = new Uint8Array(Buffer.from(transaction ?? '', 'base64'));
  if (wire.length === 0) throw badRequest('Missing transaction.');

  const { vault, mint } = await companyChain(company);
  const policy = {
    owner: wallet as Address,
    token: await tokenAccountAddress(wallet as Address, mint),
    mint,
    // USDC-backed companies also pay for cashing out to the employee's own USDC account.
    ...(company.backing === 'usdc'
      ? { usdc: { mint: USDC_MINT as Address, account: await usdcAccountAddress(wallet as Address, USDC_MINT as Address) } }
      : {}),
  };
  const { newAccounts } = checkSponsoredTransaction(wire, { ...policy, sponsor: vault.address });

  // Rate limit per member and hour.
  const windowStart = member.sponsor?.windowStart ?? new Date(0);
  const fresh = Date.now() - windowStart.getTime() > WINDOW_MS;
  const used = fresh ? { transactions: 0, newAccounts: 0 } : member.sponsor;
  if ((used?.transactions ?? 0) + 1 > MAX_TRANSACTIONS_PER_WINDOW || (used?.newAccounts ?? 0) + newAccounts > MAX_NEW_ACCOUNTS_PER_WINDOW) {
    throw new HttpError(429, 'Too many sponsored transactions. Try again in an hour.');
  }
  await Member.updateOne(
    { _id: member._id },
    fresh
      ? { sponsor: { windowStart: new Date(), transactions: 1, newAccounts } }
      : { $inc: { 'sponsor.transactions': 1, 'sponsor.newAccounts': newAccounts } },
  );

  const signature = await sponsorTransaction(wire, vault, policy);
  return json({ signature: Buffer.from(signature).toString('base64') });
});
