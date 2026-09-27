import { loadRunAsAdmin } from '@/lib/server/access';
import { json, route } from '@/lib/server/http';
import { Payment } from '@/lib/server/models';
import { resumeIfStale } from '@/lib/server/payroll';
import { decryptAmount } from '@/lib/server/secrets';
import { requireWallet } from '@/lib/server/session';

/** A run's progress, one row per payment. Admin only. Resumes the run if its worker died. */
export const GET = route<{ runId: string }>(async (_, { params }) => {
  const { run, company } = await loadRunAsAdmin((await params).runId, await requireWallet());
  await resumeIfStale({ id: run.id, status: run.status, heartbeatAt: run.heartbeatAt });
  const payments = await Payment.find({ runId: run._id }).sort({ _id: 1 });

  return json({
    run: {
      id: run.id,
      status: run.status,
      count: run.count,
      total: decryptAmount(run.totalEnc),
      createdAt: run.createdAt,
      startedAt: run.startedAt ?? null,
      finishedAt: run.finishedAt ?? null,
      approvalMessage: run.approval?.message ?? null,
    },
    company: { id: company.id, name: company.name, symbol: company.symbol, decimals: company.decimals },
    payments: payments.map(p => ({
      id: p.id,
      name: p.name,
      wallet: p.wallet,
      amount: decryptAmount(p.amountEnc),
      status: p.status,
      signature: p.signature ?? null,
      error: p.error ?? null,
    })),
  });
});
