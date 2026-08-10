/**
 * Mark an upload finished.
 *
 * In the built-out system (design §7.5) an R2 event notification drives a queue
 * and a container that computes the hash, strips GPS, and builds derivatives —
 * and *that* is what flips a photo to 'ready'. None of that exists yet, so this
 * endpoint stands in: it verifies the object actually landed by asking storage
 * for its size, and promotes the row.
 *
 * Two things this deliberately does NOT do, because doing them here would mean
 * reading the bytes through this process:
 *   - compute a content hash, so dedup does not work yet;
 *   - strip location metadata, so nothing uploaded via this path is safe to
 *     serve to anyone but the uploader.
 *
 * Both land with the deriver. `status` stays the gate: only 'ready' photos are
 * listed, and nothing reaches 'ready' without going through here.
 */

import { schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { currentActorId, requesterFor } from '@/session';
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
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const [photo] = await db
    .select()
    .from(schema.photos)
    .where(and(eq(schema.photos.id, id), eq(schema.photos.uploaderId, actorId)))
    .limit(1);

  // Scoped to the uploader: completing someone else's upload is not a thing.
  if (!photo) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const event = await findEventById(db, photo.eventId);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(event.id, {
    linkToken: typeof body.linkToken === 'string' ? body.linkToken : undefined,
    code: typeof body.code === 'string' ? body.code : undefined,
  });

  try {
    await guard(db, event, 'contribute', requester);
  } catch (err) {
    return toResponse(err);
  }

  const head = await getStorage().head(photo.storageKey);
  if (!head) {
    await db
      .update(schema.photos)
      .set({ status: 'failed' })
      .where(eq(schema.photos.id, photo.id));
    return NextResponse.json({ error: 'object_missing' }, { status: 409 });
  }

  await db
    .update(schema.photos)
    .set({ status: 'ready', byteSize: head.size })
    .where(eq(schema.photos.id, photo.id));

  await db
    .update(schema.events)
    .set({ lastActiveAt: new Date() })
    .where(eq(schema.events.id, event.id));

  return NextResponse.json({ id: photo.id, status: 'ready', size: head.size });
}
