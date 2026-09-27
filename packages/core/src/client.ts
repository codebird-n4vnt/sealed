import { token2022Program } from '@solana-program/token-2022';
import { createClient, type TransactionSigner } from '@solana/kit';
import { solanaRpc } from '@solana/kit-plugin-rpc';
import { payer } from '@solana/kit-plugin-signer';

const CLUSTER_URLS: Record<string, string> = {
  devnet: 'https://api.devnet.solana.com',
  localnet: 'http://127.0.0.1:8899',
};

/** Resolves `devnet` / `localnet` shorthands to a URL; anything else is used as given. */
export function resolveRpcUrl(rpcUrl: string): string {
  return CLUSTER_URLS[rpcUrl] ?? rpcUrl;
}

/**
 * A local validator (solana-test-validator, Surfpool) serves websockets on the RPC port + 1.
 * Hosted RPCs serve them on the same host and port, which is what kit assumes by default.
 */
function defaultSubscriptionsUrl(rpcUrl: string): string | undefined {
  const url = new URL(rpcUrl);
  if (!['127.0.0.1', 'localhost', '0.0.0.0'].includes(url.hostname)) return undefined;
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.port = String(Number(url.port || 80) + 1);
  return url.toString();
}

export type SealedClientConfig = {
  /** RPC URL, or `devnet` / `localnet`. */
  rpcUrl: string;
  rpcSubscriptionsUrl?: string;
  /** Pays every transaction fee and rent deposit. In Sealed this is always the company. */
  feePayer: TransactionSigner;
};

/**
 * A kit client wired for Sealed: Token-2022 helpers, an RPC connection, and the company
 * as the fee payer, so employees never need SOL.
 */
export async function createSealedClient(config: SealedClientConfig) {
  const rpcUrl = resolveRpcUrl(config.rpcUrl);
  const rpcSubscriptionsUrl = config.rpcSubscriptionsUrl ?? defaultSubscriptionsUrl(rpcUrl);
  return await createClient()
    .use(payer(config.feePayer))
    .use(solanaRpc({ rpcUrl, ...(rpcSubscriptionsUrl ? { rpcSubscriptionsUrl } : {}) }))
    .use(token2022Program());
}

export type SealedClient = Awaited<ReturnType<typeof createSealedClient>>;
