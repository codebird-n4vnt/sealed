import 'server-only';

import { isValidObjectId } from 'mongoose';

import { forbidden, notFound } from './http';
import { Company, Member, PayrollRun } from './models';

export async function loadCompany(companyId: string) {
  const company = isValidObjectId(companyId) ? await Company.findById(companyId) : null;
  if (!company) throw notFound('Company not found.');
  return company;
}

/** The company, if `wallet` is its admin. */
export async function loadCompanyAsAdmin(companyId: string, wallet: string) {
  const company = await loadCompany(companyId);
  if (company.adminWallet !== wallet) throw forbidden('Only the company admin can do this.');
  return company;
}

/** A membership belonging to `wallet`, with its company. */
export async function loadOwnMembership(memberId: string, wallet: string) {
  const member = isValidObjectId(memberId) ? await Member.findById(memberId) : null;
  if (!member || member.wallet !== wallet) throw notFound('Membership not found.');
  const company = await loadCompany(member.companyId.toString());
  return { member, company };
}

/** A payroll run, if `wallet` administers its company. */
export async function loadRunAsAdmin(runId: string, wallet: string) {
  const run = isValidObjectId(runId) ? await PayrollRun.findById(runId) : null;
  if (!run) throw notFound('Payroll run not found.');
  const company = await loadCompanyAsAdmin(run.companyId.toString(), wallet);
  return { run, company };
}
