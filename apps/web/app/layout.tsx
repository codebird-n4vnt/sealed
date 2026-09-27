import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { WalletButton } from '@/components/wallet-button';
import { CLUSTER } from '@/lib/config';

import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Sealed · Private payroll on Solana',
  description:
    'Pay your team in stablecoins on Solana. Only the employer, the employee and the accountant can see how much anyone earns.',
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <circle cx="16" cy="16" r="14" fill="var(--wax)" />
        <circle cx="16" cy="16" r="9.5" fill="none" stroke="var(--bg)" strokeWidth="1.5" strokeDasharray="2 2.2" />
        <path d="M12.5 17.5c0-1.4 1.5-2 3.5-2s3.5-.6 3.5-2-1.6-2-3.5-2M12.5 17.5c0 1.4 1.6 2 3.5 2s3.5-.6 3.5-2" stroke="var(--bg)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
      Sealed
    </Link>
  );
}

const NAV = [
  { href: '/company', label: 'Company' },
  { href: '/me', label: 'My pay' },
  { href: '/audit', label: 'Accountant' },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        <Providers>
          <header className="sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur">
            <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
              <Logo />
              <nav className="hidden items-center gap-1 text-sm sm:flex">
                {NAV.map(item => (
                  <Link key={item.href} href={item.href} className="rounded-lg px-3 py-2 text-muted hover:bg-surface-2 hover:text-ink">
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="ml-auto flex items-center gap-3">
                <span className="hidden rounded-full border border-line px-2 py-0.5 text-xs text-muted md:inline">
                  {CLUSTER === 'devnet' ? 'Devnet' : 'Local network'} · test funds only
                </span>
                <WalletButton />
              </div>
            </div>
            <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2 text-sm sm:hidden">
              {NAV.map(item => (
                <Link key={item.href} href={item.href} className="shrink-0 rounded-lg px-3 py-1.5 text-muted hover:bg-surface-2">
                  {item.label}
                </Link>
              ))}
            </nav>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
          <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs text-muted sm:px-6">
            Amounts and balances are encrypted on-chain with Solana Confidential Balances. Addresses, and the
            fact that a payment happened, stay public.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
