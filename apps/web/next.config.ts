import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The core library ships TypeScript source.
  transpilePackages: ['@sealed/core'],
  // Loaded by Node at runtime rather than bundled: the ZK SDK reads its WASM from disk.
  serverExternalPackages: ['@solana/zk-sdk', 'mongoose'],
};

export default nextConfig;
