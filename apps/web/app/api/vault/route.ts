import { USDC_MINT } from '@/lib/config';
import { json, route } from '@/lib/server/http';
import { vaultAvailable } from '@/lib/server/solana';

/** Whether new companies can be backed by USDC here (the Sealed Vault program is deployed). */
export const GET = route(async () => json({ available: await vaultAvailable(), usdcMint: USDC_MINT }));
