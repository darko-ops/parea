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

import { decide, findEventByLinkToken, recordParticipant } from '@/access';
import { getDb } from '@/db';
import { clientOf, observe } from '@/observe';
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

  /*
   * The same thing `/e/<token>` records, for the door native comes through.
   *
   * Native does not need this to see the event — it keeps the link token and
   * presents it on every call, so `viaLink` carries it — which is why the
   * missing record here failed differently from the web's and not at all
   * until a host reached for a switch. `joins_open` off means "new people can
   * no longer join; everyone already in keeps access", and the second half of
   * that sentence is enforced entirely by this table. Someone who joined on
   * their phone, looked, and did not upload was never written down as being
   * in, so closing joins evicted them from an event they were already at.
   *
   * Below the decision for the same reason as `/e/`: `joins_closed` is refused
   * above, so this cannot become the way in for the people that switch was
   * thrown against.
   *
   * Only for an actor that already exists. `ensureActor` would mint one and
   * set a cookie, and `/api/session` is explicit that native must not carry a
   * cookie and a keychain token for the same actor — and a row naming an actor
   * this client cannot prove it is would record nobody.
   */
  if (actorId) await recordParticipant(db, event.id, actorId);

  // §18's install-conversion question: which client people actually arrive on,
  // and therefore whether the install wall is costing contribution. Recorded
  // after the decision, so a refused join is not counted as one.
  await observe(db, {
    kind: 'joined',
    eventId: event.id,
    actorId,
    client: clientOf(request),
  });

  return NextResponse.json({
    id: event.id,
    name: event.name,
    linkToken: event.linkToken,
    capEpoch: event.capEpoch,
    uploadsOpen: event.uploadsOpen,
    // Drives auto-selection on the native client (design §7.3). Null is a
    // normal answer — the client falls back rather than guessing a window.
    startsAt: event.startsAt?.toISOString() ?? null,
    endsAt: event.endsAt?.toISOString() ?? null,
  });
}
