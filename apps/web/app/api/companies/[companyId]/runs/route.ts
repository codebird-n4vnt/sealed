import { loadCompanyAsAdmin } from '@/lib/server/access';
import { isDemoCompany } from '@/lib/server/demo';
import { badRequest, HttpError, json, route } from '@/lib/server/http';
import { PayrollRun } from '@/lib/server/models';
import { draftPayrollRun } from '@/lib/server/payroll';
import { requireWallet } from '@/lib/server/session';

/** Drafts a payroll run for the admin to review and approve. */
export const POST = route<{ companyId: string }>(async (_, { params }) => {
  const wallet = await requireWallet();
  const company = await loadCompanyAsAdmin((await params).companyId, wallet);
  if (company.status !== 'ready') throw badRequest('Finish setting up the company first.');
  if (await PayrollRun.exists({ companyId: company._id, status: 'running' })) {
    throw badRequest('A payroll run is already in progress.');
  }
  // Anyone can sign in as the public demo's admin, so its runs are spaced out.
  if (isDemoCompany(company) && (await PayrollRun.exists({ companyId: company._id, createdAt: { $gt: new Date(Date.now() - 60_000) } }))) {
    throw new HttpError(429, 'The demo company ran payroll less than a minute ago. Try again shortly.');
  }

  const { run, items, skipped, total } = await draftPayrollRun(company, wallet);
  if (!run) throw badRequest('Nobody is ready to be paid yet. Invite your team and wait for them to join.');

  return json(
    {
      runId: run.id,
      approvalMessage: run.approval?.message,
      total,
      items: items.map(({ name, wallet, amount }) => ({ name, wallet, amount })),
      skipped,
    },
    { status: 201 },
  );
});
