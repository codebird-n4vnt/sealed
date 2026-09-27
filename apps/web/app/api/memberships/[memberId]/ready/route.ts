import { loadOwnMembership } from '@/lib/server/access';
import { badRequest, json, route } from '@/lib/server/http';
import { requireWallet } from '@/lib/server/session';
import { approveMemberAccount, memberAccountState } from '@/lib/server/solana';

/**
 * Called after the employee configured their private account in the browser. The company
 * token uses manual approval, so the company (its vault) approves the account here.
 */
export const POST = route<{ memberId: string }>(async (_, { params }) => {
  const wallet = await requireWallet();
  const { member, company } = await loadOwnMembership((await params).memberId, wallet);

  const account = await memberAccountState(company, wallet);
  if (!account.configured) throw badRequest("Your private account isn't set up on-chain yet.");
  if (!account.approved) await approveMemberAccount(company, wallet);

  member.status = 'ready';
  member.tokenAccount = account.token;
  member.readyAt ??= new Date();
  await member.save();
  return json({ status: member.status, tokenAccount: account.token });
});
