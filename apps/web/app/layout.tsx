import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Aurora } from '@/components/aurora';
import { NavLinks } from '@/components/nav-links';
import { WalletButton } from '@/components/wallet-button';
import { CLUSTER } from '@/lib/config';

import './globals.css';
import { Providers } from './providers';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Sealed · Private payroll on Solana',
  description:
    'Pay your team in stablecoins on Solana. Only the employer, the employee and the accountant can see how much anyone earns.',
};

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <circle cx="16" cy="16" r="14" fill="var(--wax)" />
        <circle cx="16" cy="16" r="9.5" fill="none" stroke="var(--bg)" strokeWidth="1.5" strokeDasharray="2 2.2" />
        <path d="M12.5 17.5c0-1.4 1.5-2 3.5-2s3.5-.6 3.5-2-1.6-2-3.5-2M12.5 17.5c0 1.4 1.6 2 3.5 2s3.5-.6 3.5-2" stroke="var(--bg)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      </svg>
      Sealed
    </Link>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="relative isolate min-h-dvh">
        <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[480px] [mask-image:linear-gradient(to_bottom,black,transparent)]">
          <Aurora faint />
        </div>
        <Providers>
          <header className="sticky top-0 z-30 border-b border-line/70 bg-white/70 backdrop-blur-xl">
            <div className="relative mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
              <Logo />
              <NavLinks className="ml-4 hidden sm:flex lg:absolute lg:left-1/2 lg:ml-0 lg:-translate-x-1/2" />
              <div className="ml-auto flex items-center gap-3">
                <span className="hidden items-center gap-2 rounded-full border border-line bg-white/60 px-3 py-1 text-xs text-muted md:inline-flex">
                  <span className="size-1.5 rounded-full bg-ok" />
                  {CLUSTER === 'devnet' ? 'Devnet' : 'Local network'} · test funds only
                </span>
                <WalletButton />
              </div>
            </div>
            <NavLinks className="mx-auto flex max-w-6xl overflow-x-auto px-4 pb-2.5 sm:hidden" />
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
          <footer className="mx-auto max-w-6xl border-t border-line px-4 py-8 text-xs leading-relaxed text-muted sm:px-6">
            Amounts and balances are encrypted on-chain with Solana Confidential Balances. Addresses, and the
            fact that a payment happened, stay public.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
