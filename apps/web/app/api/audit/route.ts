import { json, route } from '@/lib/server/http';
import { Company, Member } from '@/lib/server/models';
import { requireWallet } from '@/lib/server/session';

/**
 * Companies the signed-in wallet audits (or administers), with the team directory that maps
 * token accounts to names. Amounts come from the chain and the auditor key file, in the browser.
 */
export const GET = route(async () => {
  const wallet = await requireWallet();
  const companies = await Company.find({
    status: 'ready',
    $or: [{ accountantWallets: wallet }, { adminWallet: wallet }],
  }).sort({ name: 1 });

  const members = await Member.find({ companyId: { $in: companies.map(c => c._id) }, tokenAccount: { $exists: true } });
  return json({
    companies: companies.map(company => ({
      id: company.id,
      name: company.name,
      symbol: company.symbol,
      decimals: company.decimals,
      mint: company.mint.address,
      treasuryAccount: company.treasuryAccount,
      auditorElgamalPubkey: company.auditorElgamalPubkey,
      directory: members
        .filter(m => m.companyId.equals(company._id))
        .map(m => ({ name: m.name, wallet: m.wallet, tokenAccount: m.tokenAccount })),
    })),
  });
});
