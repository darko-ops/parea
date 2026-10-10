/**
 * Who may run a route under `app/api/cron`: only Vercel's scheduler, which
 * sends `CRON_SECRET` as a bearer token.
 *
 * Without a secret set, the route does nothing rather than answering anybody
 * who finds it. The comparison takes the same time however much of the token
 * matches, so the answer says nothing about how close a guess was.
 */

import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

function sameToken(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The response that refuses this request, or null when the scheduler sent it. */
export function cronGuard(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ') || !sameToken(auth.slice(7), secret)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}
