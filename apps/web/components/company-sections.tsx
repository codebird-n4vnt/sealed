'use client';

import type { UiWalletAccount } from '@wallet-standard/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { api, errorMessage, toBase64 } from '@/lib/client/api';
import { useSignText } from '@/lib/client/wallet';
import { parseTeamCsv, TEAM_CSV_TEMPLATE, type TeamRow } from '@/lib/team-csv';

import {
  AddressLink,
  Amount,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Notice,
  Stat,
} from './ui';

export type CompanyData = {
  company: {
    id: string;
    name: string;
    symbol: string;
    decimals: number;
    status: 'setup' | 'ready';
    adminWallet: string;
    vault: string;
    mint: string;
    treasuryAccount: string | null;
    auditorElgamalPubkey: string;
    accountantWallets: string[];
    backing: 'test' | 'usdc';
    usdcMint: string | null;
    usdcFundingAddress: string | null;
  };
  balances: { sol: string; public: string; confidential: string; pending: string; usdcWaiting?: string } | null;
  chainError: string | null;
  members: Array<{
    id: string;
    name: string;
    email: string | null;
    wallet: string | null;
    salary: string;
    status: 'invited' | 'joined' | 'ready';
    inviteToken: string;
    tokenAccount: string | null;
  }>;
  runs: Array<{ id: string; status: RunStatus; count: number; total: string; createdAt: string; finishedAt: string | null }>;
};

export type RunStatus = 'draft' | 'running' | 'completed' | 'partial' | 'failed';

const sol = (lamports: string | undefined) => (Number(lamports ?? 0) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 3 });

function useAction(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function SetupCard({ data, reload }: { data: CompanyData; reload: () => void }) {
  const airdrop = useAction(reload);
  const setup = useAction(reload);
  const hasSol = Number(data.balances?.sol ?? 0) >= 50_000_000;
  return (
    <Card
      title="Finish setting up"
      description="Sealed creates your company's private stablecoin and confidential treasury on the test network."
    >
      <ol className="grid gap-5">
        <li className="grid gap-2">
          <div className="text-sm font-medium">1. Give the payroll vault test SOL for fees</div>
          <p className="text-sm text-muted">
            The vault pays every fee, for you and your team, so employees never need SOL. It holds{' '}
            <strong className="text-ink">{sol(data.balances?.sol)} SOL</strong>. Address:{' '}
            <AddressLink address={data.company.vault} />
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" loading={airdrop.busy} onClick={() => airdrop.run(() => api(`/api/companies/${data.company.id}/airdrop`, { method: 'POST' }))}>
              Request test SOL
            </Button>
            <a className="text-sm text-muted underline" href="https://faucet.solana.com" target="_blank" rel="noreferrer">
              or use the Solana faucet
            </a>
          </div>
          <ErrorText error={airdrop.error} />
        </li>
        <li className="grid gap-2">
          <div className="text-sm font-medium">2. Create the company token and treasury</div>
          <p className="text-sm text-muted">
            A test stablecoin with confidential transfers, your accountant&apos;s auditor key, and approval required for
            every account, so only your team can hold it.
          </p>
          <div>
            <Button disabled={!hasSol} loading={setup.busy} onClick={() => setup.run(() => api(`/api/companies/${data.company.id}/setup`, { method: 'POST' }))}>
              Finish setup
            </Button>
          </div>
          {setup.busy && <p className="text-sm text-muted">Creating the token and treasury. This takes a few seconds.</p>}
          <ErrorText error={setup.error} />
        </li>
      </ol>
    </Card>
  );
}

export function TreasuryCard({ data, reload }: { data: CompanyData; reload: () => void }) {
  const [amount, setAmount] = useState('10000');
  const fund = useAction(reload);
  const { company, balances } = data;
  if (company.backing === 'usdc') return <UsdcTreasuryCard data={data} reload={reload} />;
  return (
    <Card
      title="Treasury"
      description="Payroll is paid from the confidential balance. Only your company can decrypt it."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Confidential treasury"
          value={balances ? <Amount value={balances.confidential} symbol={company.symbol} decimals={company.decimals} /> : '—'}
          hint="Encrypted on-chain"
        />
        <Stat
          label="Public balance"
          value={balances ? <Amount value={balances.public} symbol={company.symbol} decimals={company.decimals} /> : '—'}
          hint="Not yet moved into the treasury"
        />
        <Stat label="SOL for fees" value={`${sol(balances?.sol)} SOL`} hint="Pays for you and your team" />
      </div>
      <form
        className="mt-5 flex flex-wrap items-end gap-3"
        onSubmit={event => {
          event.preventDefault();
          void fund.run(() => api(`/api/companies/${company.id}/treasury`, { body: { amount } }));
        }}
      >
        <Field label={`Add test ${company.symbol}`}>
          <Input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className="w-44" />
        </Field>
        <Button type="submit" variant="secondary" loading={fund.busy}>
          Fund treasury
        </Button>
      </form>
      <p className="mt-2 text-xs text-muted">
        Test network only: this mints test tokens. The funded total is public on-chain; how it&apos;s split between your
        team is not. In production, the Sealed Vault wraps USDC 1:1.
      </p>
      <ErrorText error={fund.error} />
    </Card>
  );
}

/** A USDC-backed treasury: USDC arrives at the funding address, then wraps 1:1 into the treasury. */
function UsdcTreasuryCard({ data, reload }: { data: CompanyData; reload: () => void }) {
  const wrap = useAction(reload);
  const { company, balances } = data;
  const waiting = BigInt(balances?.usdcWaiting ?? '0');
  return (
    <Card
      title="Treasury"
      description="Backed 1:1 by USDC through the Sealed Vault. Payroll is paid from the confidential balance; only your company can decrypt it."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Confidential treasury"
          value={balances ? <Amount value={balances.confidential} symbol={company.symbol} decimals={company.decimals} /> : '—'}
          hint={`Encrypted on-chain, redeemable 1:1 for USDC`}
        />
        <Stat label="USDC waiting" value={balances ? <Amount value={waiting} symbol="USDC" decimals={company.decimals} /> : '—'} hint="At the funding address" />
        <Stat label="SOL for fees" value={`${sol(balances?.sol)} SOL`} hint="Pays for you and your team" />
      </div>
      <div className="mt-5 grid gap-3">
        <div className="grid gap-1 text-sm">
          <span className="font-medium">Funding address</span>
          <span className="text-muted">
            Send USDC here from any wallet or exchange:{' '}
            {company.usdcFundingAddress && <AddressLink address={company.usdcFundingAddress} />}
          </span>
        </div>
        <div>
          <Button
            variant="secondary"
            disabled={waiting === 0n}
            loading={wrap.busy}
            onClick={() => wrap.run(() => api(`/api/companies/${company.id}/treasury/wrap`, { method: 'POST' }))}
          >
            Move {waiting > 0n ? <Amount value={waiting} symbol="USDC" decimals={company.decimals} /> : 'USDC'} into the private treasury
          </Button>
        </div>
        <p className="text-xs text-muted">
          The funded total is public on-chain; how it&apos;s split between your team is not. The Sealed Vault program
          checks on-chain that company tokens never exceed the USDC it holds.
        </p>
      </div>
      <ErrorText error={wrap.error} />
    </Card>
  );
}

const MEMBER_STATUS = {
  invited: <Badge tone="neutral">Invited</Badge>,
  joined: <Badge tone="warn">Setting up</Badge>,
  ready: <Badge tone="ok">Ready to pay</Badge>,
};

function InviteLink({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window === 'undefined' ? '' : `${window.location.origin}/join/${token}`;
  return (
    <button
      type="button"
      className="text-xs text-muted underline hover:text-ink"
      onClick={() => {
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1_500);
        });
      }}
    >
      {copied ? 'Link copied' : 'Copy invite link'}
    </button>
  );
}

export function TeamCard({ data, reload }: { data: CompanyData; reload: () => void }) {
  const { company, members } = data;
  const [name, setName] = useState('');
  const [salary, setSalary] = useState('');
  const [wallet, setWallet] = useState('');
  const add = useAction(() => {
    setName('');
    setSalary('');
    setWallet('');
    reload();
  });
  const remove = useAction(reload);
  const total = members.reduce((sum, m) => sum + BigInt(m.salary), 0n);

  return (
    <Card
      title="Team"
      description="Salaries are stored encrypted. Each person gets an invite link to set up their private account."
      actions={members.length > 0 && <span className="text-sm text-muted">Monthly total <Amount value={total} symbol={company.symbol} decimals={company.decimals} /></span>}
    >
      {members.length === 0 ? (
        <EmptyState title="No one on the team yet">Add people below, then send them their invite links.</EmptyState>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-2 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Wallet</th>
                <th className="px-2 py-2 text-right font-medium">Salary</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {members.map(member => (
                <tr key={member.id} className="border-t border-line">
                  <td className="px-2 py-3 font-medium">{member.name}</td>
                  <td className="px-2 py-3">{member.wallet ? <AddressLink address={member.wallet} /> : <span className="text-muted">—</span>}</td>
                  <td className="px-2 py-3 text-right">
                    <Amount value={member.salary} symbol={company.symbol} decimals={company.decimals} />
                  </td>
                  <td className="px-2 py-3">{MEMBER_STATUS[member.status]}</td>
                  <td className="px-2 py-3 text-right whitespace-nowrap">
                    {member.status !== 'ready' && <InviteLink token={member.inviteToken} />}
                    <button
                      type="button"
                      className="ml-3 text-xs text-muted hover:text-bad"
                      disabled={remove.busy}
                      onClick={() => {
                        if (confirm(`Remove ${member.name} from future payroll runs?`)) {
                          void remove.run(() => api(`/api/companies/${company.id}/members/${member.id}`, { method: 'DELETE' }));
                        }
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorText error={remove.error} />
      <form
        className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-[1fr_9rem_1fr_auto] sm:items-end"
        onSubmit={event => {
          event.preventDefault();
          void add.run(() =>
            api(`/api/companies/${company.id}/members`, { body: { name, salary, wallet: wallet || undefined } }),
          );
        }}
      >
        <Field label="Name">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Priya Sharma" required />
        </Field>
        <Field label={`Salary (${company.symbol})`}>
          <Input value={salary} onChange={e => setSalary(e.target.value)} inputMode="decimal" placeholder="4200" required />
        </Field>
        <Field label="Wallet (optional)">
          <Input value={wallet} onChange={e => setWallet(e.target.value)} placeholder="Set when they accept the invite" />
        </Field>
        <Button type="submit" variant="secondary" loading={add.busy}>
          Add
        </Button>
      </form>
      <ErrorText error={add.error} />
      <TeamImport company={company} reload={reload} />
    </Card>
  );
}

const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEAM_CSV_TEMPLATE)}`;

/** Adds a whole team from a CSV file, after a preview. All or nothing. */
function TeamImport({ company, reload }: { company: CompanyData['company']; reload: () => void }) {
  const [file, setFile] = useState<{ name: string; rows: TeamRow[]; errors: string[] } | null>(null);
  const importing = useAction(() => {
    setFile(null);
    reload();
  });

  if (!file) {
    return (
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-5 text-sm">
        <label className="inline-flex h-10 cursor-pointer items-center rounded-lg border border-line bg-surface px-4 font-medium hover:bg-surface-2">
          Import from CSV
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={async event => {
              const chosen = event.target.files?.[0];
              event.target.value = '';
              if (chosen) setFile({ name: chosen.name, ...parseTeamCsv(await chosen.text()) });
            }}
          />
        </label>
        <span className="text-muted">
          Columns: name, salary, and optionally wallet and email.{' '}
          <a className="underline" href={TEMPLATE_HREF} download="sealed-team-template.csv">
            Download a template
          </a>
        </span>
      </div>
    );
  }

  const shown = file.rows.slice(0, 5);
  return (
    <div className="mt-5 grid gap-3 border-t border-line pt-5 text-sm">
      <p>
        <span className="font-medium">{file.name}</span>: {file.rows.length} {file.rows.length === 1 ? 'person' : 'people'}
      </p>
      {shown.length > 0 && (
        <ul className="grid gap-1 text-muted">
          {shown.map(row => (
            <li key={row.line}>
              {row.name}, {row.salary} {company.symbol}
              {row.wallet ? `, ${row.wallet.slice(0, 4)}…${row.wallet.slice(-4)}` : ''}
            </li>
          ))}
          {file.rows.length > shown.length && <li>and {file.rows.length - shown.length} more</li>}
        </ul>
      )}
      {file.errors.length > 0 && (
        <Notice tone="warn">
          Fix these and choose the file again: {file.errors.slice(0, 5).join(' ')}
          {file.errors.length > 5 ? ` (and ${file.errors.length - 5} more)` : ''}
        </Notice>
      )}
      <div className="flex gap-3">
        <Button
          disabled={file.errors.length > 0 || file.rows.length === 0}
          loading={importing.busy}
          onClick={() =>
            importing.run(() => api(`/api/companies/${company.id}/members/import`, { body: { rows: file.rows } }))
          }
        >
          Add {file.rows.length} {file.rows.length === 1 ? 'person' : 'people'}
        </Button>
        <Button variant="ghost" onClick={() => setFile(null)} disabled={importing.busy}>
          Cancel
        </Button>
      </div>
      <ErrorText error={importing.error} />
    </div>
  );
}

type Draft = {
  runId: string;
  approvalMessage: string;
  total: string;
  items: Array<{ name: string; wallet: string; amount: string }>;
  skipped: Array<{ name: string; reason: string }>;
};

export function PayrollCard({ data, account }: { data: CompanyData; account: UiWalletAccount }) {
  const router = useRouter();
  const signText = useSignText(account);
  const { company, balances, runs } = data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const prepare = useAction(() => {});
  const approve = useAction(() => {});
  const running = runs.find(r => r.status === 'running');
  const enough = draft && balances ? BigInt(balances.confidential) >= BigInt(draft.total) : true;

  return (
    <Card
      title="Payroll"
      description="Review who gets what, approve with your wallet, and Sealed pays everyone confidentially, one by one."
      actions={
        !draft && (
          <Button
            loading={prepare.busy}
            disabled={!!running}
            onClick={() => prepare.run(async () => setDraft(await api<Draft>(`/api/companies/${company.id}/runs`, { method: 'POST' })))}
          >
            Run payroll
          </Button>
        )
      }
    >
      {running && (
        <Notice tone="warn">
          A run is in progress. <Link className="underline" href={`/company/${company.id}/runs/${running.id}`}>Watch it</Link>.
        </Notice>
      )}
      <ErrorText error={prepare.error} />
      {draft && (
        <div className="grid gap-4">
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-2 py-2 font-medium">Pay</th>
                  <th className="px-2 py-2 font-medium">Wallet</th>
                  <th className="px-2 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {draft.items.map(item => (
                  <tr key={item.wallet} className="border-t border-line">
                    <td className="px-2 py-2.5 font-medium">{item.name}</td>
                    <td className="px-2 py-2.5"><AddressLink address={item.wallet} /></td>
                    <td className="px-2 py-2.5 text-right"><Amount value={item.amount} symbol={company.symbol} decimals={company.decimals} /></td>
                  </tr>
                ))}
                <tr className="border-t border-ink font-semibold">
                  <td className="px-2 py-2.5">Total ({draft.items.length})</td>
                  <td />
                  <td className="px-2 py-2.5 text-right"><Amount value={draft.total} symbol={company.symbol} decimals={company.decimals} /></td>
                </tr>
              </tbody>
            </table>
          </div>
          {draft.skipped.length > 0 && (
            <p className="text-sm text-muted">
              Not included: {draft.skipped.map(s => `${s.name} (${s.reason.toLowerCase()})`).join(', ')}.
            </p>
          )}
          {!enough && <Notice tone="bad">The confidential treasury holds less than this run pays out. Fund it first.</Notice>}
          <div className="flex flex-wrap gap-2">
            <Button
              loading={approve.busy}
              disabled={!enough}
              onClick={() =>
                approve.run(async () => {
                  const signature = await signText(draft.approvalMessage);
                  await api(`/api/runs/${draft.runId}/approve`, { body: { signature: toBase64(signature) } });
                  router.push(`/company/${company.id}/runs/${draft.runId}`);
                })
              }
            >
              Approve and pay
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted">Your wallet signs the approval message. It doesn&apos;t send a transaction.</p>
          <ErrorText error={approve.error} />
        </div>
      )}
      {!draft && runs.length > 0 && <RunList data={data} />}
      {!draft && runs.length === 0 && !running && (
        <p className="text-sm text-muted">No payroll runs yet.</p>
      )}
    </Card>
  );
}

export const RUN_STATUS: Record<RunStatus, React.ReactNode> = {
  draft: <Badge>Draft</Badge>,
  running: <Badge tone="warn">Running</Badge>,
  completed: <Badge tone="ok">Completed</Badge>,
  partial: <Badge tone="warn">Partly paid</Badge>,
  failed: <Badge tone="bad">Failed</Badge>,
};

function RunList({ data }: { data: CompanyData }) {
  const { company, runs } = data;
  return (
    <div className="grid divide-y divide-line">
      {runs.map(run => (
        <Link key={run.id} href={`/company/${company.id}/runs/${run.id}`} className="flex flex-wrap items-center gap-3 py-3 text-sm hover:bg-surface-2">
          <span className="w-44 text-muted">{new Date(run.createdAt).toLocaleString()}</span>
          <span className="w-24">{run.count} payments</span>
          <span className="flex-1"><Amount value={run.total} symbol={company.symbol} decimals={company.decimals} /></span>
          {RUN_STATUS[run.status]}
        </Link>
      ))}
    </div>
  );
}

export function AccessCard({ data, reload }: { data: CompanyData; reload: () => void }) {
  const { company } = data;
  const [wallet, setWallet] = useState('');
  const add = useAction(() => {
    setWallet('');
    reload();
  });
  const remove = useAction(reload);
  return (
    <Card title="Accountant access" description="The auditor key file decrypts amounts; accountant wallets also see who each payment went to.">
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Company token</dt>
          <dd><AddressLink address={company.mint} /></dd>
        </div>
        <div>
          <dt className="text-muted">Treasury account</dt>
          <dd>{company.treasuryAccount ? <AddressLink address={company.treasuryAccount} /> : '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-muted">Auditor public key</dt>
          <dd className="font-mono text-xs break-all">{company.auditorElgamalPubkey}</dd>
        </div>
      </dl>
      <div className="mt-5 grid gap-2">
        <div className="text-sm font-medium">Accountant wallets</div>
        {company.accountantWallets.length === 0 && <p className="text-sm text-muted">None yet.</p>}
        {company.accountantWallets.map(address => (
          <div key={address} className="flex items-center justify-between gap-2 text-sm">
            <AddressLink address={address} />
            <button
              type="button"
              className="text-xs text-muted hover:text-bad"
              onClick={() => remove.run(() => api(`/api/companies/${company.id}/accountants`, { method: 'DELETE', body: { wallet: address } }))}
            >
              Remove
            </button>
          </div>
        ))}
        <form
          className="mt-1 flex gap-2"
          onSubmit={event => {
            event.preventDefault();
            void add.run(() => api(`/api/companies/${company.id}/accountants`, { body: { wallet } }));
          }}
        >
          <Input value={wallet} onChange={e => setWallet(e.target.value)} placeholder="Accountant's wallet address" required />
          <Button type="submit" variant="secondary" loading={add.busy}>
            Add
          </Button>
        </form>
        <ErrorText error={add.error ?? remove.error} />
      </div>
    </Card>
  );
}
