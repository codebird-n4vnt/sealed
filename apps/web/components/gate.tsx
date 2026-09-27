'use client';

import type { UiWalletAccount } from '@wallet-standard/react';
import { useState, type ReactNode } from 'react';

import { errorMessage } from '@/lib/client/api';
import { useSession, useSignIn } from '@/lib/client/session';
import { useWallet } from '@/lib/client/wallet';

import { Button, Card, ErrorText, Spinner } from './ui';
import { WalletButton } from './wallet-button';

function SignInCard({ account, reason }: { account: UiWalletAccount; reason: string }) {
  const signIn = useSignIn(account);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Sign in with your wallet" description={reason}>
      <p className="mb-4 text-sm text-muted">
        Your wallet signs a one-time message. It doesn&apos;t send a transaction or cost anything.
      </p>
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await signIn();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Sign in
      </Button>
      <div className="mt-3">
        <ErrorText error={error} />
      </div>
    </Card>
  );
}

/** Renders `children` only for a connected, signed-in wallet; otherwise asks for that first. */
export function RequireSignIn({
  reason,
  children,
}: {
  reason: string;
  children: (account: UiWalletAccount) => ReactNode;
}) {
  const { account } = useWallet();
  const { wallet } = useSession();

  if (wallet === undefined) {
    return (
      <div className="flex justify-center py-16 text-muted">
        <Spinner />
      </div>
    );
  }
  if (!account) {
    return (
      <Card title="Connect a wallet" description={reason}>
        <p className="mb-4 text-sm text-muted">
          Use Phantom, Solflare or Backpack set to devnet, or the built-in test wallet for a quick try.
        </p>
        <WalletButton />
      </Card>
    );
  }
  if (wallet !== account.address) return <SignInCard account={account} reason={reason} />;
  return <>{children(account)}</>;
}
