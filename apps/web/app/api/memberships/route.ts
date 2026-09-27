import { json, route } from '@/lib/server/http';
import { Company, Member } from '@/lib/server/models';
import { requireWallet } from '@/lib/server/session';

/** The signed-in wallet's memberships. Amounts are not included: employees decrypt them locally. */
export const GET = route(async () => {
  const wallet = await requireWallet();
  const members = await Member.find({ wallet }).sort({ createdAt: 1 });
  const companies = await Company.find({ _id: { $in: members.map(m => m.companyId) } });
  const byId = new Map(companies.map(c => [c.id as string, c]));

  return json({
    memberships: members.flatMap(member => {
      const company = byId.get(member.companyId.toString());
      if (!company || company.status !== 'ready') return [];
      return [
        {
          memberId: member.id,
          name: member.name,
          status: member.status,
          company: {
            id: company.id,
            name: company.name,
            symbol: company.symbol,
            decimals: company.decimals,
            mint: company.mint.address,
            vault: company.vault.address,
            treasuryAccount: company.treasuryAccount ?? null,
          },
        },
      ];
    }),
  });
});
