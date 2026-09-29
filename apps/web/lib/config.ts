// Public configuration, available in the browser and on the server.

export type Cluster = 'devnet' | 'localnet';

export const CLUSTER: Cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER === 'devnet' ? 'devnet' : 'localnet';

export const PUBLIC_RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || (CLUSTER === 'devnet' ? 'https://api.devnet.solana.com' : 'http://127.0.0.1:8899');

/** Websocket endpoint for confirmations; by default derived from the RPC URL. */
export const PUBLIC_RPC_SUBSCRIPTIONS_URL = process.env.NEXT_PUBLIC_RPC_SUBSCRIPTIONS_URL || undefined;

/**
 * Transaction format. With v1 (4,096-byte transactions), each payment and each withdrawal is one
 * transaction with its proofs inline, and no proof accounts. Default: v1 on devnet (verified
 * there), v0 on a local validator (Surfpool's v1 support isn't verified). Override with
 * NEXT_PUBLIC_TRANSACTION_VERSION=0 or 1.
 */
export const TRANSACTION_VERSION: 0 | 1 =
  process.env.NEXT_PUBLIC_TRANSACTION_VERSION === '1' ? 1
  : process.env.NEXT_PUBLIC_TRANSACTION_VERSION === '0' ? 0
  : CLUSTER === 'devnet' ? 1 : 0;

/**
 * The USDC that backs USDC-backed companies (through the Sealed Vault): Circle's devnet USDC on
 * devnet, and mainnet USDC on a local mainnet fork (Surfpool). NEXT_PUBLIC_USDC_MINT overrides.
 */
export const USDC_MINT =
  process.env.NEXT_PUBLIC_USDC_MINT ||
  (CLUSTER === 'devnet' ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

/** The Wallet Standard chain wallets must support to use Sealed. */
export const WALLET_CHAIN = `solana:${CLUSTER}` as const;

/** A built-in browser wallet for demos and testing. Never enabled on mainnet. */
export const TEST_WALLET_ENABLED = process.env.NEXT_PUBLIC_ENABLE_TEST_WALLET !== 'false';

export const DEFAULT_TOKEN_SYMBOL = 'sUSD';

export function explorerUrl(kind: 'address' | 'tx', id: string): string {
  const cluster =
    CLUSTER === 'devnet' ? '?cluster=devnet' : `?cluster=custom&customUrl=${encodeURIComponent(PUBLIC_RPC_URL)}`;
  return `https://explorer.solana.com/${kind}/${id}${cluster}`;
}
