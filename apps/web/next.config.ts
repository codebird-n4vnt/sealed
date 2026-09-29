import { join } from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The core library ships TypeScript source.
  transpilePackages: ['@sealed/core'],
  // Loaded by Node at runtime rather than bundled: the ZK SDK reads its WASM from disk.
  serverExternalPackages: ['@solana/zk-sdk', 'mongoose'],
  // Trace files from the monorepo root, so deployments include the workspace packages.
  outputFileTracingRoot: join(import.meta.dirname, '..', '..'),
  // NEXT_OUTPUT=standalone builds a self-contained server (.next/standalone) for containers.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // No framing: a hidden frame could trick an admin into clicking "Approve and pay".
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Invite links carry a token in the path; other sites only ever see the origin.
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
