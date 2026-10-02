import Link from 'next/link';
import type { ReactNode } from 'react';

import { Aurora } from '@/components/aurora';
import { DemoLauncher } from '@/components/demo-entry';
import { AccountantPreview, AdminPreview, ApproveArt, DecryptArt, EmployeePreview, FundArt } from '@/components/landing-art';
import { RotatingWords } from '@/components/rotating-words';
import { TEST_WALLET_ENABLED } from '@/lib/config';
import { demoKit } from '@/lib/server/demo';

// The public demo is switched on by a runtime variable, so render per request.
export const dynamic = 'force-dynamic';

const REPO = 'https://github.com/codebird-n4vnt/sealed';

const PHRASES = ['Private payroll.', 'Encrypted salaries.', 'Fee-free paydays.', 'Auditor-ready books.'];

const STEPS = [
  { tag: 'Fund', title: 'A confidential treasury, funded in round sums', art: <FundArt /> },
  { tag: 'Approve', title: 'One wallet signature pays the whole team', art: <ApproveArt /> },
  { tag: 'Decrypt', title: 'Each person sees only their own pay', art: <DecryptArt /> },
];

const VISIBILITY = [
  { who: 'Company admin', sees: 'Its own payroll', body: 'What it pays each person, and the treasury balance.' },
  { who: 'Employee', sees: 'Their own pay', body: 'Their own payments and balance, decrypted with keys from their own wallet.' },
  { who: 'Accountant', sees: 'Every amount, read-only', body: 'Every payment amount, with the view-only auditor key. It can’t move funds.' },
  { who: 'Everyone else', sees: 'No amounts', body: 'That a payment happened between two addresses, and when. Not the amount.' },
];

const VIEWS = [
  {
    href: '/company',
    name: 'Company dashboard',
    role: 'Admin',
    body: 'Fund a private treasury, add your team, and pay everyone in one approved run.',
    preview: <AdminPreview />,
    tint: 'bg-[radial-gradient(120%_90%_at_15%_10%,#eceefe_0%,#cdcffb_55%,#b3b6f5_100%)]',
  },
  {
    href: '/me',
    name: 'My pay',
    role: 'Employee',
    body: 'See your pay, decrypted in your browser. Collect it and cash out, with 0 SOL.',
    preview: <EmployeePreview />,
    tint: 'bg-[radial-gradient(120%_90%_at_85%_10%,#f1efff_0%,#d6d3fb_55%,#bdb8f3_100%)]',
  },
  {
    href: '/audit',
    name: 'The books',
    role: 'Accountant',
    body: 'Load the auditor key, check every payment, and export a CSV that matches the run.',
    preview: <AccountantPreview />,
    tint: 'bg-[radial-gradient(120%_90%_at_50%_0%,#eef0fe_0%,#d2d5fb_55%,#b8bcf5_100%)]',
  },
];

function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`text-xs font-medium tracking-[0.1em] text-ink uppercase ${className}`}>{children}</p>;
}

/** A small label on the left, the statement on the right. */
function Editorial({ label, headline, sub }: { label: string; headline: ReactNode; sub?: ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr] lg:gap-10">
      <Label className="pt-2">{label}</Label>
      <div>
        <h2 className="text-[clamp(1.9rem,3.4vw,2.9rem)] leading-[1.1] font-medium tracking-[-0.035em] text-balance">{headline}</h2>
        {sub && <p className="mt-5 max-w-xl text-muted text-pretty">{sub}</p>}
      </div>
    </div>
  );
}

export default function Home() {
  const demo = TEST_WALLET_ENABLED && demoKit() !== null;

  return (
    <div className="grid gap-28 sm:gap-40">
      <section className="relative -mt-8 flex min-h-[calc(100dvh-9rem)] flex-col justify-end pt-24 sm:-mt-12 sm:pt-32">
        <Aurora className="-inset-x-[12vw] -top-24 -bottom-16 -z-10" />

        <div
          aria-hidden
          className="float-y absolute top-24 right-0 hidden w-[25rem] gap-4 rounded-[22px] border border-white/70 bg-white/90 p-2.5 shadow-[0_30px_60px_-30px_rgba(30,30,70,0.35)] backdrop-blur lg:flex"
        >
          <div className="relative grid h-36 w-36 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[radial-gradient(circle_at_30%_20%,#e3e5fd,#c3c5fa_45%,#9599ee)]">
            <div className="grid gap-1.5 font-mono text-[13px] leading-none text-white">
              <span>9f3a c21e</span>
              <span>07b4 e5c0</span>
              <span>1bd6 f4a0</span>
            </div>
            <span className="absolute right-2.5 bottom-2.5 grid size-8 place-items-center rounded-full bg-white text-ink shadow">
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="3" y="7" width="10" height="7" rx="1.5" />
                <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
              </svg>
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-between py-2 pr-2">
            <p className="text-xl leading-tight font-medium tracking-[-0.02em]">
              Paid on-chain.
              <br />
              Amount sealed.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-ink px-3 py-1 text-[11px] font-medium tracking-wide text-white uppercase">Confidential</span>
              <span className="rounded-full border border-ink/80 px-3 py-1 text-[11px] font-medium tracking-wide uppercase">Devnet</span>
            </div>
          </div>
        </div>

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

      <Editorial
        label="The problem"
        headline={
          <>
            On a public chain, payroll is a published salary sheet.{' '}
            <span className="text-soft">
              Your team sees each other&apos;s pay, competitors read your burn rate, and well-paid wallets become targets.
            </span>
          </>
        }
        sub="Salary confidentiality is the default in every company. On-chain payroll quietly removed it. Sealed puts it back."
      />

      <section id="how" className="grid scroll-mt-24 gap-12">
        <Editorial
          label="How it works"
          headline="From a funded treasury to a private payslip, without publishing a single amount"
          sub="Built on Solana's Confidential Balances: amounts are encrypted on-chain, and the network still checks every payment with zero-knowledge proofs."
        />
        <div className="grid gap-5 md:grid-cols-3">
          {STEPS.map(step => (
            <div key={step.tag} className="grid content-start gap-5">
              <div className="aspect-[4/3] overflow-hidden rounded-[22px] bg-surface-2">{step.art}</div>
              <div className="px-1">
                <p className="flex items-center gap-2 text-xs font-medium tracking-[0.1em] uppercase">
                  <span className="size-1 rounded-full bg-ink" />
                  {step.tag}
                </p>
                <h3 className="mt-3 text-xl leading-snug font-medium tracking-[-0.02em]">{step.title}</h3>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="privacy" className="grid scroll-mt-24 gap-6 lg:grid-cols-[1fr_1.15fr] lg:gap-10">
        <div>
          <Label className="pt-2 lg:sticky lg:top-24">Who sees what</Label>
        </div>
        <div>
          <h2 className="text-[clamp(1.9rem,3.4vw,2.9rem)] leading-[1.1] font-medium tracking-[-0.035em] text-balance">
            Every amount has exactly the readers it should
          </h2>
          <p className="mt-5 max-w-xl text-muted">Addresses and timing stay public. Amounts don&apos;t.</p>
          <div className="mt-10 grid gap-3">
            {VISIBILITY.map(row => (
              <div key={row.who} className="flex min-h-44 flex-col justify-between gap-8 rounded-[22px] bg-surface-2 p-6">
                <div>
                  <h3 className="text-xl font-semibold tracking-tight uppercase">{row.who}</h3>
                  <p className="mt-1 text-xs font-medium tracking-wide uppercase">[{row.sees}]</p>
                </div>
                <p className="max-w-md text-sm text-muted">{row.body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 max-w-xl text-sm text-muted text-pretty">
            Sealed hides amounts and balances, <span className="text-ink">not identities</span>. Amounts moved into or
            out of confidential balances are public too, such as funding the treasury or withdrawing.
          </p>
        </div>
      </section>

      <section id="views" className="grid scroll-mt-24 gap-12">
        <Editorial label="Three views" headline="One payroll, seen three ways" sub="Pick yours. Each opens the app." />
        <div className="grid gap-5 md:grid-cols-3">
          {VIEWS.map((view, index) => (
            <Link key={view.href} href={view.href} className="group block rounded-[24px] bg-surface-2 p-2 transition hover:bg-[#efeff5]">
              <div className="flex items-center justify-between px-2.5 pt-1.5 pb-3 text-xs font-medium tracking-[0.08em] uppercase">
                <span>
                  0{index + 1} — {view.name}
                </span>
                <span className="text-muted">{view.role}</span>
              </div>
              <div className={`relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[18px] p-6 ${view.tint}`}>
                {view.preview}
                <span
                  aria-hidden
                  className="absolute grid size-20 scale-75 place-items-center rounded-full bg-ink/85 text-xs font-medium tracking-[0.12em] text-white uppercase opacity-0 backdrop-blur transition duration-300 group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
                >
                  Open
                </span>
              </div>
              <p className="px-2.5 pt-3.5 pb-2 text-sm text-muted">{view.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="grid gap-12 border-t border-line pt-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr]">
          <div>
            <a
              href={REPO}
              className="inline-flex items-center gap-3 text-sm font-medium"
              aria-label="Sealed's source code on GitHub"
            >
              <span className="grid size-10 place-items-center rounded-full bg-ink text-white">
                <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
                </svg>
              </span>
              Open source
            </a>
          </div>
          <div>
            <p className="text-[clamp(1.9rem,3.4vw,2.9rem)] leading-[1.1] font-medium tracking-[-0.035em]">
              Salary privacy is normal everywhere else.
              <br />
              <span className="text-soft">Now it&apos;s on-chain too.</span>
            </p>
            <div className="mt-8">
              <DemoLauncher enabled={demo} />
            </div>
          </div>
        </div>

        <svg viewBox="0 0 1000 190" className="w-full" role="img" aria-label="Sealed">
          <defs>
            <linearGradient id="wordmark" x1="0" y1="0" x2="1" y2="0.35">
              <stop offset="0" stopColor="#0b0b0f" />
              <stop offset="0.42" stopColor="#25255f" />
              <stop offset="0.78" stopColor="#5b5bd6" />
              <stop offset="1" stopColor="#b9bbf7" />
            </linearGradient>
          </defs>
          <text
            x="0"
            y="176"
            textLength="1000"
            lengthAdjust="spacingAndGlyphs"
            fontSize="236"
            fontWeight="700"
            fill="url(#wordmark)"
            style={{ fontFamily: 'var(--font-geist), sans-serif', letterSpacing: '-0.04em' }}
          >
            SEALED
          </text>
        </svg>

        <nav aria-label="More" className="-mt-4 flex flex-wrap justify-between gap-x-8 gap-y-3 text-sm">
          <Link href="/company" className="hover:underline">
            Company
          </Link>
          <Link href="/me" className="hover:underline">
            My pay
          </Link>
          <Link href="/audit" className="hover:underline">
            Accountant
          </Link>
          <a href="#how" className="hover:underline">
            How it works
          </a>
          <a href={REPO} className="hover:underline">
            GitHub
          </a>
        </nav>
      </section>
    </div>
  );
}
