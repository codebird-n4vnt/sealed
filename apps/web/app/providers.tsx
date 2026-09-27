'use client';

import type { ReactNode } from 'react';

import { SessionProvider } from '@/lib/client/session';
import { WalletProvider } from '@/lib/client/wallet';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <WalletProvider>
      <SessionProvider>{children}</SessionProvider>
    </WalletProvider>
  );
}
