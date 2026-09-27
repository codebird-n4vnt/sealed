import { loadCompanyAsAdmin } from '@/lib/server/access';
import { json, route } from '@/lib/server/http';
import { Member, PayrollRun } from '@/lib/server/models';
import { decryptAmount } from '@/lib/server/secrets';
import { requireWallet } from '@/lib/server/session';
import { treasuryBalances, vaultSol } from '@/lib/server/solana';

/** Everything the company dashboard shows. Admin only. */
export const GET = route<{ companyId: string }>(async (_, { params }) => {
  const wallet = await requireWallet();
  const company = await loadCompanyAsAdmin((await params).companyId, wallet);
  const [members, runs] = await Promise.all([
    Member.find({ companyId: company._id }).sort({ createdAt: 1 }),
    PayrollRun.find({ companyId: company._id, status: { $ne: 'draft' } }).sort({ createdAt: -1 }).limit(20),
  ]);

  let balances = null;
  let chainError = null;
  try {
    balances =
      company.status === 'ready'
        ? await treasuryBalances(company)
        : { sol: await vaultSol(company), public: 0n, confidential: 0n, pending: 0n };
  } catch (error) {
    chainError = `Can't reach the Solana RPC: ${error instanceof Error ? error.message.split('\n')[0] : error}`;
  }

  return json({
    company: {
      id: company.id,
      name: company.name,
      symbol: company.symbol,
      decimals: company.decimals,
      status: company.status,
      adminWallet: company.adminWallet,
      vault: company.vault.address,
      mint: company.mint.address,
      treasuryAccount: company.treasuryAccount ?? null,
      auditorElgamalPubkey: company.auditorElgamalPubkey,
      accountantWallets: company.accountantWallets,
    },
    balances,
    chainError,
    members: members.map(m => ({
      id: m.id,
      name: m.name,
      email: m.email ?? null,
      wallet: m.wallet ?? null,
      salary: decryptAmount(m.salaryEnc),
      status: m.status,
      inviteToken: m.inviteToken,
      tokenAccount: m.tokenAccount ?? null,
    })),
    runs: runs.map(r => ({
      id: r.id,
      status: r.status,
      count: r.count,
      total: decryptAmount(r.totalEnc),
      createdAt: r.createdAt,
      finishedAt: r.finishedAt ?? null,
    })),
  });
});
