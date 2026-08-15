/**
 * Dismissing a line on Activity.
 *
 * One verb and no undo. The Activity page is a feed of things that have
 * already happened, and hiding one says "I have read this and I am finished
 * with it" — a screen listing what somebody has dismissed would be a feature
 * about the feature.
 *
 * The key is the feed's own id for the line, which is not a foreign key and
 * cannot be: the line is derived from four tables at read time and has no row
 * of its own. So nothing here can check that the key names something real —
 * and it does not need to. A key that matches nothing hides nothing, and the
 * worst an arbitrary string can do is occupy a row belonging to the person who
 * sent it, bounded by the length check in the column and by the account this
 * writes against.
 */

import { schema } from '@parea/core';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

/** Long enough for `reaction:<uuid>:<emoji>:<iso>`, short enough to be a key. */
const MAX_KEY = 200;

export async function POST(request: Request) {
  const actorId = await currentActorId();
  // Nothing to hide for a browser with no identity, and nothing to say about
  // it either: the page it would be hiding from is empty for them.
  if (!actorId) return new NextResponse(null, { status: 204 });

  const body = (await request.json().catch(() => ({}))) as { key?: unknown };
  const key = typeof body.key === 'string' ? body.key.trim() : '';
  if (!key || key.length > MAX_KEY) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // Hiding twice is hiding once. Two tabs, or a double tap on a slow
  // connection, must not be an error in front of somebody.
  await getDb()
    .insert(schema.hiddenActivity)
    .values({ actorId, itemKey: key })
    .onConflictDoNothing();

  return new NextResponse(null, { status: 204 });
}
