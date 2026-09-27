import { loadCompanyAsAdmin } from '@/lib/server/access';
import { badRequest, json, route } from '@/lib/server/http';
import { requireWallet } from '@/lib/server/session';
import { setupCompanyOnChain, vaultSol } from '@/lib/server/solana';

const MIN_SETUP_LAMPORTS = 50_000_000n;

/** Creates the company token and confidential treasury on-chain. Safe to retry. */
export const POST = route<{ companyId: string }>(async (_, { params }) => {
  const wallet = await requireWallet();
  const company = await loadCompanyAsAdmin((await params).companyId, wallet);
  if (company.status === 'ready') return json({ status: 'ready' });
  if ((await vaultSol(company)) < MIN_SETUP_LAMPORTS) {
    throw badRequest('The payroll vault needs at least 0.05 SOL for fees and rent. Fund it first.');
  }
  await setupCompanyOnChain(company);
  return json({ status: company.status });
});
