/**
 * Resolve a link or a spoken code to an event — design §5.
 *
 * The web exchanges a link for a cookie by navigating to `/e/<token>`. Native
 * cannot navigate, and it also needs the other two doors: a QR scan yields the
 * same token, and someone across the room says "amber-fox".
 *
 * Returns only what a join screen needs. No photos, ever — search and joining
 * return a door, not a room.
 */

import { isWellFormedLinkToken, normaliseCode, schema } from '@parea/core';
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventByLinkToken } from '@/access';
import { getDb } from '@/db';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    linkToken?: unknown;
    code?: unknown;
  };

  const db = getDb();
  const actorId = await currentActorId();

  let event = null;
  let presentedCode: string | undefined;

  if (typeof body.linkToken === 'string') {
    // Accepts a full URL as well as a bare token, because people paste links.
    const token = body.linkToken.trim().split('/').pop() ?? '';
    if (isWellFormedLinkToken(token)) {
      event = await findEventByLinkToken(db, token);
    }
  } else if (typeof body.code === 'string') {
    const words = normaliseCode(body.code);
    if (words) {
      const [row] = await db
        .select({ event: schema.events })
        .from(schema.codes)
        .innerJoin(schema.events, eq(schema.codes.eventId, schema.events.id))
        .where(and(eq(schema.codes.words, words), isNull(schema.codes.releasedAt)))
        .limit(1);
      event = row?.event ?? null;
      presentedCode = words;
    }
  }

  // One answer for a bad token, an unknown code and a deleted event, so this
  // is not a way to test whether either exists.
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const decision = await decide(db, event, 'view', {
    actorId,
    linkToken: event.linkToken,
    code: presentedCode,
  });
  if (!decision.allow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({
    id: event.id,
    name: event.name,
    linkToken: event.linkToken,
    capEpoch: event.capEpoch,
    uploadsOpen: event.uploadsOpen,
  });
}
