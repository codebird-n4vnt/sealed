import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env } from './env';

// AES-256-GCM with a key from the environment, so the database alone doesn't reveal salaries
// or vault keys. MVP limitation: whoever has both the database and the key can read them.

function key(): Buffer {
  const bytes = Buffer.from(env.dataEncryptionKey, 'base64');
  if (bytes.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded.');
  return bytes;
}

export function encryptBytes(plaintext: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptBytes(encoded: string): Uint8Array {
  const data = Buffer.from(encoded, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return new Uint8Array(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]));
}

export const encryptAmount = (amount: bigint) => encryptBytes(Buffer.from(amount.toString(), 'utf8'));
export const decryptAmount = (encoded: string) => BigInt(Buffer.from(decryptBytes(encoded)).toString('utf8'));
