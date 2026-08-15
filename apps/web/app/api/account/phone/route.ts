/**
 * The number people can find you by, and taking it back.
 *
 * PATCH sets it, DELETE removes it, and neither ever stores the number: the
 * hash and the last two digits are what land in the row. See `phone.ts` for
 * why, and for the one honest caveat — the digits are *sent*, they are just
 * not kept.
 *
 * An account, not a browser. A phone number attached to a guest actor would
 * be a number attached to whoever next picks up that laptop, and the whole
 * point of the column is that it names one person.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { getDb } from '@/db';
import { hashPhone, lastTwo, normalisePhone } from '@/phone';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

async function me() {
  const db = getDb();
  const actorId = await currentActorId();
  if (!actorId || !(await isSignedIn(db, actorId))) return null;
  return { db, actorId };
}

export async function PATCH(request: Request) {
  const session = await me();
  if (!session) return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { phone?: unknown };
  const e164 = typeof body.phone === 'string' ? normalisePhone(body.phone) : null;
  if (!e164) {
    // Named, because the rule is not obvious and "invalid" would send somebody
    // to re-type the same thing: it is the country code that is missing.
    return NextResponse.json({ error: 'needs_country_code' }, { status: 400 });
  }

  try {
    await session.db
      .update(schema.actors)
      .set({ phoneHash: hashPhone(e164), phoneLast2: lastTwo(e164) })
      .where(eq(schema.actors.id, session.actorId));
  } catch {
    /*
     * The unique index. Two accounts cannot hold one number, because "find by
     * number" would then have two answers and no way to choose — and because a
     * number somebody else has already claimed is usually a number they still
     * have.
     *
     * Caught rather than checked first: a select-then-update has a gap between
     * the two, and the index is the thing that actually decides.
     */
    return NextResponse.json({ error: 'already_claimed' }, { status: 409 });
  }

  return NextResponse.json({ last2: lastTwo(e164) });
}

export async function DELETE() {
  const session = await me();
  if (!session) return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });

  await session.db
    .update(schema.actors)
    .set({ phoneHash: null, phoneLast2: null })
    .where(eq(schema.actors.id, session.actorId));

  return new NextResponse(null, { status: 204 });
}
