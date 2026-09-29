/**
 * Settles one payroll payment: the payroll engine's per-payment state machine. It takes the chain
 * and the database as plain functions, so every path can be tested against a simulated chain
 * (settle.test.ts); payroll.ts wires in the real ones.
 *
 * Payments move pending → proving → submitted → confirmed | failed. Nobody may be paid twice:
 * before retrying an attempt that may have reached the network, the engine waits until that
 * attempt can no longer land (its signature settles on-chain, or its blockhash expires), then
 * compares the treasury balance with the balance recorded before the attempt.
 */

export type PaymentStatus = 'pending' | 'proving' | 'submitted' | 'confirmed' | 'failed';

/** What the engine persists about a payment between steps. */
export type PaymentState = {
  status: PaymentStatus;
  attempts: number;
  /** The treasury's available balance before the latest attempt. */
  treasuryBefore?: bigint;
  /** When the latest attempt was handed to the network. */
  submittedAt?: Date;
  signature?: string;
  error?: string;
};

export type SettleDeps = {
  amount: bigint;
  /** The treasury's available confidential balance, as of now. */
  treasury(): Promise<bigint>;
  /** Whether the employee's private account is configured and approved. */
  accountReady(): Promise<boolean>;
  /** Pays; calls `onSubmitted` just before handing the transaction to the network. */
  pay(onSubmitted: () => Promise<void>): Promise<string>;
  /** Best effort: the signature of a payment that landed without us seeing its confirmation. */
  landedSignature(): Promise<string | undefined>;
  /** Whether a transaction has settled on-chain (confirmed, or failed). */
  signatureSettled(signature: string): Promise<boolean>;
  /** The finalized block height. */
  blockHeight(): Promise<bigint>;
  save(state: PaymentState): Promise<void>;
  /** Keeps the run's heartbeat fresh, so no second worker picks it up during a wait. */
  beat(): Promise<unknown>;
  now(): number;
  sleep(ms: number): Promise<void>;
  log?(message: string, error: unknown): void;
};

/** A blockhash expires after 150 blocks, about a minute; this leaves a wide margin. */
export const IN_FLIGHT_MS = 180_000;
const MAX_WAIT_MS = 600_000;
const POLL_MS = 5_000;
/** Attempts per payment when errors look transient (a busy or rate-limited RPC). */
export const MAX_ATTEMPTS = 3;
const TRANSIENT = /429|Too Many Requests|WebSocket|timed? ?out|fetch failed|ECONNRESET|50[23]|block height exceeded|Blockhash not found/i;

type InFlight = { signature?: string; lastValidBlockHeight?: bigint; submittedAt?: Date };

/**
 * What might still be in flight after a failed attempt. `null` when nothing can be: kit's
 * single-transaction send errors say whether the transaction was signed, and an unsigned one was
 * never sent. Any other error after submission (e.g. a multi-transaction plan's) is treated as
 * possibly in flight, with no signature to watch.
 */
export function inFlightAfter(error: unknown, submitted: boolean): InFlight | null {
  type Context = { signature?: string; message?: { lifetimeConstraint?: { lastValidBlockHeight?: bigint } } };
  const result = (error as { context?: { transactionPlanResult?: { kind?: string; context?: Context } } } | undefined)
    ?.context?.transactionPlanResult;
  if (result?.kind === 'single') {
    const signature = result.context?.signature;
    if (!signature) return null;
    return { signature, lastValidBlockHeight: result.context?.message?.lifetimeConstraint?.lastValidBlockHeight };
  }
  return submitted ? {} : null;
}

/**
 * Waits until an attempt that may be in flight has settled: its signature shows up on-chain, or it
 * can no longer land (past its last valid block height when known, else IN_FLIGHT_MS after it was
 * submitted). Throws after MAX_WAIT_MS, leaving the payment's state for a later resume.
 */
async function waitOutInFlight(deps: SettleDeps, attempt: InFlight): Promise<void> {
  const started = deps.now();
  const deadline = (attempt.submittedAt?.getTime() ?? started) + IN_FLIGHT_MS;
  for (;;) {
    await deps.beat();
    if (attempt.signature && (await deps.signatureSettled(attempt.signature))) return;
    if (attempt.lastValidBlockHeight !== undefined) {
      if ((await deps.blockHeight()) > attempt.lastValidBlockHeight) return;
    } else if (deps.now() >= deadline) {
      return;
    }
    if (deps.now() - started > MAX_WAIT_MS) throw new Error('Timed out waiting for an in-flight payment to expire.');
    await deps.sleep(POLL_MS);
  }
}

async function confirm(state: PaymentState, deps: SettleDeps, signature?: string) {
  state.status = 'confirmed';
  state.error = undefined;
  state.signature ??= signature ?? (await deps.landedSignature());
  await deps.save(state);
}

async function fail(state: PaymentState, deps: SettleDeps, error: string) {
  state.status = 'failed';
  state.error = error;
  await deps.save(state);
}

export async function settlePayment(state: PaymentState, deps: SettleDeps): Promise<void> {
  let available = await deps.treasury();

  // A previous attempt was interrupted: find out whether it landed before trying again.
  if ((state.status === 'proving' || state.status === 'submitted') && state.treasuryBefore !== undefined) {
    const before = state.treasuryBefore;
    if (available === before && state.status === 'submitted') {
      // It was handed to the network and may still land: wait until it can't, then look again.
      await waitOutInFlight(deps, { submittedAt: state.submittedAt });
      available = await deps.treasury();
    }
    if (available === before - deps.amount) return confirm(state, deps);
    if (available !== before) {
      return fail(state, deps, 'The treasury balance changed while this payment was in flight. Check the explorer before paying again.');
    }
  }

  if (available < deps.amount) return fail(state, deps, 'Not enough in the confidential treasury.');
  if (!(await deps.accountReady())) return fail(state, deps, "The employee's private account isn't set up yet.");

  state.treasuryBefore = available;
  state.status = 'proving';
  state.submittedAt = undefined;
  state.attempts += 1;
  await deps.save(state);

  try {
    const signature = await deps.pay(async () => {
      state.status = 'submitted';
      state.submittedAt = new Date(deps.now());
      await deps.save(state);
    });
    state.status = 'confirmed';
    state.signature = signature;
    state.error = undefined;
    await deps.save(state);
  } catch (error) {
    // Sending or confirming can fail after the transaction reached a validator (e.g. a
    // rate-limited RPC), so it may still land. Wait until it can't, then look at the treasury.
    // `pay` may have moved the payment to 'submitted' through its callback.
    const inFlight = inFlightAfter(error, (state.status as PaymentStatus) === 'submitted');
    if (inFlight) await waitOutInFlight(deps, { ...inFlight, submittedAt: state.submittedAt });
    if ((await deps.treasury()) === available - deps.amount) return confirm(state, deps, inFlight?.signature);

    // It didn't land and now can't, so trying again is safe.
    const message = error instanceof Error ? error.message.split('\n')[0]! : 'Transfer failed.';
    deps.log?.(`attempt ${state.attempts} failed`, error);
    if (state.attempts < MAX_ATTEMPTS && TRANSIENT.test(message)) {
      state.status = 'pending';
      state.error = message;
      await deps.save(state);
      await deps.sleep(2_000 * 2 ** (state.attempts - 1)); // give a rate-limited RPC room: 2s, then 4s
      await deps.beat();
      return settlePayment(state, deps);
    }
    return fail(state, deps, message);
  }
}
