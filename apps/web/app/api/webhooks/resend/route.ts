/**
 * Resend's webhook: bounces, complaints, suppressed and failed sends. See
 * `@/mailEvents`.
 *
 * Signed, and refused unsigned: anybody can POST here, and an unsigned event
 * would let them raise "safety alerts are not being delivered" at will. 404
 * rather than 401 for a bad signature, like the other machine-only routes.
 * No secret set is 503, so a misconfigured endpoint shows as failing in
 * Resend's dashboard rather than as delivered.
 *
 * Not CSRF-checked by `proxy.ts`, which passes requests that carry neither
 * `Origin` nor `Sec-Fetch-Site` — a server, as this is.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { recordMailEvent, verifySignature } from '@/mailEvents';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const sessionSecret = process.env.SESSION_SECRET;
  if (!secret || !sessionSecret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const body = await request.text();
  const id = request.headers.get('svix-id');
  const signed = verifySignature(
    secret,
    { id, timestamp: request.headers.get('svix-timestamp'), signature: request.headers.get('svix-signature') },
    body,
  );
  if (!signed || !id) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const recorded = await recordMailEvent(getDb(), id, payload as never, { secret: sessionSecret });
  return NextResponse.json({ ok: true, recorded });
}
