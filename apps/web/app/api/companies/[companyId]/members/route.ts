import { randomBytes } from 'node:crypto';

import { isAddress } from '@solana/kit';

import { parseAmount } from '@sealed/core';

import { loadCompanyAsAdmin } from '@/lib/server/access';
import { badRequest, json, readJson, route } from '@/lib/server/http';
import { Member } from '@/lib/server/models';
import { encryptAmount } from '@/lib/server/secrets';
import { requireWallet } from '@/lib/server/session';

/** Adds a team member and creates their invite link. */
export const POST = route<{ companyId: string }>(async (request, { params }) => {
  const wallet = await requireWallet();
  const company = await loadCompanyAsAdmin((await params).companyId, wallet);
  const body = await readJson<{ name?: string; email?: string; salary?: string; wallet?: string }>(request);

  const name = body.name?.trim() ?? '';
  if (name.length < 1 || name.length > 80) throw badRequest('Name must be 1 to 80 characters.');
  let salary: bigint;
  try {
    salary = parseAmount(body.salary ?? '', company.decimals);
  } catch (error) {
    throw badRequest((error as Error).message);
  }
  const memberWallet = body.wallet?.trim() || undefined;
  if (memberWallet) {
    if (!isAddress(memberWallet)) throw badRequest('That is not a Solana address.');
    if (await Member.exists({ companyId: company._id, wallet: memberWallet })) {
      throw badRequest('Someone on the team already uses that wallet.');
    }
  }

  const member = await Member.create({
    companyId: company._id,
    name,
    email: body.email?.trim() || undefined,
    wallet: memberWallet,
    salaryEnc: encryptAmount(salary),
    inviteToken: randomBytes(18).toString('base64url'),
  });
  return json({ id: member.id, inviteToken: member.inviteToken }, { status: 201 });
});
