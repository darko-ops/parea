/**
 * Keeping a photograph, and letting it go.
 *
 * A shortlist somebody makes of an album of two hundred: the pictures they
 * would actually come back for. It is theirs and nobody else's — see
 * `photo_favourite`, which is a table of its own for exactly that reason —
 * so nothing here is counted, listed, or reported to the room. The only
 * answer this endpoint gives is the state of one row for one person.
 *
 * ## Why `view` and not `contribute`
 *
 * Reacting is addressed to everybody in the album and needs the right to
 * contribute to it. Keeping is addressed to nobody. Somebody who may look at
 * an album may keep what they saw in it, and requiring more would mean a
 * reader could not shortlist an album they are allowed to read.
 *
 * ## Why an account and not an actor
 *
 * A guest actor is a credential in one phone's keychain. A shortlist that
 * cannot survive a new phone is a shortlist that quietly empties, which is
 * worse than not offering one — so this asks for the thing that persists.
 */

import { schema, visiblePhotos } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { viewerContext } from '@/moderation';
import { currentAccountActorId, currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

/**
 * The photograph, if this viewer may see it at all, and the album it is in.
 *
 * Two reads rather than one, for the reason the reactions route gives:
 * `visiblePhotos` is a predicate about an event and takes its id, so the
 * first read establishes which event to ask about and nothing else.
 */
async function reachable(id: string) {
  const db = getDb();
  const [row] = await db
    .select({ eventId: schema.photos.eventId })
    .from(schema.photos)
    .where(eq(schema.photos.id, id))
    .limit(1);
  if (!row) return null;

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
  if (!photo) return null;

  const event = await findEventById(db, photo.eventId);
  return event ? { db, photo, event } : null;
}

async function allowed(id: string) {
  const found = await reachable(id);
  if (!found) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };

  const requester = await requesterFor(found.event.id);
  try {
    await guard(found.db, found.event, 'view', requester);
  } catch (err) {
    return { error: toResponse(err) };
  }

  const actorId = await currentAccountActorId();
  if (!actorId) {
    return { error: NextResponse.json({ error: 'sign_in_required' }, { status: 401 }) };
  }
  return { db: found.db, photoId: found.photo.id, actorId };
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await allowed(id);
  if ('error' in ok) return ok.error;

  /*
   * Idempotent, because the client is a toggle and a toggle retries.
   *
   * Pressing the star twice quickly, or once on a train, must not turn into
   * "already kept" — there is one row and its existence is the whole state.
   */
  await ok.db
    .insert(schema.photoFavourites)
    .values({ photoId: ok.photoId, actorId: ok.actorId })
    .onConflictDoNothing();

  return NextResponse.json({ favourite: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await allowed(id);
  if ('error' in ok) return ok.error;

  await ok.db
    .delete(schema.photoFavourites)
    .where(
      and(
        eq(schema.photoFavourites.photoId, ok.photoId),
        eq(schema.photoFavourites.actorId, ok.actorId),
      ),
    );

  return NextResponse.json({ favourite: false });
}
