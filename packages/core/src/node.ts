// Node-only helpers (filesystem). Kept out of the main entry so browser apps can import @sealed/core.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import {
  createKeyPairSignerFromBytes,
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  type KeyPairSigner,
} from '@solana/kit';

/** Loads a Solana CLI keypair file (a JSON array of 64 bytes). */
export async function loadKeypairSigner(path: string): Promise<KeyPairSigner> {
  const bytes = new Uint8Array(JSON.parse(readFileSync(path, 'utf8')) as number[]);
  return await createKeyPairSignerFromBytes(bytes);
}

/** Loads a keypair file, or creates one (CLI format, owner-only permissions) if it doesn't exist. */
export async function loadOrCreateKeypairSigner(path: string): Promise<KeyPairSigner> {
  if (existsSync(path)) return await loadKeypairSigner(path);

  const seed = crypto.getRandomValues(new Uint8Array(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const publicKey = getAddressEncoder().encode(signer.address);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify([...seed, ...publicKey]), { mode: 0o600 });
  return signer;
}
