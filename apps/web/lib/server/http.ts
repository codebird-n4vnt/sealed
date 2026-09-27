import 'server-only';

import { NextResponse } from 'next/server';

import { SponsorPolicyError } from '@sealed/core';

import { connectDb } from './db';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const forbidden = (message = 'Not allowed.') => new HttpError(403, message);
export const notFound = (what = 'Not found.') => new HttpError(404, what);

/** JSON response; bigints become strings. */
export function json(data: unknown, init?: ResponseInit) {
  return new NextResponse(JSON.stringify(data, (_, value) => (typeof value === 'bigint' ? value.toString() : value)), {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
}

type Handler<P> = (request: Request, context: { params: Promise<P> }) => Promise<Response>;

/** Wraps a route handler: connects the database and turns errors into JSON responses. */
export function route<P = Record<string, never>>(handler: Handler<P>): Handler<P> {
  return async (request, context) => {
    try {
      await connectDb();
      return await handler(request, context);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, { status: error.status });
      if (error instanceof SponsorPolicyError) return json({ error: error.message }, { status: 403 });
      console.error(error);
      return json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
    }
  };
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw badRequest('Expected a JSON body.');
  }
}
