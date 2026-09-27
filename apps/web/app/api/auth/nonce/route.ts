import { json, route } from '@/lib/server/http';
import { createNonce } from '@/lib/server/session';

export const GET = route(async () => json({ nonce: await createNonce() }));
