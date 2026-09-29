import { demoKit } from '@/lib/server/demo';
import { json, route } from '@/lib/server/http';

/** Whether this deployment offers the public demo, and for which company. */
export const GET = route(async () => {
  const kit = demoKit();
  return json(kit ? { enabled: true, companyId: kit.companyId } : { enabled: false });
});
