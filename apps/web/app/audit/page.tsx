'use client';

import type { Address } from '@solana/kit';
import type { ElGamalSecretKey } from '@solana/zk-sdk/bundler';
import { useEffect, useMemo, useState } from 'react';

import { decryptAuditorAmount, fetchConfidentialTransfers, formatAmount, type ConfidentialTransferRecord } from '@sealed/core';

import { RequireSignIn } from '@/components/gate';
import { AddressLink, Amount, Button, Card, EmptyState, ErrorText, Notice, PageHeader, Sealed, Spinner, Stat, formatBlockTime } from '@/components/ui';
import { api, errorMessage } from '@/lib/client/api';
import { parseAuditorKey } from '@/lib/client/auditor-key';
import { readOnlyClient } from '@/lib/client/confidential';
import { transactionCache } from '@/lib/client/transaction-cache';

type AuditCompany = {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  mint: string;
  treasuryAccount: string;
  auditorElgamalPubkey: string;
  directory: Array<{ name: string; wallet: string; tokenAccount: string }>;
};

type Row = ConfidentialTransferRecord & { amount: bigint | null; name: string | null; wallet: string | null };

function toCsv(company: AuditCompany, rows: Row[]): string {
  const quote = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [['date_utc', 'recipient', 'wallet', 'token_account', 'amount', 'symbol', 'signature'].join(',')];
  for (const row of rows) {
    lines.push(
      [
        Number(row.blockTime ?? 0) > 1_600_000_000 ? new Date(Number(row.blockTime) * 1000).toISOString() : '',
        row.name ?? '',
        row.wallet ?? '',
        row.destinationToken,
        row.amount === null ? '' : formatAmount(row.amount, company.decimals),
        company.symbol,
        row.signature,
      ]
        .map(quote)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

function CompanyAudit({ company }: { company: AuditCompany }) {
  const [transfers, setTransfers] = useState<ConfidentialTransferRecord[] | null>(null);
  const [secret, setSecret] = useState<ElGamalSecretKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setTransfers(null);
    setSecret(null);
    setError(null);
    setProgress(null);
    readOnlyClient()
      .then(client =>
        fetchConfidentialTransfers(client, {
          tokenAccount: company.treasuryAccount as Address,
          limit: 500,
          cache: transactionCache,
          signal: controller.signal,
          onProgress: (done, total) => setProgress({ done, total }),
        }),
      )
      .then(all => setTransfers(all.filter(t => t.sourceToken === company.treasuryAccount)))
      .catch(e => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      });
    return () => controller.abort();
  }, [company.treasuryAccount]);

  const rows: Row[] = useMemo(() => {
    const directory = new Map(company.directory.map(d => [d.tokenAccount, d]));
    return (transfers ?? []).map(transfer => {
      const person = directory.get(transfer.destinationToken);
      return {
        ...transfer,
        amount: secret ? decryptAuditorAmount(transfer.data, secret) : null,
        name: person?.name ?? null,
        wallet: person?.wallet ?? null,
      };
    });
  }, [transfers, secret, company.directory]);

  const total = rows.reduce((sum, row) => sum + (row.amount ?? 0n), 0n);

  const loadKey = async (file: File | undefined) => {
    if (!file) return;
    setKeyError(null);
    try {
      const parsed = parseAuditorKey(await file.text());
      if (parsed.file.elgamalPubkey !== company.auditorElgamalPubkey) {
        throw new Error(`This key is not ${company.name}'s current auditor key.`);
      }
      setSecret(parsed.secret);
    } catch (e) {
      setKeyError(errorMessage(e));
    }
  };

  const download = () => {
    const blob = new Blob([toCsv(company, rows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-payroll-audit.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <div className="grid gap-6">
      <Card
        title="Auditor key"
        description="Decrypts every payment amount in your browser. The key file never leaves this device."
        actions={secret && <Button variant="ghost" onClick={() => setSecret(null)}>Lock</Button>}
      >
        {secret ? (
          <Notice tone="ok">Key loaded. Amounts below are decrypted locally.</Notice>
        ) : (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm hover:border-ink">
            <span className="font-medium">Choose the auditor key file</span>
            <span className="text-muted">sealed-auditor-key-….json, from the company admin</span>
            <input type="file" accept="application/json,.json" className="sr-only" onChange={e => void loadKey(e.target.files?.[0])} />
          </label>
        )}
        <div className="mt-2">
          <ErrorText error={keyError} />
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Payments" value={transfers ? rows.length : '—'} />
        <Stat label="Total paid" value={secret ? <Amount value={total} symbol={company.symbol} decimals={company.decimals} /> : <Sealed />} />
        <Stat label="Treasury" value={<AddressLink address={company.treasuryAccount} />} />
      </div>

      <Card
        title="Payments from the treasury"
        description="Read straight from the chain. Without the key, amounts are ciphertext."
        actions={
          <Button variant="secondary" disabled={!secret || rows.length === 0} onClick={download}>
            Export CSV
          </Button>
        }
      >
        <ErrorText error={error} />
        {!transfers && !error && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner />
            {progress ? `Reading transactions from the chain: ${progress.done} of ${progress.total}` : 'Reading the treasury history'}
          </p>
        )}
        {transfers && rows.length === 0 && <EmptyState title="No payments yet" />}
        {rows.length > 0 && (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-2 py-2 font-medium">Date</th>
                  <th className="px-2 py-2 font-medium">Paid to</th>
                  <th className="px-2 py-2 text-right font-medium">Amount</th>
                  <th className="px-2 py-2 font-medium">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={`${row.signature}-${row.destinationToken}`} className="border-t border-line">
                    <td className="px-2 py-2.5 text-muted">{formatBlockTime(row.blockTime)}</td>
                    <td className="px-2 py-2.5">
                      {row.name ? <span className="font-medium">{row.name}</span> : <AddressLink address={row.destinationToken} />}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      {row.amount === null ? <Sealed label="Encrypted" /> : <Amount value={row.amount} symbol={company.symbol} decimals={company.decimals} />}
                    </td>
                    <td className="px-2 py-2.5"><AddressLink address={row.signature} kind="tx" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Audit() {
  const [companies, setCompanies] = useState<AuditCompany[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ companies: AuditCompany[] }>('/api/audit')
      .then(data => {
        setCompanies(data.companies);
        setSelected(data.companies[0]?.id ?? null);
      })
      .catch(e => setError(errorMessage(e)));
  }, []);
  const company = companies?.find(c => c.id === selected);

  return (
    <div className="grid gap-6">
      <PageHeader title="Accountant view">
        {companies && companies.length > 1 && (
          <select
            value={selected ?? ''}
            onChange={e => setSelected(e.target.value)}
            className="h-10 rounded-lg border border-line bg-surface px-3 text-sm"
          >
            {companies.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </PageHeader>
      <ErrorText error={error} />
      {!companies && !error && <Spinner />}
      {companies?.length === 0 && (
        <EmptyState title="No companies to audit">
          Ask the company admin to add this wallet as an accountant, and to send you the auditor key file.
        </EmptyState>
      )}
      {company && <CompanyAudit key={company.id} company={company} />}
    </div>
  );
}

export default function AuditPage() {
  return <RequireSignIn reason="Accountants sign in to see which company they audit.">{() => <Audit />}</RequireSignIn>;
}
