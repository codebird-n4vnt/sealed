'use client';

import { fetchMaybeToken } from '@solana-program/token-2022';
import type { Address } from '@solana/kit';
import type { UiWalletAccount } from '@wallet-standard/react';
import { useCallback, useEffect, useState } from 'react';

import {
  applyPendingBalance,
  cashOutToUsdc,
  confidentialState,
  fetchReceivedPayments,
  formatAmount,
  getConfidentialBalance,
  parseAmount,
  setupConfidentialAccount,
  tokenAccountAddress,
  withdrawConfidential,
  type ReceivedPayment,
} from '@sealed/core';

import { api, errorMessage } from '@/lib/client/api';
import { createEmployeeClient, employeeTransactionVersion, readOnlyClient, useConfidentialKeys } from '@/lib/client/confidential';
import { transactionCache } from '@/lib/client/transaction-cache';
import { useTransactionSigner } from '@/lib/client/wallet';

import { AddressLink, Amount, Badge, Button, Card, ErrorText, Field, Input, LockIcon, Notice, Sealed, Stat, displayAmount, formatBlockTime } from './ui';

export type Membership = {
  memberId: string;
  name: string;
  status: 'invited' | 'joined' | 'ready';
  company: {
    id: string;
    name: string;
    symbol: string;
    decimals: number;
    mint: string;
    vault: string;
    treasuryAccount: string | null;
    /** Set when the company's token is backed 1:1 by USDC: employees can cash out to it. */
    usdcMint: string | null;
  };
};

/** Creates and configures the employee's private account. They sign; the company pays and approves. */
export function SetupAccount({ account, membership, onReady }: { account: UiWalletAccount; membership: Membership; onReady: () => void }) {
  const { unlock } = useConfidentialKeys(account);
  const owner = useTransactionSigner(account);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    try {
      setStep('Sign once to create your private keys');
      const keys = await unlock();
      setStep('Approve the setup transaction (your company pays the fee)');
      const client = await createEmployeeClient({
        memberId: membership.memberId,
        vault: membership.company.vault,
        transactionVersion: employeeTransactionVersion(account),
      });
      await setupConfidentialAccount(client, { owner, mint: membership.company.mint as Address, keys });
      setStep(`Waiting for ${membership.company.name} to approve your account`);
      await api(`/api/memberships/${membership.memberId}/ready`, { method: 'POST' });
      setStep(null);
      onReady();
    } catch (e) {
      setStep(null);
      setError(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-3">
      <ol className="grid gap-2 text-sm text-muted">
        <li>
          <strong className="text-ink">1.</strong> Your wallet signs a message once. Your private keys are derived from it,
          in this browser only. Nothing extra to store, and they never leave your device.
        </li>
        <li>
          <strong className="text-ink">2.</strong> You approve one transaction that sets up your private account.{' '}
          {membership.company.name} pays the fee, so you don&apos;t need any SOL.
        </li>
      </ol>
      <div>
        <Button loading={!!step} onClick={run}>
          Set up my private account
        </Button>
      </div>
      {step && <p className="text-sm text-muted">{step}…</p>}
      <ErrorText error={error} />
    </div>
  );
}

type Balances = { public: bigint; pending: bigint | null; available: bigint | null; sol: bigint; payments: number };

function useBalances(account: UiWalletAccount, membership: Membership) {
  const { keys } = useConfidentialKeys(account);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mint = membership.company.mint as Address;
  const owner = account.address as Address;

  const load = useCallback(async () => {
    try {
      const client = await readOnlyClient();
      const token = await tokenAccountAddress(owner, mint);
      const [tokenAccount, sol] = await Promise.all([
        fetchMaybeToken(client.rpc, token),
        client.rpc.getBalance(owner).send(),
      ]);
      const state = tokenAccount.exists ? confidentialState(tokenAccount.data) : undefined;
      let pending: bigint | null = null;
      let available: bigint | null = null;
      if (keys && state) {
        const balance = await getConfidentialBalance(client, { owner, mint, keys });
        pending = balance.pendingBalance;
        available = balance.availableBalance;
      }
      setBalances({
        public: tokenAccount.exists ? tokenAccount.data.amount : 0n,
        pending,
        available,
        sol: sol.value,
        payments: Number(state?.pendingBalanceCreditCounter ?? 0n),
      });
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [keys, mint, owner]);

  useEffect(() => {
    void load();
  }, [load]);
  return { balances, error, reload: load };
}

function History({ account, membership }: { account: UiWalletAccount; membership: Membership }) {
  const { keys } = useConfidentialKeys(account);
  const [payments, setPayments] = useState<ReceivedPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { symbol, decimals } = membership.company;

  useEffect(() => {
    if (!keys) return;
    const controller = new AbortController();
    readOnlyClient()
      .then(client =>
        fetchReceivedPayments(client, {
          owner: account.address as Address,
          mint: membership.company.mint as Address,
          keys,
          cache: transactionCache,
          signal: controller.signal,
        }),
      )
      .then(result => !controller.signal.aborted && setPayments(result))
      .catch(e => !controller.signal.aborted && setError(errorMessage(e)));
    return () => controller.abort();
  }, [account.address, keys, membership.company.mint]);

  if (!keys) return <p className="text-sm text-muted">Unlock to see your payment history.</p>;
  if (error) return <ErrorText error={error} />;
  if (!payments) return <p className="text-sm text-muted">Decrypting your payments…</p>;
  if (payments.length === 0) return <p className="text-sm text-muted">No payments yet.</p>;

  // Built here from the amounts decrypted in this browser; nothing is sent anywhere.
  const download = () => {
    const lines = ['date_utc,company,amount,symbol,signature'];
    for (const payment of payments) {
      const date = Number(payment.blockTime ?? 0) > 1_600_000_000 ? new Date(Number(payment.blockTime) * 1000).toISOString() : '';
      const amount = payment.amount === null ? '' : formatAmount(payment.amount, decimals);
      const company = /[",\n]/.test(membership.company.name) ? `"${membership.company.name.replace(/"/g, '""')}"` : membership.company.name;
      lines.push([date, company, amount, symbol, payment.signature].join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${membership.company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-my-pay.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  return (
    <div className="grid divide-y divide-line">
      {payments.map(payment => (
        <div key={payment.signature} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
          <span className="w-44 text-muted">
            {formatBlockTime(payment.blockTime)}
          </span>
          <span className="flex-1 font-medium">
            {payment.amount === null ? <Sealed label="Amount unavailable" /> : <Amount value={payment.amount} symbol={symbol} decimals={decimals} />}
          </span>
          <AddressLink address={payment.signature} kind="tx" />
        </div>
      ))}
      <div className="pt-3">
        <Button variant="ghost" onClick={download}>
          Download as CSV
        </Button>
      </div>
    </div>
  );
}

export function MembershipCard({ account, membership, onChange }: { account: UiWalletAccount; membership: Membership; onChange: () => void }) {
  const { keys, unlock, unlocking } = useConfidentialKeys(account);
  const owner = useTransactionSigner(account);
  const { balances, error, reload } = useBalances(account, membership);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [busy, setBusy] = useState<'collect' | 'withdraw' | 'cashout' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { company } = membership;
  const mint = company.mint as Address;
  const version = employeeTransactionVersion(account);

  const act = async (kind: 'collect' | 'withdraw' | 'cashout', action: () => Promise<unknown>) => {
    setBusy(kind);
    setActionError(null);
    try {
      await action();
      await reload();
      setWithdrawAmount('');
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (membership.status !== 'ready') {
    return (
      <Card title={company.name} description="Finish setting up your private account to get paid.">
        <SetupAccount account={account} membership={membership} onReady={onChange} />
      </Card>
    );
  }

  const confidential = (value: bigint | null | undefined) =>
    value === null || value === undefined ? <Sealed label="Unlock to view" /> : <Amount value={value} symbol={company.symbol} decimals={company.decimals} />;

  return (
    <Card
      title={company.name}
      description={`Paid as ${membership.name}`}
      actions={
        !keys && (
          <Button variant="secondary" loading={unlocking} onClick={() => void unlock().catch(e => setActionError(errorMessage(e)))}>
            <LockIcon /> Unlock to view
          </Button>
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="New pay (pending)" value={confidential(balances?.pending)} hint="Collect it to use it" />
        <Stat label="Private balance" value={confidential(balances?.available)} hint="Only you can see this" />
        <Stat
          label="Public balance"
          value={balances ? <Amount value={balances.public} symbol={company.symbol} decimals={company.decimals} /> : '—'}
          hint="Visible to anyone"
        />
      </div>
      <ErrorText error={error} />

      {keys && balances && (
        <div className="mt-5 grid gap-4 border-t border-line pt-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={!balances.pending}
              loading={busy === 'collect'}
              onClick={() => act('collect', async () => {
                const client = await createEmployeeClient({ memberId: membership.memberId, vault: company.vault, transactionVersion: version });
                await applyPendingBalance(client, { owner, mint, keys });
              })}
            >
              Collect pay
            </Button>
            <span className="text-sm text-muted">Moves new pay into your private balance.</span>
          </div>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={event => {
              event.preventDefault();
              void act('withdraw', async () => {
                const amount = parseAmount(withdrawAmount, company.decimals);
                if (amount <= 0n) throw new Error('Enter an amount to withdraw.');
                if (balances.available !== null && amount > balances.available) throw new Error('That is more than your private balance.');
                const client = await createEmployeeClient({ memberId: membership.memberId, vault: company.vault, transactionVersion: version });
                await withdrawConfidential(client, {
                  owner,
                  mint,
                  keys,
                  amount,
                  decimals: company.decimals,
                  proofDelivery: version === 1 ? 'one-transaction' : 'inline',
                });
              });
            }}
          >
            <Field label="Withdraw to public balance">
              <Input
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                inputMode="decimal"
                placeholder={balances.available !== null ? displayAmount(balances.available, company.decimals).replace(/,/g, '') : ''}
                className="w-48"
              />
            </Field>
            <Button type="submit" variant="secondary" loading={busy === 'withdraw'} disabled={!balances.available}>
              Withdraw
            </Button>
          </form>
          <Notice tone="warn">
            Withdrawn amounts become public. Withdrawing exactly your salary reveals it; withdraw a different amount, or keep
            funds in your private balance.
          </Notice>
          {company.usdcMint && balances.public > 0n && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                loading={busy === 'cashout'}
                disabled={!!busy}
                onClick={() =>
                  act('cashout', async () => {
                    const client = await createEmployeeClient({ memberId: membership.memberId, vault: company.vault, transactionVersion: version });
                    await cashOutToUsdc(client, { holder: owner, companyMint: mint, usdcMint: company.usdcMint as Address, amount: balances.public });
                  })
                }
              >
                Cash out <Amount value={balances.public} symbol="USDC" decimals={company.decimals} />
              </Button>
              <span className="text-sm text-muted">Sends your public balance to your wallet as USDC, 1:1. {company.name} pays the fee.</span>
            </div>
          )}
        </div>
      )}
      <ErrorText error={actionError} />

      <div className="mt-5 grid gap-2 border-t border-line pt-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Payment history</h3>
          <span className="text-xs text-muted">
            <Badge tone="ok">{balances ? (Number(balances.sol) / 1e9).toString() : '0'} SOL</Badge> fees paid by {company.name}
          </span>
        </div>
        <History account={account} membership={membership} />
      </div>
    </Card>
  );
}
