import 'server-only';

import mongoose from 'mongoose';

import { env } from './env';

const cache = globalThis as typeof globalThis & { sealedMongo?: Promise<typeof mongoose> };

/** One shared connection, reused across hot reloads in development. */
export async function connectDb(): Promise<typeof mongoose> {
  cache.sealedMongo ??= mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 5_000 });
  try {
    return await cache.sealedMongo;
  } catch (error) {
    cache.sealedMongo = undefined;
    throw error;
  }
}
