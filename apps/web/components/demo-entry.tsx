'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api, errorMessage } from '@/lib/client/api';
import { DEMO_AUDITOR_KEY_STORAGE } from '@/lib/client/demo';
import { TEST_WALLET_NAME, testWallet, type TestIdentity } from '@/lib/client/test-wallet';
import { TEST_WALLET_ENABLED } from '@/lib/config';

import { Button, ErrorText } from './ui';

type Role = 'admin' | 'employee' | 'accountant';

const ROLES: Array<{ role: Role; label: string; what: string }> = [
  { role: 'admin', label: 'As the admin', what: 'Fund the treasury and run payroll for a 10-person team.' },
  { role: 'employee', label: 'As an employee', what: 'See your pay decrypted, collect it and withdraw, with 0 SOL.' },
  { role: 'accountant', label: 'As the accountant', what: 'Decrypt every payment with the auditor key and export a CSV.' },
];

/**
 * The public demo: one click loads a demo role's identity into the built-in test wallet and opens
 * that role's page on the seeded demo company. Shown only where the server offers a demo.
 */
export function DemoEntry() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!TEST_WALLET_ENABLED) return;
    api<{ enabled: boolean }>('/api/demo')
      .then(demo => setEnabled(demo.enabled))
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  const explore = async (role: Role) => {
    setBusy(role);
    setError(null);
    try {
      const kit = await api<{ companyId: string; identity: TestIdentity; auditorKey?: unknown }>(`/api/demo/${role}`);
      // Select the test wallet, then make this role's identity its active one.
      try {
        localStorage.setItem('sealed:selected-wallet', `${TEST_WALLET_NAME}:`);
        if (kit.auditorKey) sessionStorage.setItem(DEMO_AUDITOR_KEY_STORAGE, JSON.stringify(kit.auditorKey));
      } catch {
        // Storage unavailable: the identity still loads for this page.
      }
      await testWallet().importIdentities(JSON.stringify({ identities: [kit.identity] }), kit.identity.label);
      router.push(role === 'admin' ? `/company/${kit.companyId}` : role === 'employee' ? '/me' : '/audit');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="grid gap-4 rounded-2xl border border-wax/30 bg-wax-soft p-6">
      <div className="grid gap-1">
        <h2 className="text-lg font-semibold">Explore the live demo</h2>
        <p className="text-sm text-muted">
          Acme DAO, a seeded company on devnet. Each role runs in a test wallet in this browser, so you don&apos;t need
          one of your own. Amounts show only for the role allowed to see them.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {ROLES.map(({ role, label, what }) => (
          <div key={role} className="grid content-start gap-2">
            <Button variant={role === 'admin' ? 'primary' : 'secondary'} loading={busy === role} disabled={!!busy} onClick={() => explore(role)}>
              {label}
            </Button>
            <p className="text-xs text-muted">{what}</p>
          </div>
        ))}
      </div>
      <ErrorText error={error} />
    </section>
  );
}
