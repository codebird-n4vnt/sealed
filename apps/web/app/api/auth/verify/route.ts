import { json, readJson, route } from '@/lib/server/http';
import { signIn } from '@/lib/server/session';

export const POST = route(async request => {
  const body = await readJson<{ message: string; signature: string }>(request);
  return json({ wallet: await signIn(body) });
});
