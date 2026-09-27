'use client';

import type { UiWalletAccount } from '@wallet-standard/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { SetupAccount, type Membership } from '@/components/employee';
import { RequireSignIn } from '@/components/gate';
import { Button, Card, ErrorText, Notice, Spinner, shortAddress } from '@/components/ui';
import { api, errorMessage } from '@/lib/client/api';

type Invite = {
  memberId: string;
  company: { name: string; symbol: string; ready: boolean };
  member: { name: string; status: 'invited' | 'joined' | 'ready'; wallet: string | null };
};

function Join({ account, invite, reload }: { account: UiWalletAccount; invite: Invite; reload: () => void }) {
  const { token } = useParams<{ token: string }>();
  const [membership, setMembership] = useState<Membership | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkedHere = invite.member.wallet === account.address;

  useEffect(() => {
    if (!linkedHere) return;
    api<{ memberships: Membership[] }>('/api/memberships')
      .then(data => setMembership(data.memberships.find(m => m.memberId === invite.memberId) ?? null))
      .catch(e => setError(errorMessage(e)));
  }, [linkedHere, invite.memberId, invite.member.status]);

  if (invite.member.wallet && !linkedHere) {
    return (
      <Notice tone="bad">
        This invite is linked to the wallet {shortAddress(invite.member.wallet)}. Connect that wallet to continue.
      </Notice>
    );
  }

  if (!linkedHere) {
    return (
      <Card title={`Join ${invite.company.name}`} description={`You'll be paid in ${shortAddress(account.address)}.`}>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/api/invites/${token}`, { method: 'POST' });
              reload();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Accept invite
        </Button>
        <div className="mt-3">
          <ErrorText error={error} />
        </div>
      </Card>
    );
  }

  if (invite.member.status === 'ready') {
    return (
      <Card title="You're all set" description={`${invite.company.name} can now pay you privately.`}>
        <Link href="/me" className="text-sm font-medium underline">
          Go to My pay →
        </Link>
      </Card>
    );
  }

  return (
    <Card title="Set up your private account" description="Only you, your employer and their accountant will be able to see your pay.">
      {membership ? <SetupAccount account={account} membership={membership} onReady={reload} /> : <Spinner />}
      <ErrorText error={error} />
    </Card>
  );
}

function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Invite>(`/api/invites/${token}`)
      .then(setInvite)
      .catch(e => setError(errorMessage(e)));
  }, [token]);
  useEffect(load, [load]);

  if (error) return <ErrorText error={error} />;
  if (!invite) return <Spinner />;

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <div>
        <p className="text-sm font-medium text-wax">Invitation</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          {invite.company.name} wants to pay you privately
        </h1>
        <p className="mt-3 text-muted">
          Hi {invite.member.name}. {invite.company.name} pays its team in {invite.company.symbol}, a stablecoin on Solana.
          Your salary is encrypted on-chain: people can see that you were paid, but not how much. You never need SOL for
          fees.
        </p>
      </div>
      {!invite.company.ready ? (
        <Notice tone="warn">{invite.company.name} hasn&apos;t finished setting up payroll yet. Try again a little later.</Notice>
      ) : (
        <RequireSignIn reason="Connect the wallet you want to be paid in.">
          {account => <Join account={account} invite={invite} reload={load} />}
        </RequireSignIn>
      )}
    </div>
  );
}

export default JoinPage;
