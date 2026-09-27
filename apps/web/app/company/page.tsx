'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { RequireSignIn } from '@/components/gate';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, PageHeader, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/client/api';
import { downloadAuditorKey, generateAuditorKey } from '@/lib/client/auditor-key';
import { DEFAULT_TOKEN_SYMBOL } from '@/lib/config';

type CompanySummary = { id: string; name: string; symbol: string; status: 'setup' | 'ready' };

function CreateCompany() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState(DEFAULT_TOKEN_SYMBOL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card
      title="Create a company"
      description="Sets up a private payroll account and a test stablecoin for your company on the test network."
    >
      <form
        className="grid gap-4"
        onSubmit={async event => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const auditor = generateAuditorKey();
            const { id } = await api<{ id: string }>('/api/companies', {
              body: { name, symbol, auditorElgamalPubkey: auditor.elgamalPubkey },
            });
            downloadAuditorKey({
              type: 'sealed-auditor-key',
              version: 1,
              company: { id, name },
              elgamalPubkey: auditor.elgamalPubkey,
              secretKey: auditor.secretKey,
              createdAt: new Date().toISOString(),
            });
            router.push(`/company/${id}?created=1`);
          } catch (e) {
            setError(errorMessage(e));
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <Field label="Company name">
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Acme DAO" required minLength={2} />
          </Field>
          <Field label="Token symbol">
            <Input value={symbol} onChange={e => setSymbol(e.target.value)} required pattern="[A-Za-z0-9]{2,10}" />
          </Field>
        </div>
        <p className="text-sm text-muted">
          Your browser also creates the <strong className="font-medium text-ink">auditor key</strong> and downloads it as
          a file. Give it to your accountant: it lets them read every payment amount. Sealed never sees it.
        </p>
        <div>
          <Button type="submit" loading={busy}>
            Create company
          </Button>
        </div>
        <ErrorText error={error} />
      </form>
    </Card>
  );
}

function Companies() {
  const [companies, setCompanies] = useState<CompanySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ companies: CompanySummary[] }>('/api/companies')
      .then(data => setCompanies(data.companies))
      .catch(e => setError(errorMessage(e)));
  }, []);

  return (
    <div className="grid gap-6">
      <PageHeader title="Your companies" />
      <ErrorText error={error} />
      {companies === null && !error && <Spinner />}
      {companies && companies.length === 0 && (
        <EmptyState title="No companies yet">Create one below to start paying your team privately.</EmptyState>
      )}
      {companies && companies.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {companies.map(company => (
            <Link
              key={company.id}
              href={`/company/${company.id}`}
              className="flex items-center justify-between rounded-2xl border border-line bg-surface p-5 hover:border-ink"
            >
              <div>
                <div className="font-semibold">{company.name}</div>
                <div className="text-sm text-muted">{company.symbol}</div>
              </div>
              {company.status === 'ready' ? <Badge tone="ok">Ready</Badge> : <Badge tone="warn">Setup needed</Badge>}
            </Link>
          ))}
        </div>
      )}
      <CreateCompany />
    </div>
  );
}

export default function CompanyPage() {
  return <RequireSignIn reason="Company admins sign in to manage payroll.">{() => <Companies />}</RequireSignIn>;
}
