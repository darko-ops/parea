/**
 * Who is in a photograph — adding a name, and taking one off.
 *
 * Two verbs with two different answers to "who may", which is why the checks
 * are not shared:
 *
 * **POST — only the uploader.** Whoever took the picture is the only person in
 * a position to say who is in it. Not the host, and not everybody who can open
 * the album: a tag is a claim about somebody's face, and a claim strangers can
 * attach is a different feature with a different name.
 *
 * **DELETE — the uploader, or the person tagged.** Somebody who finds
 * themselves named in a photograph does not have to ask permission to stop
 * being named in it, and making them ask the uploader would be the product
 * taking a side in the one disagreement this feature can cause.
 *
 * The photograph is reached through `guard`, so the ordinary rule holds: if you
 * cannot see the event you cannot do anything to its photographs, whichever of
 * the two you are.
 */

import { schema, visiblePhotos } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { membersOf } from '@/members';
import { viewerContext } from '@/moderation';
import { tagPhoto, untagPhoto } from '@/photoTags';
import { currentAccountActorId, currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

/**
 * The photograph, if this viewer may see it at all, and the event it is in.
 *
 * The same two reads the reactions route makes and for the same reason:
 * `visiblePhotos` is a predicate about an event and takes its id, so the first
 * read finds out which event to ask about and establishes nothing else. Every
 * question that matters is in the second.
 */
async function reach(db: ReturnType<typeof getDb>, id: string) {
  const [row] = await db
    .select({ eventId: schema.photos.eventId })
    .from(schema.photos)
    .where(eq(schema.photos.id, id))
    .limit(1);
  if (!row) return null;

  const [photo] = await db
    .select({ id: schema.photos.id, uploaderId: schema.photos.uploaderId })
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

  const event = await findEventById(db, row.eventId);
  return event ? { photo, event } : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const found = await reach(db, id);
  if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    await guard(db, found.event, 'view', await requesterFor(found.event.id));
  } catch (err) {
    return toResponse(err);
  }

  // An account, not a device. A tag is attributed — `taggedBy` is stored so the
  // person named can find out who said it — and a guest has no name to
  // attribute it to.
  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  if (found.photo.uploaderId !== actorId) {
    return NextResponse.json({ error: 'not_yours' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { actorId?: unknown };
  const target = typeof body.actorId === 'string' ? body.actorId : null;
  if (!target) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  /*
   * Only somebody already in the event.
   *
   * Tagging must not be a way to point at a person who cannot open the album
   * and therefore cannot object to being pointed at. Checked here rather than
   * trusted from the client, because the client's picker is a convenience and
   * this is the rule.
   */
  const members = await membersOf(db, found.event.id, found.event.createdBy);
  if (!members.some((member) => member.actorId === target)) {
    return NextResponse.json({ error: 'not_in_event' }, { status: 403 });
  }

  await tagPhoto(db, found.photo.id, target, actorId);
  return NextResponse.json({ tagged: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const found = await reach(db, id);
  if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    await guard(db, found.event, 'view', await requesterFor(found.event.id));
  } catch (err) {
    return toResponse(err);
  }

  const actorId = await currentAccountActorId();
  if (!actorId) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { actorId?: unknown };
  const target = typeof body.actorId === 'string' ? body.actorId : null;
  if (!target) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  // The uploader, or the person the tag is about. Nobody else, including the
  // host — a tag is not the album's to curate.
  if (found.photo.uploaderId !== actorId && target !== actorId) {
    return NextResponse.json({ error: 'not_yours' }, { status: 403 });
  }

  await untagPhoto(db, found.photo.id, target);
  return NextResponse.json({ tagged: false });
}
