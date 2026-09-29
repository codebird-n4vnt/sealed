/**
 * The payroll engine's per-payment state machine against a simulated chain: a clock, block
 * heights, a treasury, and transactions that land late or never. The property that matters most:
 * however sending fails, the treasury is debited at most once per payment.
 */
import {
  SOLANA_ERROR__FAILED_TO_SEND_TRANSACTION,
  SOLANA_ERROR__FAILED_TO_SEND_TRANSACTIONS,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SOLANA_ERROR__RPC_SUBSCRIPTIONS__CHANNEL_FAILED_TO_CONNECT,
  SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_COMPUTE_LIMIT,
  SolanaError,
  type SolanaErrorCode,
} from '@solana/kit';
import { describe, expect, it } from 'vitest';

import { describeFailure, isTransient } from '../solana-errors';
import { IN_FLIGHT_MS, MAX_ATTEMPTS, settlePayment, type PaymentState, type PaymentStatus, type SettleDeps } from './settle';

const AMOUNT = 4_200n;
const MS_PER_BLOCK = 400;
const BLOCKHASH_LIFETIME = 150n;

/** What one call to `pay` does. `landsAfterMs`: an in-flight transaction lands that much later. */
type Attempt =
  | { kind: 'ok' }
  | { kind: 'unsigned' } // rate-limited before signing, e.g. fetching a blockhash
  | { kind: 'simulation' } // the pre-send simulation failed, e.g. on a stale balance
  | { kind: 'signed'; landsAfterMs?: number } // signed and sent, then the RPC failed
  | { kind: 'plural'; landsAfterMs?: number } // a multi-transaction plan failed; no one signature
  | { kind: 'fatal'; message: string }; // rejected outright, e.g. a program error

const error = (code: SolanaErrorCode, context: object = {}) => new SolanaError(code as never, context as never);
const rateLimited = () => error(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: 'Too Many Requests', statusCode: 429 });
const disconnected = () => error(SOLANA_ERROR__RPC_SUBSCRIPTIONS__CHANNEL_FAILED_TO_CONNECT, { errorEvent: {} });

/** Built like kit's executor errors: the cause wrapped, the failed result on a hidden context field. */
function sendError(code: SolanaErrorCode, cause: unknown, transactionPlanResult: unknown): Error {
  const context = { cause, causeMessage: '' };
  Object.defineProperty(context, 'transactionPlanResult', { value: transactionPlanResult, enumerable: false });
  return error(code, context);
}

function world(input: { treasury?: bigint; attempts: Attempt[]; accountReady?: boolean }) {
  let time = 0;
  let treasury = input.treasury ?? 100_000n;
  let debits = 0;
  let sent = 0;
  const inFlight: Array<{ signature: string; landsAt?: number; lastValidBlockHeight: bigint }> = [];
  const landed = new Set<string>();
  const saved: PaymentStatus[] = [];
  const retriesAt: number[] = [];
  let beats = 0;

  const height = () => 1_000n + BigInt(Math.floor(time / MS_PER_BLOCK));
  const land = (signature: string) => {
    treasury -= AMOUNT;
    debits += 1;
    landed.add(signature);
  };
  // Lands whatever is due, but never after its blockhash expired.
  const tick = () => {
    for (const tx of [...inFlight]) {
      if (tx.landsAt !== undefined && tx.landsAt <= time && height() <= tx.lastValidBlockHeight) {
        land(tx.signature);
        inFlight.splice(inFlight.indexOf(tx), 1);
      }
    }
  };
  const later = (signature: string, landsAfterMs?: number) =>
    inFlight.push({ signature, landsAt: landsAfterMs === undefined ? undefined : time + landsAfterMs, lastValidBlockHeight: height() + BLOCKHASH_LIFETIME });

  const deps: SettleDeps = {
    amount: AMOUNT,
    treasury: async () => (tick(), treasury),
    accountReady: async () => input.accountReady ?? true,
    pay: async onSubmitted => {
      retriesAt.push(time);
      const attempt = input.attempts.shift() ?? { kind: 'ok' };
      if (attempt.kind === 'fatal') throw new Error(attempt.message);
      await onSubmitted();
      const signature = `sig${++sent}`;
      switch (attempt.kind) {
        case 'ok':
          land(signature);
          return signature;
        case 'unsigned':
          throw sendError(SOLANA_ERROR__FAILED_TO_SEND_TRANSACTION, rateLimited(), { kind: 'single', context: {} });
        case 'simulation':
          throw sendError(SOLANA_ERROR__FAILED_TO_SEND_TRANSACTION, error(SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_COMPUTE_LIMIT), {
            kind: 'single',
            context: {},
          });
        case 'signed':
          later(signature, attempt.landsAfterMs);
          throw sendError(SOLANA_ERROR__FAILED_TO_SEND_TRANSACTION, rateLimited(), {
            kind: 'single',
            context: { signature, message: { lifetimeConstraint: { lastValidBlockHeight: height() + BLOCKHASH_LIFETIME } } },
          });
        case 'plural':
          later(signature, attempt.landsAfterMs);
          throw sendError(SOLANA_ERROR__FAILED_TO_SEND_TRANSACTIONS, disconnected(), { kind: 'sequential', plans: [] });
      }
    },
    landedSignature: async () => [...landed].at(-1),
    signatureSettled: async signature => (tick(), landed.has(signature)),
    blockHeight: async () => height(),
    save: async state => void saved.push(state.status),
    beat: async () => void (beats += 1),
    now: () => time,
    sleep: async ms => {
      time += ms;
      tick();
    },
  };
  return {
    deps,
    get treasury() {
      return treasury;
    },
    get debits() {
      return debits;
    },
    get time() {
      return time;
    },
    get beats() {
      return beats;
    },
    saved,
    retriesAt,
    height,
  };
}

const fresh = (): PaymentState => ({ status: 'pending', attempts: 0 });

describe('settlePayment', () => {
  it('pays once and records the signature', async () => {
    const w = world({ attempts: [{ kind: 'ok' }] });
    const state = fresh();
    await settlePayment(state, w.deps);
    expect(state).toMatchObject({ status: 'confirmed', signature: 'sig1', attempts: 1 });
    expect(w.saved).toEqual(['proving', 'submitted', 'confirmed']);
    expect(w.debits).toBe(1);
  });

  it('retries a rate limit hit before signing at once, after a short backoff', async () => {
    const w = world({ attempts: [{ kind: 'unsigned' }, { kind: 'ok' }] });
    const state = fresh();
    await settlePayment(state, w.deps);
    expect(state).toMatchObject({ status: 'confirmed', signature: 'sig2', attempts: 2 });
    expect(w.debits).toBe(1);
    expect(w.retriesAt).toEqual([0, 2_000]); // no wait for expiry: nothing was sent
  });

  it('retries a failed pre-send simulation, recognised by its error code alone', async () => {
    const w = world({ attempts: [{ kind: 'simulation' }, { kind: 'ok' }] });
    const state = fresh();
    await settlePayment(state, w.deps);
    expect(state).toMatchObject({ status: 'confirmed', attempts: 2 });
    expect(w.debits).toBe(1);
  });

  it('does not pay twice when a signed transaction lands after its send failed', async () => {
    const w = world({ attempts: [{ kind: 'signed', landsAfterMs: 20_000 }] });
    const state = fresh();
    await settlePayment(state, w.deps);
    expect(state).toMatchObject({ status: 'confirmed', signature: 'sig1', attempts: 1 });
    expect(w.debits).toBe(1);
    expect(w.retriesAt).toEqual([0]);
  });

  it('retries a signed transaction that never landed only after its blockhash expired', async () => {
    const w = world({ attempts: [{ kind: 'signed' }, { kind: 'ok' }] });
    const state = fresh();
    await settlePayment(state, w.deps);
    expect(state).toMatchObject({ status: 'confirmed', signature: 'sig2', attempts: 2 });
    expect(w.debits).toBe(1);
    const expiry = Number(BLOCKHASH_LIFETIME) * MS_PER_BLOCK;
    expect(w.retriesAt[1]).toBeGreaterThan(expiry);
    expect(w.beats).toBeGreaterThan(Math.floor(expiry / 5_000)); // the heartbeat kept going while waiting
  });

  it('treats an unreadable failure after submission as in flight, and waits it out', async () => {
    const w = world({ attempts: [{ kind: 'plural', landsAfterMs: 50_000 }] });
    const state = fresh();
    await settlePayment(state, w.deps);
    expect(state).toMatchObject({ status: 'confirmed', signature: 'sig1' });
    expect(w.debits).toBe(1);
    expect(w.time).toBeGreaterThanOrEqual(IN_FLIGHT_MS);
  });

  it('pays again after an unreadable failure only once the attempt certainly expired', async () => {
    const w = world({ attempts: [{ kind: 'plural' }, { kind: 'ok' }] });
    const state = fresh();
    await settlePayment(state, w.deps);
    expect(state).toMatchObject({ status: 'confirmed', signature: 'sig2', attempts: 2 });
    expect(w.debits).toBe(1);
    expect(w.retriesAt[1]).toBeGreaterThanOrEqual(IN_FLIGHT_MS);
  });

  it('fails without retrying on an error that is not transient', async () => {
    const w = world({ attempts: [{ kind: 'fatal', message: 'custom program error: 0x1' }] });
    const state = fresh();
    await settlePayment(state, w.deps);
    expect(state).toMatchObject({ status: 'failed', error: 'custom program error: 0x1', attempts: 1 });
    expect(w.debits).toBe(0);
  });

  it(`gives up after ${MAX_ATTEMPTS} transient failures`, async () => {
    const w = world({ attempts: Array.from({ length: 5 }, () => ({ kind: 'unsigned' as const })) });
    const state = fresh();
    await settlePayment(state, w.deps);
    expect(state).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, error: 'The RPC is rate-limiting requests (HTTP 429).' });
    expect(w.retriesAt).toHaveLength(MAX_ATTEMPTS);
    expect(w.debits).toBe(0);
  });

  it('stops before sending anything once another worker has taken the run over', async () => {
    const w = world({ attempts: [{ kind: 'ok' }] });
    const lost = { ...w.deps, beat: async () => { throw new Error('Another worker took over this payroll run.'); } };
    await expect(settlePayment(fresh(), lost)).rejects.toThrow(/took over/);
    expect(w.retriesAt).toHaveLength(0);
    expect(w.debits).toBe(0);
  });

  it('refuses when the treasury is short, or the employee is not set up', async () => {
    const short = world({ treasury: 100n, attempts: [] });
    const a = fresh();
    await settlePayment(a, short.deps);
    expect(a).toMatchObject({ status: 'failed', error: 'Not enough in the confidential treasury.', attempts: 0 });

    const notReady = world({ attempts: [], accountReady: false });
    const b = fresh();
    await settlePayment(b, notReady.deps);
    expect(b.status).toBe('failed');
    expect(short.retriesAt.length + notReady.retriesAt.length).toBe(0);
  });
});

describe('settlePayment, resuming after a crash', () => {
  const interrupted = (status: PaymentStatus, treasuryBefore: bigint, submittedAt?: Date): PaymentState => ({
    status,
    attempts: 1,
    treasuryBefore,
    submittedAt,
  });

  it('marks a payment that landed as paid, without paying again', async () => {
    const w = world({ treasury: 100_000n - AMOUNT, attempts: [] });
    const state = interrupted('submitted', 100_000n, new Date(0));
    await settlePayment(state, w.deps);
    expect(state.status).toBe('confirmed');
    expect(w.retriesAt).toHaveLength(0);
  });

  it('waits out a submitted attempt that has not landed yet before paying again', async () => {
    const w = world({ attempts: [{ kind: 'ok' }] });
    const state = interrupted('submitted', 100_000n, new Date(0));
    await settlePayment(state, w.deps);
    expect(state).toMatchObject({ status: 'confirmed', attempts: 2 });
    expect(w.retriesAt[0]).toBeGreaterThanOrEqual(IN_FLIGHT_MS);
    expect(w.debits).toBe(1);
  });

  it('pays at once when the crash came before anything was submitted', async () => {
    const w = world({ attempts: [{ kind: 'ok' }] });
    const state = interrupted('proving', 100_000n);
    await settlePayment(state, w.deps);
    expect(state.status).toBe('confirmed');
    expect(w.retriesAt).toEqual([0]);
  });

  it('stops when the treasury moved by some other amount', async () => {
    const w = world({ treasury: 90_000n, attempts: [] });
    const state = interrupted('proving', 100_000n);
    await settlePayment(state, w.deps);
    expect(state.status).toBe('failed');
    expect(state.error).toMatch(/treasury balance changed/);
    expect(w.retriesAt).toHaveLength(0);
  });
});

describe('failure classification', () => {
  it('reads codes, not messages, so production builds behave the same', () => {
    expect(isTransient(sendError(SOLANA_ERROR__FAILED_TO_SEND_TRANSACTION, rateLimited(), { kind: 'single' }))).toBe(true);
    expect(isTransient(error(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, { headers: new Headers(), message: '', statusCode: 400 }))).toBe(false);
    expect(isTransient(sendError(SOLANA_ERROR__FAILED_TO_SEND_TRANSACTIONS, disconnected(), { kind: 'sequential' }))).toBe(true);
    expect(isTransient(new Error('custom program error: 0x1'))).toBe(false);
    expect(isTransient(new TypeError('fetch failed'))).toBe(true);
  });

  it('describes failures readably', () => {
    expect(describeFailure(sendError(SOLANA_ERROR__FAILED_TO_SEND_TRANSACTIONS, disconnected(), { kind: 'sequential' }))).toBe(
      'Lost the connection to the RPC.',
    );
    expect(describeFailure(error(SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_COMPUTE_LIMIT))).toMatch(/simulation/);
    expect(describeFailure(new Error('custom program error: 0x1\nlogs…'))).toBe('custom program error: 0x1');
  });
});
