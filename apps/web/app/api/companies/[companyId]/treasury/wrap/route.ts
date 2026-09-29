import { loadCompanyAsAdmin } from '@/lib/server/access';
import { badRequest, json, route } from '@/lib/server/http';
import { requireWallet } from '@/lib/server/session';
import { treasuryBalances, wrapIntoTreasury } from '@/lib/server/solana';

/** USDC-backed companies: wraps the USDC at the funding address 1:1 into the confidential treasury. */
export const POST = route<{ companyId: string }>(async (_, { params }) => {
  const wallet = await requireWallet();
  const company = await loadCompanyAsAdmin((await params).companyId, wallet);
  if (company.status !== 'ready') throw badRequest('Finish setting up the company first.');
  if (company.backing !== 'usdc') throw badRequest('This company is not backed by USDC.');
  const wrapped = await wrapIntoTreasury(company);
  if (wrapped === 0n) throw badRequest('No USDC has arrived at the funding address yet.');
  return json({ wrapped, balances: await treasuryBalances(company) });
});
