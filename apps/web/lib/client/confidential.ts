'use client';

import { createNoopSigner, type Address, type SignatureBytes } from '@solana/kit';
import type { UiWalletAccount } from '@wallet-standard/react';
import { useCallback, useEffect, useState } from 'react';

import { createRemoteSponsorSigner, createSealedClient, deriveKeys, type ConfidentialKeys, type SealedClient } from '@sealed/core';

import { PUBLIC_RPC_SUBSCRIPTIONS_URL, PUBLIC_RPC_URL } from '../config';
import { api, fromBase64, toBase64 } from './api';
import { useMessageSigner } from './wallet';

// Derived keys live only in this tab's memory. They are never stored or sent anywhere, and
// reloading the page means unlocking again with the wallet.
const keyCache = new Map<string, ConfidentialKeys>();
const keyListeners = new Set<() => void>();

/** The wallet's confidential-balance keys, and a function to derive them with one signature. */
export function useConfidentialKeys(account: UiWalletAccount) {
  const signer = useMessageSigner(account);
  const [keys, setKeys] = useState(() => keyCache.get(account.address));
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    const sync = () => setKeys(keyCache.get(account.address));
    sync();
    keyListeners.add(sync);
    return () => void keyListeners.delete(sync);
  }, [account.address]);

  const unlock = useCallback(async () => {
    const cached = keyCache.get(account.address);
    if (cached) return cached;
    setUnlocking(true);
    try {
      const derived = await deriveKeys(signer);
      keyCache.set(account.address, derived);
      keyListeners.forEach(listener => listener());
      return derived;
    } finally {
      setUnlocking(false);
    }
  }, [account.address, signer]);

  return { keys, unlock, unlocking };
}

/**
 * A client for an employee's own transactions: their wallet signs as owner, and the company
 * co-signs as fee payer through the server (which checks each transaction first).
 */
export function createEmployeeClient(input: { memberId: string; vault: string }): Promise<SealedClient> {
  const sponsor = createRemoteSponsorSigner(input.vault as Address, async wire => {
    const { signature } = await api<{ signature: string }>(`/api/memberships/${input.memberId}/sponsor`, {
      body: { transaction: toBase64(wire) },
    });
    return fromBase64(signature) as SignatureBytes;
  });
  // Inline proofs: no record accounts (which the sponsor refuses), and no room for the extra
  // compute-budget instruction that resource estimation would add.
  return createSealedClient({
    rpcUrl: PUBLIC_RPC_URL,
    rpcSubscriptionsUrl: PUBLIC_RPC_SUBSCRIPTIONS_URL,
    feePayer: sponsor,
    estimateResourceLimits: false,
  });
}

let readOnly: Promise<SealedClient> | null = null;

/** A client for reading the chain only (balances, history). It can't sign anything. */
export function readOnlyClient(): Promise<SealedClient> {
  readOnly ??= createSealedClient({
    rpcUrl: PUBLIC_RPC_URL,
    rpcSubscriptionsUrl: PUBLIC_RPC_SUBSCRIPTIONS_URL,
    feePayer: createNoopSigner('11111111111111111111111111111111' as Address),
  });
  return readOnly;
}
