#!/usr/bin/env node
// A local devnet RPC that splits traffic between two public endpoints, with retries.
//
// Why: api.devnet.solana.com has been timing out on account reads (getAccountInfo and friends)
// while everything else works, and free alternative RPCs rate-limit the bursts that
// confidential-transfer proofs cause. This sends account reads to ACCOUNTS_RPC and everything else
// (sending transactions, blockhashes, statuses, airdrops) to MAIN_RPC.
//
// Usage:
//   node scripts/devnet-rpc-proxy.mjs                  # listens on http://127.0.0.1:8898
//   RPC_URL=http://127.0.0.1:8898 bash scripts/day1-confidential-transfer.sh
//
// Websocket subscriptions aren't proxied: point clients at wss://api.devnet.solana.com for those.
// A private devnet RPC (Helius, Triton, QuickNode) makes this unnecessary.

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8898);
const MAIN_RPC = process.env.MAIN_RPC ?? 'https://api.devnet.solana.com';
const ACCOUNTS_RPC = process.env.ACCOUNTS_RPC ?? 'https://solana-devnet.api.onfinality.io/public';
const ACCOUNT_READS = new Set(['getAccountInfo', 'getMultipleAccounts', 'getProgramAccounts', 'getTokenAccountsByOwner']);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Paces requests to each upstream (public RPCs allow roughly 10 requests per second per IP), so
// bursty clients like spl-token's confirmation polling don't trip rate limits.
const MIN_INTERVAL_MS = Number(process.env.MIN_INTERVAL_MS ?? 125);
const nextSlot = new Map();
async function pace(upstream) {
  const now = Date.now();
  const slot = Math.max(now, nextSlot.get(upstream) ?? 0);
  nextSlot.set(upstream, slot + MIN_INTERVAL_MS);
  if (slot > now) await sleep(slot - now);
}

async function forward(upstream, body) {
  for (let attempt = 1; ; attempt++) {
    await pace(upstream);
    try {
      const response = await fetch(upstream, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      if ((response.status === 429 || response.status >= 500) && attempt < 10) {
        await sleep(Math.min(1_000 * 2 ** (attempt - 1), 10_000)); // 1s, 2s, 4s, 8s, then 10s
        continue;
      }
      return { status: response.status, text: await response.text() };
    } catch (error) {
      if (attempt >= 4) return { status: 502, text: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: String(error) } }) };
      await sleep(400 * attempt);
    }
  }
}

createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  let upstream = MAIN_RPC;
  try {
    const payload = JSON.parse(body);
    const methods = (Array.isArray(payload) ? payload : [payload]).map(call => call.method);
    if (methods.every(method => ACCOUNT_READS.has(method))) upstream = ACCOUNTS_RPC;
  } catch {
    // Not JSON: let the main RPC answer.
  }
  const { status, text } = await forward(upstream, body);
  response.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' });
  response.end(text);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Devnet RPC proxy on http://127.0.0.1:${PORT} (reads: ${ACCOUNTS_RPC}, rest: ${MAIN_RPC})`);
});
