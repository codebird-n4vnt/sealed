'use client';

import type { UiWalletAccount } from '@wallet-standard/react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { CLUSTER } from '../config';
import { createSignInMessage, SIGN_IN_STATEMENT } from '../siws';
import { api, toBase64 } from './api';
import { useSignText } from './wallet';

type SessionState = {
  /** The signed-in wallet; undefined while loading. */
  wallet: string | null | undefined;
  setWallet: (wallet: string | null) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    api<{ wallet: string | null }>('/api/auth/session')
      .then(session => setWallet(session.wallet))
      .catch(() => setWallet(null));
  }, []);
  const signOut = useCallback(async () => {
    await api('/api/auth/session', { method: 'DELETE' });
    setWallet(null);
  }, []);
  return <SessionContext.Provider value={{ wallet, setWallet, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider.');
  return session;
}

/** Signs in with Sign-In With Solana: the wallet signs a one-time message, nothing on-chain. */
export function useSignIn(account: UiWalletAccount) {
  const { setWallet } = useSession();
  const signText = useSignText(account);
  return async () => {
    const { nonce } = await api<{ nonce: string }>('/api/auth/nonce');
    const now = new Date();
    const message = createSignInMessage({
      domain: window.location.host,
      address: account.address,
      statement: SIGN_IN_STATEMENT,
      uri: window.location.origin,
      chainId: CLUSTER,
      nonce,
      issuedAt: now.toISOString(),
      expirationTime: new Date(now.getTime() + 10 * 60_000).toISOString(),
    });
    const signature = await signText(message);
    const { wallet } = await api<{ wallet: string }>('/api/auth/verify', {
      body: { message, signature: toBase64(signature) },
    });
    setWallet(wallet);
  };
}
