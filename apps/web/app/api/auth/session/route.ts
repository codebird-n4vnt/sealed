import { json, route } from '@/lib/server/http';
import { currentWallet, signOut } from '@/lib/server/session';

export const GET = route(async () => json({ wallet: await currentWallet() }));

export const DELETE = route(async () => {
  await signOut();
  return json({ wallet: null });
});
