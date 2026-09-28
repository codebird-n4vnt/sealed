import 'server-only';

import type { Address, Signature } from '@solana/kit';

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
import { companyChain, memberAccountState, type CompanyChain } from './solana';

// Payroll runs are persisted jobs. Payments move pending → proving → submitted → confirmed | failed.
// Transfers from one treasury must run in order (each proof depends on the current balance), so a
// run pays one employee at a time. Nobody may be paid twice: before retrying a payment that was in
// flight, the engine waits until that attempt can no longer land (its blockhash has expired), then
// compares the treasury balance with the balance recorded before the attempt.

const HEARTBEAT_STALE_MS = 60_000;
/** A blockhash expires after 150 blocks, about a minute; this leaves a wide margin. */
const IN_FLIGHT_MS = 180_000;
const MAX_WAIT_MS = 600_000;
/** Attempts per payment when errors look transient (a busy or rate-limited RPC). */
const MAX_ATTEMPTS = 3;
const TRANSIENT = /429|Too Many Requests|WebSocket|timed? ?out|fetch failed|ECONNRESET|50[23]|block height exceeded|Blockhash not found/i;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
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

/** Starts (or resumes) the worker for a running payroll run, if one isn't already active. */
export function ensureRunWorker(runId: string): void {
  if (activeRuns.has(runId)) return;
  activeRuns.add(runId);
  void work(runId)
    .catch(error => console.error(`Payroll run ${runId} stopped:`, error))
    .finally(() => activeRuns.delete(runId));
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

/** The signature and expiry of the transaction an error came from, if it got as far as signing. */
function signedTransaction(error: unknown): { signature: string; lastValidBlockHeight?: bigint } | undefined {
  type Context = { signature?: string; message?: { lifetimeConstraint?: { lastValidBlockHeight?: bigint } } };
  const context = (error as { context?: { transactionPlanResult?: { context?: Context } } } | undefined)?.context
    ?.transactionPlanResult?.context;
  if (!context?.signature) return undefined;
  return { signature: context.signature, lastValidBlockHeight: context.message?.lifetimeConstraint?.lastValidBlockHeight };
}

/**
 * Waits until a transaction that may still be in flight has settled: it shows up on-chain
 * (confirmed or failed), or it can no longer land, being past its last valid block height when
 * that's known, else IN_FLIGHT_MS after it was submitted. Keeps the run's heartbeat fresh
 * meanwhile, so no second worker picks the run up.
 */
async function waitOutInFlight(
  chain: CompanyChain,
  attempt: { signature?: string; lastValidBlockHeight?: bigint; submittedAt?: Date | null },
  beat: () => Promise<unknown>,
): Promise<void> {
  const started = Date.now();
  const deadline = (attempt.submittedAt?.getTime() ?? started) + IN_FLIGHT_MS;
  for (;;) {
    await beat();
    if (attempt.signature) {
      const signature = attempt.signature as Signature;
      const { value } = await withReadRetry(() => chain.client.rpc.getSignatureStatuses([signature]).send());
      const status = value[0];
      if (status && (status.err || status.confirmationStatus !== 'processed')) return;
    }
    if (attempt.lastValidBlockHeight !== undefined) {
      const height = await withReadRetry(() => chain.client.rpc.getBlockHeight({ commitment: 'finalized' }).send());
      if (height > attempt.lastValidBlockHeight) return;
    } else if (Date.now() >= deadline) {
      return;
    }
    // Stop the worker rather than guess; the run resumes later from the recorded state.
    if (Date.now() - started > MAX_WAIT_MS) throw new Error('Timed out waiting for an in-flight payment to expire.');
    await sleep(5_000);
  }
}

async function work(runId: string): Promise<void> {
  const run = await PayrollRun.findById(runId);
  if (!run || run.status !== 'running') return;
  const company = await Company.findById(run.companyId);
  if (!company) throw new Error('Company not found.');
  const chain = await companyChain(company);

  const payments = await Payment.find({ runId: run._id }).sort({ _id: 1 });
  const beat = () => PayrollRun.updateOne({ _id: run._id }, { heartbeatAt: new Date() });
  for (const payment of payments) {
    if (payment.status === 'confirmed' || payment.status === 'failed') continue;
    await beat();
    await settle(company, chain, payment, beat);
  }

  const statuses = (await Payment.find({ runId: run._id }, { status: 1 })).map(p => p.status);
  const confirmed = statuses.filter(s => s === 'confirmed').length;
  run.status = confirmed === statuses.length ? 'completed' : confirmed === 0 ? 'failed' : 'partial';
  run.finishedAt = new Date();
  await run.save();
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

async function confirmLanded(chain: CompanyChain, payment: PaymentDoc, signature?: string) {
  payment.status = 'confirmed';
  payment.error = undefined;
  payment.signature ??= signature ?? (await findLandedSignature(chain, payment));
  await payment.save();
}

async function fail(payment: PaymentDoc, error: string) {
  payment.status = 'failed';
  payment.error = error;
  await payment.save();
}

async function settle(
  company: CompanyDoc,
  chain: CompanyChain,
  payment: PaymentDoc,
  beat: () => Promise<unknown>,
): Promise<void> {
  const amount = decryptAmount(payment.amountEnc);
  let available = await treasuryAvailable(chain);

  // A previous attempt was interrupted: find out whether it landed before trying again.
  if ((payment.status === 'proving' || payment.status === 'submitted') && payment.treasuryBeforeEnc) {
    const before = decryptAmount(payment.treasuryBeforeEnc);
    if (available === before && payment.status === 'submitted') {
      // It was handed to the network and may still land: wait until it can't, then look again.
      await waitOutInFlight(chain, { submittedAt: payment.submittedAt }, beat);
      available = await treasuryAvailable(chain);
    }
    if (available === before - amount) return confirmLanded(chain, payment);
    if (available !== before) {
      return fail(payment, 'The treasury balance changed while this payment was in flight. Check the explorer before paying again.');
    }
  }

  if (available < amount) return fail(payment, 'Not enough in the confidential treasury.');
  const account = await memberAccountState(company, payment.wallet);
  if (!account.configured || !account.approved) return fail(payment, "The employee's private account isn't set up yet.");

  payment.treasuryBeforeEnc = encryptAmount(available);
  payment.status = 'proving';
  payment.attempts += 1;
  await payment.save();

  try {
    const result = await payConfidential(chain.client, {
      mint: chain.mint,
      from: { owner: chain.vault, keys: chain.keys },
      to: payment.wallet as Address,
      amount,
      proofDelivery: TRANSACTION_VERSION === 1 ? 'one-transaction' : 'record',
      onProofsReady: async () => {
        payment.status = 'submitted';
        payment.submittedAt = new Date();
        await payment.save();
      },
    });
    payment.status = 'confirmed';
    payment.signature = result.signature;
    payment.error = undefined;
    await payment.save();
  } catch (error) {
    // Sending or confirming can fail after the transaction reached a validator (e.g. a
    // rate-limited RPC), so a signed transaction may still land. Wait until it can't.
    const signed = signedTransaction(error);
    if (signed) {
      await waitOutInFlight(chain, { ...signed, submittedAt: payment.submittedAt }, beat);
    }
    if ((await treasuryAvailable(chain)) === available - amount) return confirmLanded(chain, payment, signed?.signature);

    // It didn't land and now can't, so trying again is safe.
    const message = error instanceof Error ? error.message.split('\n')[0]! : 'Transfer failed.';
    console.error(`Payment ${payment.id} attempt ${payment.attempts} failed:`, error);
    if (payment.attempts < MAX_ATTEMPTS && TRANSIENT.test(message)) {
      payment.status = 'pending';
      payment.error = message;
      await payment.save();
      await sleep(2_000 * 2 ** (payment.attempts - 1)); // give a rate-limited RPC room: 2s, then 4s
      await beat();
      return settle(company, chain, payment, beat);
    }
    await fail(payment, message);
  }
}
