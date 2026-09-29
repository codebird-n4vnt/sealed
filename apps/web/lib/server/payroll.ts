import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Address, Signature } from '@solana/kit';
import { after } from 'next/server';

import {
  fetchConfidentialTransfers,
  formatAmount,
  getConfidentialBalance,
  payConfidential,
  tokenAccountAddress,
  withReadRetry,
} from '@sealed/core';

import { TRANSACTION_VERSION } from '../config';
import { payrollApprovalMessage } from '../siws';
import { Company, Member, Payment, PayrollRun, type CompanyDoc, type PaymentDoc } from './models';
import { decryptAmount, encryptAmount } from './secrets';
import { settlePayment, type PaymentState, type PaymentStatus } from './settle';
import { companyChain, memberAccountState, type CompanyChain } from './solana';

// Payroll runs are persisted jobs. Transfers from one treasury must run in order (each proof
// depends on the current balance), so a run pays one employee at a time. Each payment is settled
// by settle.ts, which makes sure nobody is paid twice.

const HEARTBEAT_STALE_MS = 60_000;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const activeRuns = new Set<string>();

export type DraftItem = { memberId: string; name: string; wallet: string; amount: bigint };

/**
 * Drafts a payroll run: one payment per member whose private account is ready. Nothing is paid
 * until the admin approves the run's message with a wallet signature.
 */
export async function draftPayrollRun(company: CompanyDoc, createdBy: string) {
  const members = await Member.find({ companyId: company._id }).sort({ createdAt: 1 });
  const items: DraftItem[] = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  for (const member of members) {
    const amount = decryptAmount(member.salaryEnc);
    if (member.status !== 'ready' || !member.wallet) skipped.push({ name: member.name, reason: 'Not onboarded yet' });
    else if (amount <= 0n) skipped.push({ name: member.name, reason: 'No salary set' });
    else items.push({ memberId: member.id, name: member.name, wallet: member.wallet, amount });
  }
  if (items.length === 0) return { run: null, items, skipped, total: 0n };

  const total = items.reduce((sum, item) => sum + item.amount, 0n);
  const run = new PayrollRun({ companyId: company._id, createdBy, totalEnc: encryptAmount(total), count: items.length });
  run.approval = {
    message: payrollApprovalMessage({
      company: company.name,
      runId: run.id,
      payments: items.length,
      total: formatAmount(total, company.decimals),
      symbol: company.symbol,
    }),
  };
  await run.save();
  await Payment.insertMany(
    items.map(item => ({
      runId: run._id,
      companyId: company._id,
      memberId: item.memberId,
      name: item.name,
      wallet: item.wallet,
      amountEnc: encryptAmount(item.amount),
    })),
  );
  return { run, items, skipped, total };
}

/** Runs a payroll run to completion in this process (for scripts; the app uses ensureRunWorker). */
export async function processRun(runId: string): Promise<void> {
  activeRuns.add(runId);
  try {
    await work(runId);
  } finally {
    activeRuns.delete(runId);
  }
}

/**
 * Starts (or resumes) the worker for a running payroll run, if one isn't already active here.
 * Called while handling a request: `after` keeps a serverless function alive until the worker
 * finishes (up to the route's maxDuration); a longer run is resumed by the next progress poll.
 */
export function ensureRunWorker(runId: string): void {
  if (activeRuns.has(runId)) return;
  activeRuns.add(runId);
  const job = work(runId)
    .catch(error => console.error(`Payroll run ${runId} stopped:`, error))
    .finally(() => activeRuns.delete(runId));
  try {
    after(job);
  } catch {
    // Outside a request (a script): the promise simply runs to completion.
  }
}

/** Resumes a run whose worker died (e.g. a server restart). */
export async function resumeIfStale(run: { id: string; status: string; heartbeatAt?: Date | null }) {
  if (run.status !== 'running' || activeRuns.has(run.id)) return;
  if (!run.heartbeatAt || Date.now() - run.heartbeatAt.getTime() > HEARTBEAT_STALE_MS) ensureRunWorker(run.id);
}

async function treasuryAvailable(chain: CompanyChain): Promise<bigint> {
  const balance = await withReadRetry(() =>
    getConfidentialBalance(chain.client, { owner: chain.vault.address, mint: chain.mint, keys: chain.keys }),
  );
  return balance.availableBalance;
}

/**
 * Claims a running run for this worker: only if no worker holds it, it's ours already, or its
 * worker went quiet. Atomic, so across server instances at most one worker pays at a time.
 */
function claimRun(runId: string, workerId: string) {
  const stale = new Date(Date.now() - HEARTBEAT_STALE_MS);
  return PayrollRun.findOneAndUpdate(
    {
      _id: runId,
      status: 'running',
      $or: [{ workerId: { $in: [null, workerId] } }, { heartbeatAt: { $lt: stale } }, { heartbeatAt: null }],
    },
    { workerId, heartbeatAt: new Date() },
    { new: true },
  );
}

async function work(runId: string): Promise<void> {
  const workerId = randomUUID();
  const run = await claimRun(runId, workerId);
  if (!run) return;
  const company = await Company.findById(run.companyId);
  if (!company) throw new Error('Company not found.');
  const chain = await companyChain(company);

  // Refreshes the heartbeat, and stops this worker if another took the run over (e.g. this
  // instance was frozen long enough to look dead). Called before every payment is sent.
  const beat = async () => {
    const { matchedCount } = await PayrollRun.updateOne({ _id: run._id, workerId }, { heartbeatAt: new Date() });
    if (matchedCount === 0) throw new Error('Another worker took over this payroll run.');
  };

  const payments = await Payment.find({ runId: run._id }).sort({ _id: 1 });
  for (const payment of payments) {
    if (payment.status === 'confirmed' || payment.status === 'failed') continue;
    await beat();
    await settle(company, chain, payment, beat);
  }

  const statuses = (await Payment.find({ runId: run._id }, { status: 1 })).map(p => p.status);
  const confirmed = statuses.filter(s => s === 'confirmed').length;
  await PayrollRun.updateOne(
    { _id: run._id, workerId },
    {
      status: confirmed === statuses.length ? 'completed' : confirmed === 0 ? 'failed' : 'partial',
      finishedAt: new Date(),
    },
  );
}

/**
 * For a payment that landed but whose confirmation was lost: the newest transfer from the treasury
 * into the employee's account that no other payment has claimed.
 */
async function findLandedSignature(chain: CompanyChain, payment: PaymentDoc): Promise<string | undefined> {
  try {
    const treasury = await tokenAccountAddress(chain.vault.address, chain.mint);
    const token = await tokenAccountAddress(payment.wallet as Address, chain.mint);
    const transfers = await fetchConfidentialTransfers(chain.client, { tokenAccount: token, limit: 10 });
    for (const transfer of transfers) {
      if (transfer.sourceToken !== treasury || transfer.destinationToken !== token) continue;
      if (!(await Payment.exists({ signature: transfer.signature }))) return transfer.signature;
    }
  } catch {
    // Best effort: the payment is confirmed either way.
  }
  return undefined;
}

async function settle(
  company: CompanyDoc,
  chain: CompanyChain,
  payment: PaymentDoc,
  beat: () => Promise<unknown>,
): Promise<void> {
  const state: PaymentState = {
    status: payment.status as PaymentStatus,
    attempts: payment.attempts,
    treasuryBefore: payment.treasuryBeforeEnc ? decryptAmount(payment.treasuryBeforeEnc) : undefined,
    submittedAt: payment.submittedAt ?? undefined,
    signature: payment.signature ?? undefined,
    error: payment.error ?? undefined,
  };
  await settlePayment(state, {
    amount: decryptAmount(payment.amountEnc),
    treasury: () => treasuryAvailable(chain),
    accountReady: async () => {
      const account = await memberAccountState(company, payment.wallet);
      return account.configured && account.approved;
    },
    pay: async onSubmitted => {
      const result = await payConfidential(chain.client, {
        mint: chain.mint,
        from: { owner: chain.vault, keys: chain.keys },
        to: payment.wallet as Address,
        amount: decryptAmount(payment.amountEnc),
        proofDelivery: TRANSACTION_VERSION === 1 ? 'one-transaction' : 'record',
        onProofsReady: onSubmitted,
      });
      return result.signature;
    },
    landedSignature: () => findLandedSignature(chain, payment),
    signatureSettled: async signature => {
      const { value } = await withReadRetry(() => chain.client.rpc.getSignatureStatuses([signature as Signature]).send());
      const status = value[0];
      return !!status && (!!status.err || status.confirmationStatus !== 'processed');
    },
    blockHeight: () => withReadRetry(() => chain.client.rpc.getBlockHeight({ commitment: 'finalized' }).send()),
    save: async next => {
      payment.status = next.status;
      payment.attempts = next.attempts;
      payment.treasuryBeforeEnc = next.treasuryBefore === undefined ? undefined : encryptAmount(next.treasuryBefore);
      payment.submittedAt = next.submittedAt;
      payment.signature = next.signature;
      payment.error = next.error;
      await payment.save();
    },
    beat,
    now: () => Date.now(),
    sleep,
    log: (message, error) => console.error(`Payment ${payment.id} ${message}:`, error),
  });
}
