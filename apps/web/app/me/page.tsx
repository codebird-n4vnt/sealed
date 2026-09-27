'use client';

import type { UiWalletAccount } from '@wallet-standard/react';
import { useCallback, useEffect, useState } from 'react';

import { MembershipCard, type Membership } from '@/components/employee';
import { RequireSignIn } from '@/components/gate';
import { EmptyState, ErrorText, PageHeader, Spinner } from '@/components/ui';
import { api, errorMessage } from '@/lib/client/api';

function MyPay({ account }: { account: UiWalletAccount }) {
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ memberships: Membership[] }>('/api/memberships')
      .then(data => setMemberships(data.memberships))
      .catch(e => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="grid gap-6">
      <PageHeader title="My pay" />
      <p className="-mt-3 max-w-2xl text-sm text-muted">
        Your pay is encrypted on-chain. It&apos;s decrypted here, in your browser, with keys only your wallet can create.
      </p>
      <ErrorText error={error} />
      {!memberships && !error && <Spinner />}
      {memberships?.length === 0 && (
        <EmptyState title="You're not on a payroll yet">
          Ask your employer for an invite link, and open it with this wallet.
        </EmptyState>
      )}
      {memberships?.map(membership => (
        <MembershipCard key={membership.memberId} account={account} membership={membership} onChange={load} />
      ))}
    </div>
  );
}

export default function MyPayPage() {
  return <RequireSignIn reason="Sign in with the wallet you get paid in.">{account => <MyPay account={account} />}</RequireSignIn>;
}
