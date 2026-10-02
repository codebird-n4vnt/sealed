'use client';

import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';

import { formatAmount } from '@sealed/core';

import { explorerUrl } from '@/lib/config';

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'lg';

const BUTTON: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-[#3d3d47]',
  accent: 'bg-accent text-white hover:bg-[#4a4ac4]',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2',
  ghost: 'text-muted hover:text-ink hover:bg-surface-2',
  danger: 'bg-surface text-bad border border-line hover:bg-bad-soft',
};

const SIZE: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-sm',
  lg: 'h-14 px-7 text-lg',
};

/** The shared look of buttons, for links styled as buttons too. */
export const buttonClass = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md') =>
  `inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-tight transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${SIZE[size]} ${BUTTON[variant]}`;

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${buttonClass(variant, size)} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-3xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(20,20,40,0.03),0_16px_40px_-24px_rgba(20,20,40,0.14)] sm:p-7 ${className}`}
    >
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'accent';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted border-line',
  ok: 'bg-ok-soft text-ok border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  bad: 'bg-bad-soft text-bad border-transparent',
  accent: 'bg-accent-soft text-accent border-transparent',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE[tone]}`}>
      {children}
    </span>
  );
}

export function Notice({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-2xl border px-4 py-3 text-sm ${TONE[tone]}`}>{children}</div>;
}

export function ErrorText({ error }: { error: string | null | undefined }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-bad">
      {error}
    </p>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm outline-none transition placeholder:text-muted/70 focus:border-accent focus:ring-4 focus:ring-accent/15 ${className}`}
    />
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface-2 p-4 sm:p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1.5 truncate text-2xl font-semibold tracking-tight tabular">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

/** Exact decimal formatting with thousands separators (no floating point). */
export function displayAmount(value: bigint | string, decimals = 6): string {
  const [whole = '0', fraction] = formatAmount(typeof value === 'bigint' ? value : BigInt(value), decimals).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function Amount({ value, symbol, decimals = 6 }: { value: bigint | string; symbol?: string; decimals?: number }) {
  return (
    <span className="tabular">
      {displayAmount(value, decimals)}
      {symbol && <span className="ml-1 text-muted">{symbol}</span>}
    </span>
  );
}

/** Shown instead of an amount the viewer can't decrypt. Never shows 0 for a locked balance. */
export function Sealed({ label = 'Confidential' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-sm font-normal tracking-normal text-muted">
      <LockIcon /> {label}
    </span>
  );
}

export function LockIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export function AddressLink({ address, kind = 'address', label }: { address: string; kind?: 'address' | 'tx'; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
      <a href={explorerUrl(kind, address)} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2 hover:decoration-ink">
        {label ?? shortAddress(address)}
      </a>
      <button
        type="button"
        title="Copy"
        className="text-muted hover:text-ink"
        onClick={() => {
          void navigator.clipboard.writeText(address).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1_200);
          });
        }}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-sm text-muted">{eyebrow}</div>}
        <h1 className="text-3xl font-medium tracking-[-0.04em] sm:text-5xl">{title}</h1>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

/** A block time as a local date, or a dash when the cluster reports none (local validators may not). */
export function formatBlockTime(blockTime: bigint | number | null | undefined): string {
  const seconds = Number(blockTime ?? 0);
  return seconds > 1_600_000_000 ? new Date(seconds * 1000).toLocaleString() : '—';
}
