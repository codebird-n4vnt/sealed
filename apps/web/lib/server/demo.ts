import 'server-only';

import { HttpError } from './http';
import type { CompanyDoc } from './models';

/**
 * The public demo (opt-in): DEMO_KIT holds a devnet demo company's id and test-wallet identities
 * for its admin, one employee and the accountant, plus its auditor key, so visitors can explore
 * each role without a wallet. These keys are public on purpose and control only that test company.
 * Real companies never go through here: the server still never holds their auditor keys.
 * `pnpm seed` writes the value to .keys/demo-devnet/demo-kit.json.
 */
export type DemoRole = 'admin' | 'employee' | 'accountant';
export type DemoIdentity = { label: string; seed: string };
export type DemoKit = {
  companyId: string;
  identities: Record<DemoRole, DemoIdentity>;
  auditorKey: unknown;
};

let cached: DemoKit | null | undefined;

export function demoKit(): DemoKit | null {
  if (cached !== undefined) return cached;
  const raw = process.env.DEMO_KIT;
  if (!raw) return (cached = null);
  try {
    const kit = JSON.parse(raw) as DemoKit;
    const roles: DemoRole[] = ['admin', 'employee', 'accountant'];
    if (typeof kit.companyId !== 'string' || !roles.every(role => typeof kit.identities?.[role]?.seed === 'string')) {
      throw new Error('missing fields');
    }
    return (cached = kit);
  } catch (error) {
    console.error('DEMO_KIT is set but unreadable; the public demo is off:', error);
    return (cached = null);
  }
}

export const isDemoCompany = (company: CompanyDoc) => demoKit()?.companyId === company.id;

/** The demo company's team and accountants stay as seeded, since anyone can sign in as its admin. */
export function assertEditable(company: CompanyDoc) {
  if (isDemoCompany(company)) {
    throw new HttpError(403, "The demo company's team can't be changed. Create your own company to try this.");
  }
}
