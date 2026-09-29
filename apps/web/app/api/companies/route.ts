import { isAddress } from '@solana/kit';

import { badRequest, json, readJson, route } from '@/lib/server/http';
import { Company } from '@/lib/server/models';
import { requireWallet } from '@/lib/server/session';
import { airdropToVault, generateStoredKeypair, vaultAvailable } from '@/lib/server/solana';

/** Companies the signed-in wallet administers. */
export const GET = route(async () => {
  const wallet = await requireWallet();
  const companies = await Company.find({ adminWallet: wallet }).sort({ createdAt: -1 });
  return json({
    companies: companies.map(c => ({ id: c.id, name: c.name, symbol: c.symbol, status: c.status })),
  });
});

/**
 * Creates a company. The browser generated the accountant's auditor keypair and only sends the
 * public key; the secret goes to the accountant as a file and never reaches this server.
 */
export const POST = route(async request => {
  const wallet = await requireWallet();
  const body = await readJson<{ name?: string; symbol?: string; auditorElgamalPubkey?: string; backing?: string }>(request);
  const name = body.name?.trim() ?? '';
  const symbol = body.symbol?.trim() ?? '';
  if (name.length < 2 || name.length > 80) throw badRequest('Company name must be 2 to 80 characters.');
  if (!/^[A-Za-z0-9]{2,10}$/.test(symbol)) throw badRequest('Token symbol must be 2 to 10 letters or digits.');
  if (!body.auditorElgamalPubkey || !isAddress(body.auditorElgamalPubkey)) throw badRequest('Missing auditor key.');
  const backing = body.backing === 'usdc' ? 'usdc' : 'test';
  if (backing === 'usdc' && !(await vaultAvailable())) throw badRequest('USDC backing needs the Sealed Vault program, which is not deployed here.');

  const company = await Company.create({
    name,
    symbol,
    adminWallet: wallet,
    auditorElgamalPubkey: body.auditorElgamalPubkey,
    backing,
    vault: await generateStoredKeypair(),
    mint: await generateStoredKeypair(),
  });

  // Best effort: devnet faucets are often rate-limited, and the dashboard offers a retry.
  void airdropToVault(company).catch(() => {});

  return json({ id: company.id }, { status: 201 });
});
