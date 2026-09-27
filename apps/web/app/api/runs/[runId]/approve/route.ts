import { loadRunAsAdmin } from '@/lib/server/access';
import { badRequest, HttpError, json, readJson, route } from '@/lib/server/http';
import { PayrollRun } from '@/lib/server/models';
import { ensureRunWorker } from '@/lib/server/payroll';
import { decryptAmount } from '@/lib/server/secrets';
import { requireWallet, verifyWalletSignature } from '@/lib/server/session';
import { treasuryBalances } from '@/lib/server/solana';

/** The admin approves a drafted run by signing its approval message; then payroll starts. */
export const POST = route<{ runId: string }>(async (request, { params }) => {
  const wallet = await requireWallet();
  const { run, company } = await loadRunAsAdmin((await params).runId, wallet);
  if (run.status !== 'draft') throw badRequest('This run was already approved.');
  const message = run.approval?.message;
  if (!message) throw badRequest('This run has no approval message.');

  const { signature } = await readJson<{ signature?: string }>(request);
  const signatureBytes = Buffer.from(signature ?? '', 'base64');
  if (!(await verifyWalletSignature(wallet, new TextEncoder().encode(message), signatureBytes))) {
    throw new HttpError(401, 'The approval signature does not match your wallet.');
  }

  const total = decryptAmount(run.totalEnc);
  const { confidential } = await treasuryBalances(company);
  if (confidential < total) throw badRequest('The confidential treasury holds less than this run pays out. Fund it first.');

  // Claim the run atomically, and only if no other run for this company is in progress.
  if (await PayrollRun.exists({ companyId: company._id, status: 'running' })) {
    throw badRequest('Another payroll run is in progress.');
  }
  let claimed;
  try {
    claimed = await PayrollRun.findOneAndUpdate(
      { _id: run._id, status: 'draft' },
      {
        status: 'running',
        startedAt: new Date(),
        heartbeatAt: new Date(),
        'approval.signature': signature,
        'approval.wallet': wallet,
      },
    );
  } catch (error) {
    // The unique index on running runs: another run for this company started meanwhile.
    if ((error as { code?: number }).code === 11000) throw badRequest('Another payroll run is in progress.');
    throw error;
  }
  if (!claimed) throw badRequest('This run was already approved.');

  ensureRunWorker(run.id);
  return json({ status: 'running' });
});
