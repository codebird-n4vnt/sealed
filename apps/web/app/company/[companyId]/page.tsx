'use client';

import type { UiWalletAccount } from '@wallet-standard/react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

import {
  AccessCard,
  PayrollCard,
  SetupCard,
  TeamCard,
  TreasuryCard,
  type CompanyData,
} from '@/components/company-sections';
import { RequireSignIn } from '@/components/gate';
import { Badge, ErrorText, Notice, PageHeader, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/client/api';

function Dashboard({ account }: { account: UiWalletAccount }) {
  const { companyId } = useParams<{ companyId: string }>();
  const created = useSearchParams().get('created') === '1';
  const [data, setData] = useState<CompanyData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api<CompanyData>(`/api/companies/${companyId}`)
      .then(setData)
      .catch(e => setError(errorMessage(e)));
  }, [companyId]);
  useEffect(reload, [reload]);

  // While setting up, keep an eye on the vault's SOL (the airdrop lands in the background).
  useEffect(() => {
    if (data?.company.status !== 'setup') return;
    const timer = setInterval(reload, 4_000);
    return () => clearInterval(timer);
  }, [data?.company.status, reload]);

  if (error) return <ErrorText error={error} />;
  if (!data) return <Spinner />;
  const { company } = data;

  return (
    <div className="grid gap-6">
      <PageHeader
        eyebrow={<Link href="/company" className="hover:underline">Companies</Link>}
        title={company.name}
      >
        <Badge tone="accent">{company.symbol}</Badge>
        {company.status === 'ready' ? <Badge tone="ok">Ready</Badge> : <Badge tone="warn">Setup needed</Badge>}
      </PageHeader>
      {created && (
        <Notice tone="accent">
          Your auditor key file was downloaded. Give it to your accountant and keep a backup: it&apos;s the only way to
          read payment amounts without your team&apos;s wallets, and Sealed doesn&apos;t keep a copy.
        </Notice>
      )}
      {data.chainError && <Notice tone="bad">{data.chainError}</Notice>}
      {company.status === 'setup' ? (
        <SetupCard data={data} reload={reload} />
      ) : (
        <>
          <TreasuryCard data={data} reload={reload} />
          <PayrollCard data={data} account={account} />
          <TeamCard data={data} reload={reload} />
          <AccessCard data={data} reload={reload} />
        </>
      )}
    </div>
  );
}

export default function CompanyDashboardPage() {
  return (
    <RequireSignIn reason="Sign in as the company admin to manage payroll.">
      {account => (
        <Suspense fallback={<Spinner />}>
          <Dashboard account={account} />
        </Suspense>
      )}
    </RequireSignIn>
  );
}
