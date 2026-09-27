import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { getPublicKeyFromAddress, isAddress, verifySignature, type Address, type SignatureBytes } from '@solana/kit';
import { cookies, headers } from 'next/headers';

import { CLUSTER } from '../config';
import { parseSignInMessage } from '../siws';
import { badRequest, HttpError } from './http';
import { Nonce, Session } from './models';

const COOKIE = 'sealed_session';
const SESSION_DAYS = 7;
const NONCE_MINUTES = 10;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export async function createNonce(): Promise<string> {
  const value = randomBytes(16).toString('hex');
  await Nonce.create({ value, expiresAt: new Date(Date.now() + NONCE_MINUTES * 60_000) });
  return value;
}

/** Verifies an ed25519 signature by `address` over `message`. */
export async function verifyWalletSignature(address: string, message: Uint8Array, signature: Uint8Array) {
  if (!isAddress(address) || signature.length !== 64) return false;
  const publicKey = await getPublicKeyFromAddress(address as Address);
  return await verifySignature(publicKey, signature as SignatureBytes, message);
}

/** Checks a signed Sign-In With Solana message and starts a session for its wallet. */
export async function signIn(input: { message: string; signature: string }): Promise<string> {
  const fields = parseSignInMessage(input.message);
  if (!fields) throw badRequest('Malformed sign-in message.');

  const host = (await headers()).get('host');
  if (fields.domain !== host) throw badRequest('Sign-in message is for another site.');
  if (fields.chainId !== CLUSTER) throw badRequest('Sign-in message is for another network.');
  if (new Date(fields.expirationTime).getTime() < Date.now()) throw badRequest('Sign-in message expired.');

  const signature = Buffer.from(input.signature, 'base64');
  if (!(await verifyWalletSignature(fields.address, new TextEncoder().encode(input.message), signature))) {
    throw new HttpError(401, 'Signature does not match the wallet.');
  }

  // Single use: claim the nonce atomically.
  const nonce = await Nonce.findOneAndUpdate(
    { value: fields.nonce, usedAt: null, expiresAt: { $gt: new Date() } },
    { usedAt: new Date() },
  );
  if (!nonce) throw badRequest('Sign-in request expired. Please try again.');

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await Session.create({ tokenHash: sha256(token), wallet: fields.address, expiresAt });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
  return fields.address;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await Session.deleteOne({ tokenHash: sha256(token) });
  jar.delete(COOKIE);
}

/** The signed-in wallet, or null. */
export async function currentWallet(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = await Session.findOne({ tokenHash: sha256(token), expiresAt: { $gt: new Date() } });
  return session?.wallet ?? null;
}

export async function requireWallet(): Promise<string> {
  const wallet = await currentWallet();
  if (!wallet) throw new HttpError(401, 'Please sign in with your wallet.');
  return wallet;
}
