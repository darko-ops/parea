/**
 * Reacting to a photograph.
 *
 * One verb, because the control is one pill: POST toggles and the response
 * says which way it went. Separate add and remove routes would mean the client
 * has to know which state it is in before it can act, and with two screens
 * open on the same picture it does not.
 *
 * Gated on `contribute`, exactly as reacting to a message is. A reaction is a
 * mark somebody leaves on an event — small, but it is saying something, and
 * the rule for saying things here is the rule for adding photographs.
 *
 * The photograph is found through `visiblePhotos` rather than by id alone.
 * That predicate is what answers for removed, hidden and blocked, and without
 * it this route would be a way to react to — and so confirm the existence of —
 * a photograph that has been taken down.
 */

import { schema, visiblePhotos } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { viewerContext } from '@/moderation';
import { togglePhotoReaction } from '@/photoReactions';
import { LIKE } from '@/reactions';
import { currentAccountActorId, currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  /*
   * Which event, then whether this viewer may see the photograph in it.
   *
   * Two reads rather than one, because `visiblePhotos` is a predicate about an
   * event and takes its id — it cannot be handed the column. The first read
   * finds out which event to ask about and establishes nothing else; every
   * question that matters is in the second.
   */
  const [row] = await db
    .select({ eventId: schema.photos.eventId })
    .from(schema.photos)
    .where(eq(schema.photos.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const [photo] = await db
    .select({ id: schema.photos.id, eventId: schema.photos.eventId })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.id, id),
        // Removed, hidden, blocked — the three states an id alone cannot see.
        visiblePhotos(row.eventId, await viewerContext(db, await currentActorId())),
      ),
    )
    .limit(1);
  if (!photo) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const event = await findEventById(db, photo.eventId);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(event.id);
  try {
    await guard(db, event, 'contribute', requester);
  } catch (err) {
    return toResponse(err);
  }

  // Same rule as posting: a reaction is counted and shown to everybody in the
  // event. `currentActorId` would answer for a guest.
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  // A like, whatever was asked for. See `LIKE`.
  const emoji = LIKE;
  const state = await togglePhotoReaction(db, photo.id, actorId, emoji);
  return NextResponse.json({ state });
}
