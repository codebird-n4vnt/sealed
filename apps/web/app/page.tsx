import Link from 'next/link';

import { Aurora } from '@/components/aurora';
import { DemoLauncher } from '@/components/demo-entry';
import { RotatingWords } from '@/components/rotating-words';
import { TEST_WALLET_ENABLED } from '@/lib/config';
import { demoKit } from '@/lib/server/demo';

// The public demo is switched on by a runtime variable, so render per request.
export const dynamic = 'force-dynamic';

const PHRASES = ['Private payroll.', 'Encrypted salaries.', 'Fee-free paydays.', 'Auditor-ready books.'];

const ROLES = [
  {
    href: '/company',
    who: 'I run payroll',
    title: 'Pay the team, publish nothing',
    body: 'Fund a private treasury, add your team, and pay everyone in one approved run.',
    cta: 'Open the company dashboard',
  },
  {
    href: '/me',
    who: 'I get paid',
    title: 'Your pay, for your eyes',
    body: 'See your pay, decrypted in your browser. Collect it and cash out. You never need SOL for fees.',
    cta: 'Open my pay',
  },
  {
    href: '/audit',
    who: "I'm the accountant",
    title: 'Every amount, read-only',
    body: 'Load the auditor key your company gave you, check every payment, and export a CSV.',
    cta: 'Open the accountant view',
  },
];

const VISIBILITY = [
  { who: 'Company admin', sees: 'What it pays each person, and the treasury balance', amounts: 'Its own payroll' },
  { who: 'Employee', sees: 'Their own payments and balance, decrypted with keys from their own wallet', amounts: 'Own pay only' },
  { who: 'Accountant', sees: 'Every payment amount, with the view-only auditor key', amounts: 'All, read-only' },
  { who: 'Everyone else', sees: 'That a payment happened between two addresses, and when. Not the amount.', amounts: 'None' },
];

export default function Home() {
  const demo = TEST_WALLET_ENABLED && demoKit() !== null;

  return (
    <div className="grid gap-24 sm:gap-32">
      <section className="relative -mt-8 flex min-h-[calc(100dvh-9rem)] flex-col justify-end pt-24 sm:-mt-12 sm:pt-32">
        <Aurora className="-inset-x-[12vw] -top-24 -bottom-16 -z-10" />
        <p className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-line bg-white/70 px-3.5 py-1.5 text-sm text-muted backdrop-blur">
          <span className="size-1.5 rounded-full bg-accent" />
          Private stablecoin payroll on Solana
        </p>
        <h1 className="font-medium">
          <span className="block text-[clamp(3rem,9vw,7rem)] leading-[0.95] tracking-[-0.055em] text-ink">
            <RotatingWords words={PHRASES} />
          </span>
          <span className="mt-4 block text-[clamp(1.75rem,4.4vw,3.5rem)] leading-[1.05] tracking-[-0.045em] text-soft">
            Pay your team on-chain. <span className="text-ink">Keep salaries private.</span>
          </span>
        </h1>
        <div className="mt-10 flex flex-wrap items-end justify-between gap-8">
          <p className="max-w-xl text-lg leading-relaxed text-muted text-pretty">
            On a public chain, every salary is readable by anyone, forever. Sealed pays your team with Solana&apos;s{' '}
            <span className="text-ink">Confidential Balances</span>: amounts are encrypted on-chain, and only{' '}
            <span className="text-ink">the company, the employee and the accountant</span> can read them.
          </p>
          <DemoLauncher enabled={demo} />
        </div>
      </section>

      <section className="grid gap-10">
        <h2 className="max-w-4xl text-[clamp(2rem,4.4vw,3.5rem)] leading-[1.05] font-medium tracking-[-0.045em] text-balance">
          Who can see what. <span className="text-soft">Every amount has exactly the readers it should.</span>
        </h2>
        <div className="overflow-hidden rounded-3xl border border-line bg-surface">
          {VISIBILITY.map(row => (
            <div
              key={row.who}
              className="grid gap-x-8 gap-y-1 border-b border-line px-6 py-5 last:border-b-0 sm:grid-cols-[12rem_1fr_auto] sm:items-center"
            >
              <div className="font-medium">{row.who}</div>
              <div className="text-muted">{row.sees}</div>
              <div className="mt-2 w-fit rounded-full bg-surface-2 px-3 py-1 text-xs font-medium text-muted sm:mt-0">
                Amounts: {row.amounts}
              </div>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-muted text-pretty">
          Sealed hides amounts and balances, <span className="text-ink">not identities</span>. Wallet addresses stay
          public, and so do amounts moved into or out of confidential balances, such as funding the treasury or
          withdrawing.
        </p>
      </section>

      <section className="grid gap-10">
        <h2 className="max-w-4xl text-[clamp(2rem,4.4vw,3.5rem)] leading-[1.05] font-medium tracking-[-0.045em] text-balance">
          One payroll, three views. <span className="text-soft">Pick yours.</span>
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {ROLES.map(role => (
            <Link
              key={role.href}
              href={role.href}
              className="group flex flex-col rounded-3xl border border-line bg-surface p-7 transition hover:-translate-y-1 hover:border-soft hover:shadow-[0_24px_50px_-28px_rgba(20,20,40,0.3)]"
            >
              <span className="text-sm text-muted">{role.who}</span>
              <h3 className="mt-3 text-2xl font-medium tracking-[-0.03em]">{role.title}</h3>
              <p className="mt-3 flex-1 text-muted">{role.body}</p>
              <span className="mt-8 inline-flex items-center gap-2 text-sm font-medium">
                {role.cta}
                <svg viewBox="0 0 16 16" className="size-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
