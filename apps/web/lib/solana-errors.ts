/**
 * Recognising and describing Solana failures, on the server and in the browser. Kit's production
 * builds replace error messages with numeric codes, so failures are classified by code, walking
 * the chain of causes kit wraps them in.
 */
import {
  isSolanaError,
  SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SOLANA_ERROR__RPC_SUBSCRIPTIONS__CHANNEL_CLOSED_BEFORE_MESSAGE_BUFFERED,
  SOLANA_ERROR__RPC_SUBSCRIPTIONS__CHANNEL_CONNECTION_CLOSED,
  SOLANA_ERROR__RPC_SUBSCRIPTIONS__CHANNEL_FAILED_TO_CONNECT,
  SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_COMPUTE_LIMIT,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
} from '@solana/kit';

/** A failure and everything it wraps: kit nests the underlying error as `cause`. */
function causes(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let current = error; current && !chain.includes(current) && chain.length < 10; ) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

// Kit's production builds replace error messages with codes, so failures are recognised by code.
const httpStatus = (error: unknown) =>
  isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) ? error.context.statusCode : undefined;
const CONNECTION_LOST = [
  SOLANA_ERROR__RPC_SUBSCRIPTIONS__CHANNEL_FAILED_TO_CONNECT,
  SOLANA_ERROR__RPC_SUBSCRIPTIONS__CHANNEL_CONNECTION_CLOSED,
  SOLANA_ERROR__RPC_SUBSCRIPTIONS__CHANNEL_CLOSED_BEFORE_MESSAGE_BUFFERED,
] as const;
const EXPIRED = [SOLANA_ERROR__BLOCK_HEIGHT_EXCEEDED, SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND] as const;
const NETWORK = /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|timed? ?out/i;

/**
 * Whether a failure is worth another attempt: a rate-limited or failing RPC, a dropped
 * connection, an expired blockhash, or a failed pre-send simulation (a load-balanced RPC can
 * serve a node that hasn't seen the previous payment yet, so the proof was built on a stale
 * balance). A program rejecting the transaction is not.
 */
export function isTransient(error: unknown): boolean {
  return causes(error).some(cause => {
    const status = httpStatus(cause);
    if (status !== undefined) return status === 429 || status >= 500;
    return (
      CONNECTION_LOST.some(code => isSolanaError(cause, code)) ||
      EXPIRED.some(code => isSolanaError(cause, code)) ||
      isSolanaError(cause, SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_COMPUTE_LIMIT) ||
      isSolanaError(cause, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY) ||
      (!isSolanaError(cause) && cause instanceof Error && NETWORK.test(cause.message))
    );
  });
}

/** A readable reason for the run page, in production builds too. */
export function describeFailure(error: unknown): string {
  const chain = causes(error);
  const status = chain.map(httpStatus).find(code => code !== undefined);
  if (status === 429) return 'The RPC is rate-limiting requests (HTTP 429).';
  if (status !== undefined) return `The RPC returned HTTP ${status}.`;
  if (chain.some(cause => CONNECTION_LOST.some(code => isSolanaError(cause, code)))) return 'Lost the connection to the RPC.';
  if (chain.some(cause => EXPIRED.some(code => isSolanaError(cause, code)))) return 'The transaction expired before it was confirmed.';
  if (chain.some(cause => isSolanaError(cause, SOLANA_ERROR__TRANSACTION__FAILED_TO_ESTIMATE_COMPUTE_LIMIT))) {
    return 'The transaction failed its simulation, so it was not sent.';
  }
  if (chain.some(cause => isSolanaError(cause, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_NODE_UNHEALTHY))) return 'The RPC node is unhealthy.';
  // Development builds carry kit's full message; production builds only a code.
  const first = error instanceof Error ? error.message.split('\n')[0] : undefined;
  if (first && !first.startsWith('Solana error #')) return first;
  const innermost = chain.at(-1);
  if (isSolanaError(innermost)) return `Solana error ${innermost.context.__code} (decode with: npx @solana/errors decode -- ${innermost.context.__code}).`;
  return 'Something went wrong.';
}
