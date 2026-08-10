/**
 * Present a code, and become the account — design §3.
 *
 * The response is an actor token, the same signed value everything else uses.
 * An account is not a second kind of credential: it resolves to an actor, and
 * from there the product works exactly as it did.
 */

import { normaliseEmail, normaliseSignInCode } from '@parea/core';
import { NextResponse } from 'next/server';

import { accountFor, consumeCode, signIn } from '@/accounts';
import { getDb } from '@/db';
import { SIGN_IN_LIMIT, withinLimit } from '@/ratelimit';
import { actorToken, currentActorId, ensureActor, fromBrowser } from '@/session';

export const runtime = 'nodejs';

export async function GET() {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ account: null });
  return NextResponse.json({ account: await accountFor(getDb(), actorId) });
}

export async function POST(request: Request) {
  // Unlike `/api/session`, this one has a browser caller — the sign-in page —
  // so it answers normally and only withholds the token.
  const browser = await fromBrowser();

  const body = (await request.json().catch(() => ({}))) as {
    email?: unknown;
    code?: unknown;
  };
  const email = typeof body.email === 'string' ? normaliseEmail(body.email) : null;
  const code = typeof body.code === 'string' ? normaliseSignInCode(body.code) : null;
  if (!email || !code) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const db = getDb();
  if (!(await withinLimit(db, SIGN_IN_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const secret = process.env.SESSION_SECRET;
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });

  const check = await consumeCode(db, secret, email, code);
  if (!check.ok) {
    // One answer for every way of being wrong. Distinguishing "no code was
    // requested for this address" from "that code is wrong" would say whether
    // someone had asked, which is the same oracle the request endpoint
    // refuses to be.
    return NextResponse.json({ error: 'invalid_code' }, { status: 401 });
  }

  // Only now does an actor exist, if one did not — signing in *is* a
  // contribution of sorts, and it is the first point at which there is
  // something durable to attach.
  const actorId = await ensureActor(db);
  const result = await signIn(db, email, actorId);

  return NextResponse.json({
    // Withheld from a browser, which already holds the same value in an
    // httpOnly cookie — see `presentedActorCookie`.
    ...(browser ? {} : { actorToken: actorToken(result.actorId) }),
    email: result.email,
    // True when this device's previous identity was folded into an existing
    // one. The client uses it to say so rather than silently swapping.
    merged: result.merged,
  });
}
