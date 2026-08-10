/**
 * Rotate an event's link — docs/design.md §5.
 *
 * The "a stranger got the link" button, and the only control that actually
 * revokes. Closing uploads stops contribution but leaves the photos readable
 * to whoever already has the URL; rotation replaces the credential.
 *
 * Four things move together, because leaving any one of them would leave a way
 * back in:
 *
 *   1. a new `link_token` — the old URL stops resolving;
 *   2. `cap_epoch` is bumped — every capability cookie already handed out goes
 *      stale, so a browser that visited the old link cannot keep using it;
 *   3. the spoken code is released and replaced — a code is a second door, and
 *      rotating the link while `amber-fox` still worked would be theatre;
 *   4. an epoch marker is written to storage, which is what lets the image
 *      Worker reject signed image URLs minted before the rotation. Without it
 *      those stay valid until they expire.
 *
 * The cost, and it is real: everyone loses access until they get the new link.
 * Group members are the exception — their membership is not link-derived — so
 * a grouped event survives rotation for the people in the group. The response
 * says how many participants will need re-inviting so the UI can warn before
 * doing it.
 */

import { newLinkToken, schema } from '@parea/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { epochMarkerKey } from '@/images';
import { grantCapability, requesterFor } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    linkToken?: unknown;
    code?: unknown;
  };

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(id, {
    linkToken: typeof body.linkToken === 'string' ? body.linkToken : undefined,
    code: typeof body.code === 'string' ? body.code : undefined,
  });

  try {
    // Administration is never granted by holding the link — otherwise the
    // stranger you are locking out could lock you out first.
    await guard(db, event, 'administer', requester);
  } catch (err) {
    return toResponse(err);
  }

  const [participants] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.eventParticipants)
    .where(eq(schema.eventParticipants.eventId, event.id));

  const nextEpoch = event.capEpoch + 1;
  const [rotated] = await db
    .update(schema.events)
    .set({ linkToken: newLinkToken(), capEpoch: nextEpoch })
    .where(eq(schema.events.id, event.id))
    .returning();

  const code = await rotateCode(db, event.id);

  // Written before the response, so no reply promising revocation can be sent
  // while old image URLs still work. A failure here must fail the request.
  await getStorage().putSmall(
    epochMarkerKey(event.id),
    new TextEncoder().encode(String(nextEpoch)),
    'text/plain',
  );

  // The caller just proved they administer this event, so re-issue their own
  // capability rather than locking out the person who pressed the button.
  await grantCapability(event.id, nextEpoch);

  return NextResponse.json({
    linkToken: rotated!.linkToken,
    url: `/e/${rotated!.linkToken}`,
    capEpoch: nextEpoch,
    code,
    /** Everyone here needs the new link before they can get back in. */
    participantsLockedOut: participants?.count ?? 0,
  });
}

/**
 * Release the old code back to the pool and claim a fresh one.
 *
 * Only if the event had a code: rotation should not hand out a spoken code to
 * an event that never had one. Returns null when the pool is exhausted, which
 * is survivable — the link still works and the code is a convenience.
 */
async function rotateCode(
  db: ReturnType<typeof getDb>,
  eventId: string,
): Promise<string | null> {
  const [current] = await db
    .select()
    .from(schema.codes)
    .where(eq(schema.codes.eventId, eventId))
    .limit(1);

  if (!current) return null;

  await db
    .update(schema.codes)
    .set({ eventId: null, releasedAt: new Date() })
    .where(eq(schema.codes.id, current.id));

  // Raw SQL because the claim must be atomic: SELECT ... FOR UPDATE SKIP
  // LOCKED against the free pool, so two concurrent rotations take different
  // codes rather than one failing on a unique violation.
  const claimed = await db.execute<{ words: string }>(sql`
    update "code" set event_id = ${eventId}, claimed_at = now(), released_at = null
    where id = (
      select id from "code"
      where event_id is null and id <> ${current.id}
      order by random() limit 1 for update skip locked
    )
    returning words
  `);

  return claimed[0]?.words ?? null;
}

/** Current link and code, for a host settings screen. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(id);
  try {
    await guard(db, event, 'administer', requester);
  } catch (err) {
    return toResponse(err);
  }

  const [code] = await db
    .select({ words: schema.codes.words })
    .from(schema.codes)
    .where(and(eq(schema.codes.eventId, event.id), isNull(schema.codes.releasedAt)))
    .limit(1);

  return NextResponse.json({
    url: `/e/${event.linkToken}`,
    capEpoch: event.capEpoch,
    code: code?.words ?? null,
    joinsOpen: event.joinsOpen,
    uploadsOpen: event.uploadsOpen,
  });
}
