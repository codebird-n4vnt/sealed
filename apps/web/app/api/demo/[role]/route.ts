import { demoKit, type DemoRole } from '@/lib/server/demo';
import { json, notFound, route } from '@/lib/server/http';

const ROLES: DemoRole[] = ['admin', 'employee', 'accountant'];

/** A public demo role's test-wallet identity (and, for the accountant, the demo auditor key). */
export const GET = route<{ role: string }>(async (_, { params }) => {
  const kit = demoKit();
  const role = (await params).role as DemoRole;
  if (!kit || !ROLES.includes(role)) throw notFound('There is no public demo here.');
  return json({
    companyId: kit.companyId,
    identity: kit.identities[role],
    ...(role === 'accountant' ? { auditorKey: kit.auditorKey } : {}),
  });
});
