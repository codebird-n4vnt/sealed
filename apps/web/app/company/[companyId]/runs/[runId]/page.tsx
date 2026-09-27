'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { RUN_STATUS, type RunStatus } from '@/components/company-sections';
import { RequireSignIn } from '@/components/gate';
import { AddressLink, Amount, Badge, Card, ErrorText, Notice, PageHeader, Spinner, Stat } from '@/components/ui';
import { api, errorMessage } from '@/lib/client/api';
import { explorerUrl } from '@/lib/config';

type PaymentStatus = 'pending' | 'proving' | 'submitted' | 'confirmed' | 'failed';

type RunData = {
  run: { id: string; status: RunStatus; count: number; total: string; createdAt: string; startedAt: string | null; finishedAt: string | null };
  company: { id: string; name: string; symbol: string; decimals: number };
  payments: Array<{ id: string; name: string; wallet: string; amount: string; status: PaymentStatus; signature: string | null; error: string | null }>;
};

const PAYMENT_STATUS: Record<PaymentStatus, React.ReactNode> = {
  pending: <Badge>Waiting</Badge>,
  proving: (
    <Badge tone="warn">
      <Spinner className="size-3" /> Generating proofs
    </Badge>
  ),
  submitted: (
    <Badge tone="warn">
      <Spinner className="size-3" /> Sending
    </Badge>
  ),
  confirmed: <Badge tone="ok">Paid</Badge>,
  failed: <Badge tone="bad">Failed</Badge>,
};

function Run() {
  const { runId } = useParams<{ companyId: string; runId: string }>();
  const [data, setData] = useState<RunData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<RunData>(`/api/runs/${runId}`)
      .then(setData)
      .catch(e => setError(errorMessage(e)));
  }, [runId]);
  useEffect(load, [load]);
  useEffect(() => {
    if (data && data.run.status !== 'running') return;
    const timer = setInterval(load, 2_000);
    return () => clearInterval(timer);
  }, [data, load]);

  if (error) return <ErrorText error={error} />;
  if (!data) return <Spinner />;
  const { run, company, payments } = data;
  const paid = payments.filter(p => p.status === 'confirmed');
  const paidTotal = paid.reduce((sum, p) => sum + BigInt(p.amount), 0n);
  const sample = paid.find(p => p.signature);

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={<Link href={`/company/${company.id}`} className="hover:underline">{company.name}</Link>}
        title={`Payroll run · ${new Date(run.createdAt).toLocaleDateString()}`}
      >
        {RUN_STATUS[run.status]}
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Paid" value={`${paid.length} of ${run.count}`} />
        <Stat label="Paid out" value={<Amount value={paidTotal} symbol={company.symbol} decimals={company.decimals} />} />
        <Stat label="Run total" value={<Amount value={run.total} symbol={company.symbol} decimals={company.decimals} />} />
      </div>

      {sample?.signature && (
        <Notice tone="wax">
          See what the public sees:{' '}
          <a className="underline" href={explorerUrl('tx', sample.signature)} target="_blank" rel="noreferrer">
            {sample.name}&apos;s payment on the explorer
          </a>{' '}
          shows the transfer between two addresses, but no amount.
        </Notice>
      )}

      <Card title="Payments" description="Payments from one treasury go out in order, because each proof depends on the balance before it.">
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-2 py-2 font-medium">Employee</th>
                <th className="px-2 py-2 font-medium">Wallet</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(payment => (
                <tr key={payment.id} className="border-t border-line align-top">
                  <td className="px-2 py-3 font-medium">{payment.name}</td>
                  <td className="px-2 py-3"><AddressLink address={payment.wallet} /></td>
                  <td className="px-2 py-3 text-right"><Amount value={payment.amount} symbol={company.symbol} decimals={company.decimals} /></td>
                  <td className="px-2 py-3">
                    {PAYMENT_STATUS[payment.status]}
                    {payment.error && <p className="mt-1 max-w-xs text-xs text-bad">{payment.error}</p>}
                  </td>
                  <td className="px-2 py-3">{payment.signature ? <AddressLink address={payment.signature} kind="tx" /> : <span className="text-muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

export default function RunPage() {
  return <RequireSignIn reason="Sign in as the company admin to see this payroll run.">{() => <Run />}</RequireSignIn>;
}
