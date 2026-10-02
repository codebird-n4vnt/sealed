'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { api, errorMessage } from '@/lib/client/api';
import { DEMO_AUDITOR_KEY_STORAGE } from '@/lib/client/demo';
import { TEST_WALLET_NAME, testWallet, type TestIdentity } from '@/lib/client/test-wallet';

import { ArrowDot, Button, ErrorText, buttonClass } from './ui';

type Role = 'admin' | 'employee' | 'accountant';

const ROLES: Array<{ role: Role; tab: string; title: string; what: string; sees: string[]; cta: string }> = [
  {
    role: 'admin',
    tab: 'Admin',
    title: 'Run payroll',
    what: 'Fund the treasury and pay a 10-person team in one approved run.',
    sees: ['The treasury, the team and every salary', 'Each payment confirming, live'],
    cta: 'Explore as the admin',
  },
  {
    role: 'employee',
    tab: 'Employee',
    title: 'Get paid',
    what: 'See your pay decrypted in your browser, then collect it and withdraw.',
    sees: ['Your own pay and nobody else’s', 'Every fee paid by the company: 0 SOL'],
    cta: 'Explore as an employee',
  },
  {
    role: 'accountant',
    tab: 'Accountant',
    title: 'Check the books',
    what: 'Decrypt every payment with the auditor key and export a CSV.',
    sees: ['Every amount, read-only', 'A CSV that matches the payroll run'],
    cta: 'Explore as the accountant',
  },
];

/**
 * The landing page's call to action. With the public demo on, it opens a card that loads a demo
 * role's identity into the built-in test wallet and opens that role's page on the seeded demo
 * company. Without it, it links to the company dashboard.
 */
export function DemoLauncher({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>('admin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const tabs = useRef<Partial<Record<Role, HTMLButtonElement | null>>>({});

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  if (!enabled) {
    return (
      <Link href="/company" className={buttonClass('primary', 'lg')}>
        Open the dashboard
        <ArrowDot />
      </Link>
    );
  }

  const selected = ROLES.find(r => r.role === role)!;

  const toggle = () => {
    setOpen(o => !o);
    setError(null);
    requestAnimationFrame(() => tabs.current[role]?.focus({ preventScroll: true }));
  };

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const index = ROLES.findIndex(r => r.role === role);
    const next = ROLES[(index + (event.key === 'ArrowRight' ? 1 : ROLES.length - 1)) % ROLES.length]!.role;
    setRole(next);
    tabs.current[next]?.focus({ preventScroll: true });
  };

  const explore = async () => {
    setBusy(true);
    setError(null);
    try {
      const kit = await api<{ companyId: string; identity: TestIdentity; auditorKey?: unknown }>(`/api/demo/${role}`);
      // Select the test wallet, then make this role's identity its active one.
      try {
        localStorage.setItem('sealed:selected-wallet', `${TEST_WALLET_NAME}:`);
        if (kit.auditorKey) sessionStorage.setItem(DEMO_AUDITOR_KEY_STORAGE, JSON.stringify(kit.auditorKey));
      } catch {
        // Storage unavailable: the identity still loads for this page.
      }
      await testWallet().importIdentities(JSON.stringify({ identities: [kit.identity] }), kit.identity.label);
      router.push(role === 'admin' ? `/company/${kit.companyId}` : role === 'employee' ? '/me' : '/audit');
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls="demo-card"
        onClick={toggle}
        className={`${buttonClass('primary', 'lg')} aria-expanded:bg-[#4b4b56]`}
      >
        Try the live demo
        <ArrowDot />
      </button>

      {open && (
        <div
          id="demo-card"
          role="dialog"
          aria-labelledby="demo-card-title"
          className="warp-in fixed inset-x-4 bottom-4 z-40 rounded-[28px] border border-line bg-white p-6 text-left shadow-[0_2px_6px_rgba(20,20,40,0.05),0_40px_80px_-30px_rgba(30,30,70,0.35)] sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-[calc(100%+14px)] sm:w-[26rem]"
        >
          <div className="flex items-start gap-3">
            <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-surface-2">
              <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
                <circle cx="16" cy="16" r="14" fill="var(--wax)" />
                <circle cx="16" cy="16" r="9.5" fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="2 2.2" />
                <path d="M12.5 17.5c0-1.4 1.5-2 3.5-2s3.5-.6 3.5-2-1.6-2-3.5-2M12.5 17.5c0 1.4 1.6 2 3.5 2s3.5-.6 3.5-2" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              </svg>
              <span className="absolute right-0 bottom-0 size-3 rounded-full border-2 border-white bg-ok" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="demo-card-title" className="font-semibold tracking-tight">
                Explore Acme DAO
              </h2>
              <p className="text-xs text-muted">A seeded company on devnet. No wallet needed.</p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
              className="-mt-1 -mr-1 grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
            >
              <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>

          <div role="tablist" aria-label="Role" onKeyDown={onTabKey} className="mt-5 flex gap-1 border-b border-line pb-3">
            {ROLES.map(r => (
              <button
                key={r.role}
                ref={el => {
                  tabs.current[r.role] = el;
                }}
                type="button"
                role="tab"
                id={`demo-tab-${r.role}`}
                aria-selected={r.role === role}
                aria-controls="demo-panel"
                tabIndex={r.role === role ? 0 : -1}
                onClick={() => setRole(r.role)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  r.role === role ? 'bg-surface-2 text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {r.tab}
              </button>
            ))}
          </div>

          <div id="demo-panel" role="tabpanel" aria-labelledby={`demo-tab-${role}`} className="mt-4 grid gap-4">
            <div>
              <p className="text-lg font-semibold tracking-tight">{selected.title}</p>
              <p className="mt-1 text-sm text-muted">{selected.what}</p>
            </div>
            <ul className="grid gap-2 text-sm">
              {selected.sees.map(line => (
                <li key={line} className="flex items-center gap-2.5">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                    <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                  </span>
                  {line}
                </li>
              ))}
            </ul>
            <Button variant="accent" loading={busy} onClick={() => void explore()} className="h-12 w-full text-[15px]">
              {selected.cta}
            </Button>
            <ErrorText error={error} />
            <p className="text-center text-xs text-muted">
              Runs in a test wallet in this browser. Amounts show only for the role allowed to see them.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
