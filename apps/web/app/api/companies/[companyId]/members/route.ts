import { loadCompanyAsAdmin } from '@/lib/server/access';
import { json, readJson, route } from '@/lib/server/http';
import { prepareMembers, type MemberInput } from '@/lib/server/members';
import { Member } from '@/lib/server/models';
import { requireWallet } from '@/lib/server/session';

/** Adds a team member and creates their invite link. */
export const POST = route<{ companyId: string }>(async (request, { params }) => {
  const wallet = await requireWallet();
  const company = await loadCompanyAsAdmin((await params).companyId, wallet);
  const prepared = (await prepareMembers(company, [await readJson<MemberInput>(request)]))[0]!;
  const member = await Member.create(prepared);
  return json({ id: member.id, inviteToken: member.inviteToken }, { status: 201 });
});
