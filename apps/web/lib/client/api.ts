'use client';

import { describeFailure } from '../solana-errors';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls a Sealed API route and returns its JSON, throwing the server's error message. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status}).`);
  return data as T;
}

export const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Wallet rejections read better as a short sentence.
    if (/reject|denied|cancel/i.test(error.message)) return 'You cancelled the request in your wallet.';
    return describeFailure(error);
  }
  return 'Something went wrong.';
}
