'use client';

import { useConnect, useDisconnect, type UiWallet } from '@wallet-standard/react';
import { useEffect, useRef, useState } from 'react';

import { errorMessage } from '@/lib/client/api';
import { useSession } from '@/lib/client/session';
import { TEST_WALLET_NAME, testWallet } from '@/lib/client/test-wallet';
import { useWallet } from '@/lib/client/wallet';
import { TEST_WALLET_ENABLED } from '@/lib/config';

import { Button, Input, shortAddress } from './ui';

function WalletOption({ wallet, onDone }: { wallet: UiWallet; onDone: (error?: string) => void }) {
  const { setAccount } = useWallet();
  const [connecting, connect] = useConnect(wallet);
  return (
    <button
      type="button"
      disabled={connecting}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-surface-2 disabled:opacity-50"
      onClick={async () => {
        try {
          const accounts = await connect();
          if (accounts[0]) setAccount(accounts[0]);
          onDone();
        } catch (error) {
          onDone(errorMessage(error));
        }
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={wallet.icon} alt="" className="size-6 rounded" />
      <span className="flex-1">{wallet.name === TEST_WALLET_NAME ? 'Test wallet (in this browser)' : wallet.name}</span>
    </button>
  );
}

function DisconnectButton({ wallet, onDone }: { wallet: UiWallet; onDone: () => void }) {
  const { setAccount } = useWallet();
  const { signOut } = useSession();
  const [, disconnect] = useDisconnect(wallet);
  return (
    <button
      type="button"
      className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-bad hover:bg-bad-soft"
      onClick={async () => {
        await signOut().catch(() => {});
        await disconnect().catch(() => {});
        setAccount(undefined);
        onDone();
      }}
    >
      Disconnect
    </button>
  );
}

/** Test wallet identities: switch between people in one browser, or add a new (0 SOL) one. */
function TestIdentities({ onDone }: { onDone: () => void }) {
  const { signOut } = useSession();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const { identities, active } = testWallet().identities();
  const change = async (action: () => Promise<void>) => {
    setBusy(true);
    await signOut().catch(() => {});
    await action();
    setBusy(false);
    onDone();
  };
  return (
    <div className="border-t border-line px-3 py-2">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Test identities</div>
      <div className="grid gap-0.5">
        {identities.map((identity, index) => (
          <button
            key={index}
            type="button"
            disabled={busy || index === active}
            onClick={() => change(() => testWallet().switchTo(index))}
            className="rounded-lg px-2 py-1 text-left text-sm hover:bg-surface-2 disabled:font-semibold disabled:opacity-100"
          >
            {index === active ? '● ' : ''}
            {identity.label}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={event => {
          event.preventDefault();
          void change(() => testWallet().createIdentity(label || `Test wallet ${identities.length + 1}`));
        }}
      >
        <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="New identity, e.g. Priya" className="h-8" />
        <Button type="submit" variant="secondary" className="h-8 px-3" disabled={busy}>
          Add
        </Button>
      </form>
      <label className="mt-2 block cursor-pointer text-xs text-muted underline hover:text-ink">
        Import identities from a file…
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={event => {
            const file = event.target.files?.[0];
            if (!file) return;
            void change(async () => {
              try {
                await testWallet().importIdentities(await file.text(), file.name.replace(/\.json$/, ''));
              } catch (error) {
                setImportError(errorMessage(error));
              }
            });
          }}
        />
      </label>
      {importError && <p className="mt-1 text-xs text-bad">{importError}</p>}
    </div>
  );
}

export function WalletButton() {
  const { account, setAccount, wallets } = useWallet();
  const { wallet: sessionWallet } = useSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const activeWallet = wallets.find(w => w.accounts.some(a => a.address === account?.address));

  const label = account ? (account.label ?? shortAddress(account.address)) : null;
  const signedIn = !!account && sessionWallet === account.address;

  return (
    <div className="relative" ref={menu}>
      <Button variant={account ? 'secondary' : 'primary'} onClick={() => setOpen(o => !o)} className="h-9">
        {account ? (
          <>
            <span className={`size-2 rounded-full ${signedIn ? 'bg-ok' : 'bg-warn'}`} />
            <span className="max-w-32 truncate">{label}</span>
          </>
        ) : (
          'Connect wallet'
        )}
      </Button>
      {open && (
        <div className="pop-in absolute right-0 z-20 mt-2 w-72 overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_60px_-20px_rgba(20,20,40,0.25)]">
          {account ? (
            <>
              <div className="px-3 py-3">
                <div className="font-mono text-xs break-all">{account.address}</div>
                <div className="mt-1 text-xs text-muted">{signedIn ? 'Signed in' : 'Connected, not signed in'}</div>
              </div>
              {activeWallet?.name === TEST_WALLET_NAME && <TestIdentities onDone={() => setOpen(false)} />}
              <div className="border-t border-line p-1">
                {activeWallet && <DisconnectButton wallet={activeWallet} onDone={() => setOpen(false)} />}
              </div>
            </>
          ) : (
            <div className="p-1">
              {wallets.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted">
                  No wallet found for this network. Install Phantom, Solflare or Backpack
                  {TEST_WALLET_ENABLED ? ', or reload to use the test wallet' : ''}.
                </p>
              )}
              {[...wallets]
                .sort((a, b) => Number(b.name === TEST_WALLET_NAME) - Number(a.name === TEST_WALLET_NAME))
                .map(wallet => (
                  <WalletOption
                    key={wallet.name}
                    wallet={wallet}
                    onDone={message => {
                      setError(message ?? null);
                      if (!message) setOpen(false);
                    }}
                  />
                ))}
              {error && <p className="px-3 py-2 text-sm text-bad">{error}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
