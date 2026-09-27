import { isAddress } from '@solana/kit';

import { loadCompanyAsAdmin } from '@/lib/server/access';
import { badRequest, json, readJson, route } from '@/lib/server/http';
import { requireWallet } from '@/lib/server/session';

type Params = { companyId: string };

async function change(request: Request, params: Promise<Params>, operation: '$addToSet' | '$pull') {
  const company = await loadCompanyAsAdmin((await params).companyId, await requireWallet());
  const { wallet } = await readJson<{ wallet?: string }>(request);
  if (!wallet || !isAddress(wallet.trim())) throw badRequest('That is not a Solana address.');
  await company.updateOne({ [operation]: { accountantWallets: wallet.trim() } });
  return json({ ok: true });
}

/**
 * Lets an accountant's wallet see the team directory in the accountant view. Reading amounts
 * still needs the auditor key file, which the server never has.
 */
export const POST = route<Params>(async (request, { params }) => change(request, params, '$addToSet'));
export const DELETE = route<Params>(async (request, { params }) => change(request, params, '$pull'));
