import { HttpError, json, notFound, route } from '@/lib/server/http';
import { Company, Member } from '@/lib/server/models';
import { requireWallet } from '@/lib/server/session';

async function loadInvite(token: string) {
  const member = await Member.findOne({ inviteToken: token });
  if (!member) throw notFound('This invite link is not valid.');
  const company = await Company.findById(member.companyId);
  if (!company) throw notFound('This invite link is not valid.');
  return { member, company };
}

/** What an invite is for. Deliberately leaves out the salary. */
export const GET = route<{ token: string }>(async (_, { params }) => {
  const { member, company } = await loadInvite((await params).token);
  return json({
    memberId: member.id,
    company: { name: company.name, symbol: company.symbol, ready: company.status === 'ready' },
    member: { name: member.name, status: member.status, wallet: member.wallet ?? null },
  });
});

/** Links the signed-in wallet to the invite. */
export const POST = route<{ token: string }>(async (_, { params }) => {
  const wallet = await requireWallet();
  const { member, company } = await loadInvite((await params).token);
  if (member.wallet && member.wallet !== wallet) {
    throw new HttpError(409, 'This invite is linked to a different wallet. Connect that wallet, or ask your employer.');
  }
  if (!member.wallet && (await Member.exists({ companyId: company._id, wallet, _id: { $ne: member._id } }))) {
    throw new HttpError(409, `This wallet is already on the ${company.name} team.`);
  }
  // Claim atomically, so two wallets accepting at once can't both win.
  const joined = await Member.findOneAndUpdate(
    { _id: member._id, $or: [{ wallet: { $exists: false } }, { wallet: null }, { wallet }] },
    { $set: { wallet, ...(member.status === 'invited' ? { status: 'joined', joinedAt: new Date() } : {}) } },
    { new: true },
  );
  if (!joined) throw new HttpError(409, 'This invite was just accepted by another wallet.');
  return json({ memberId: joined.id, status: joined.status });
});
