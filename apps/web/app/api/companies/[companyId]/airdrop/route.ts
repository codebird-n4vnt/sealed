import { loadCompanyAsAdmin } from '@/lib/server/access';
import { HttpError, json, route } from '@/lib/server/http';
import { requireWallet } from '@/lib/server/session';
import { airdropToVault, vaultSol } from '@/lib/server/solana';

/** Requests test SOL for the payroll vault's fees. */
export const POST = route<{ companyId: string }>(async (_, { params }) => {
  const wallet = await requireWallet();
  const company = await loadCompanyAsAdmin((await params).companyId, wallet);
  try {
    await airdropToVault(company);
  } catch {
    throw new HttpError(
      502,
      `The airdrop failed (the devnet faucet is often rate-limited). Send devnet SOL to ${company.vault.address} from https://faucet.solana.com instead.`,
    );
  }
  return json({ sol: await vaultSol(company) });
});
