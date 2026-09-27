import { parseAmount } from '@sealed/core';

import { loadCompanyAsAdmin } from '@/lib/server/access';
import { badRequest, json, readJson, route } from '@/lib/server/http';
import { requireWallet } from '@/lib/server/session';
import { fundTreasury, treasuryBalances } from '@/lib/server/solana';

const MAX_FUNDING = 10_000_000n;

/** Devnet: mints test stablecoins into the confidential treasury. */
export const POST = route<{ companyId: string }>(async (request, { params }) => {
  const wallet = await requireWallet();
  const company = await loadCompanyAsAdmin((await params).companyId, wallet);
  if (company.status !== 'ready') throw badRequest('Finish setting up the company first.');

  const body = await readJson<{ amount?: string }>(request);
  let amount: bigint;
  try {
    amount = parseAmount(body.amount ?? '', company.decimals);
  } catch (error) {
    throw badRequest((error as Error).message);
  }
  if (amount <= 0n || amount > MAX_FUNDING * 10n ** BigInt(company.decimals)) {
    throw badRequest(`Fund between 0 and ${MAX_FUNDING.toLocaleString()} at a time.`);
  }

  await fundTreasury(company, amount);
  return json({ balances: await treasuryBalances(company) });
});
