import { isValidObjectId } from 'mongoose';

import { parseAmount } from '@sealed/core';

import { loadCompanyAsAdmin } from '@/lib/server/access';
import { assertEditable } from '@/lib/server/demo';
import { badRequest, json, notFound, readJson, route } from '@/lib/server/http';
import { Member } from '@/lib/server/models';
import { encryptAmount } from '@/lib/server/secrets';
import { requireWallet } from '@/lib/server/session';

type Params = { companyId: string; memberId: string };

async function loadMember(params: Promise<Params>) {
  const { companyId, memberId } = await params;
  const company = await loadCompanyAsAdmin(companyId, await requireWallet());
  assertEditable(company);
  const member = isValidObjectId(memberId) ? await Member.findOne({ _id: memberId, companyId: company._id }) : null;
  if (!member) throw notFound('Team member not found.');
  return { company, member };
}

/** Changes a member's name or salary. */
export const PATCH = route<Params>(async (request, { params }) => {
  const { company, member } = await loadMember(params);
  const body = await readJson<{ name?: string; salary?: string }>(request);
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (name.length < 1 || name.length > 80) throw badRequest('Name must be 1 to 80 characters.');
    member.name = name;
  }
  if (body.salary !== undefined) {
    try {
      member.salaryEnc = encryptAmount(parseAmount(body.salary, company.decimals));
    } catch (error) {
      throw badRequest((error as Error).message);
    }
  }
  await member.save();
  return json({ ok: true });
});

/** Removes a member from future payroll runs. Past payments stay in the run history. */
export const DELETE = route<Params>(async (_, { params }) => {
  const { member } = await loadMember(params);
  await member.deleteOne();
  return json({ ok: true });
});
