import 'server-only';

import { CLUSTER, PUBLIC_RPC_SUBSCRIPTIONS_URL, PUBLIC_RPC_URL } from '../config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See apps/web/.env.example.`);
  return value;
}

export const env = {
  get mongodbUri() {
    return required('MONGODB_URI');
  },
  /** 32 random bytes, base64. Encrypts salaries and vault keys at rest. */
  get dataEncryptionKey() {
    return required('DATA_ENCRYPTION_KEY');
  },
  /** The server's RPC; defaults to the public one. */
  rpcUrl: process.env.RPC_URL ?? PUBLIC_RPC_URL,
  rpcSubscriptionsUrl: process.env.RPC_SUBSCRIPTIONS_URL || PUBLIC_RPC_SUBSCRIPTIONS_URL,
  cluster: CLUSTER,
};

if (CLUSTER !== 'devnet' && CLUSTER !== 'localnet') {
  throw new Error('Sealed runs on devnet or a local validator only.');
}
