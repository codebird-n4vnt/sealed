import Link from 'next/link';

import { DemoEntry } from '@/components/demo-entry';

const ROLES = [
  {
    href: '/company',
    title: 'I run payroll',
    body: 'Fund a private treasury, add your team, and pay everyone in one approved run.',
    cta: 'Open the company dashboard',
  },
  {
    href: '/me',
    title: 'I get paid',
    body: 'See your pay, decrypted in your browser. Collect it and cash out. You never need SOL for fees.',
    cta: 'Open my pay',
  },
  {
    href: '/audit',
    title: "I'm the accountant",
    body: 'Load the auditor key your company gave you, check every payment, and export a CSV.',
    cta: 'Open the accountant view',
  },
];

const VISIBILITY = [
  { who: 'Company admin', sees: 'What it pays each person, and the treasury balance' },
  { who: 'Employee', sees: 'Their own payments and balance, decrypted with keys from their own wallet' },
  { who: 'Accountant', sees: 'Every payment amount, with the view-only auditor key' },
  { who: 'Everyone else', sees: 'That a payment happened between two addresses, and when. Not the amount.' },
];

export default function Home() {
  return (
    <div className="grid gap-14">
      <section className="grid gap-6 pt-4 sm:pt-10">
        <p className="text-sm font-medium text-wax">Private stablecoin payroll on Solana</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Pay your team on-chain. Keep salaries private.
        </h1>
        <p className="max-w-2xl text-lg text-muted">
          On a public chain, every salary you pay is readable by everyone, forever. Sealed pays your team with
          Solana&apos;s native Confidential Balances: amounts are encrypted on-chain and verified with
          zero-knowledge proofs.
        </p>
      </section>

      <DemoEntry />

      <section className="grid gap-4 md:grid-cols-3">
        {ROLES.map(role => (
          <Link
            key={role.href}
            href={role.href}
            className="group flex flex-col rounded-2xl border border-line bg-surface p-6 transition hover:border-ink"
          >
            <h2 className="text-lg font-semibold">{role.title}</h2>
            <p className="mt-2 flex-1 text-sm text-muted">{role.body}</p>
            <span className="mt-6 text-sm font-medium group-hover:underline">{role.cta} →</span>
          </Link>
        ))}
      </section>

      <section className="grid gap-4">
        <h2 className="text-xl font-semibold">Who can see what</h2>
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          {VISIBILITY.map(row => (
            <div key={row.who} className="grid gap-1 border-b border-line px-5 py-4 last:border-b-0 sm:grid-cols-[12rem_1fr]">
              <div className="text-sm font-medium">{row.who}</div>
              <div className="text-sm text-muted">{row.sees}</div>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">
          Sealed hides amounts and balances, not identities. Wallet addresses stay public, and so do amounts moved
          into or out of confidential balances, such as funding the treasury or withdrawing.
        </p>
      </section>
    </div>
  );
}
