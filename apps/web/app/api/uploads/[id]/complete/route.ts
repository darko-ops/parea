/**
 * Say that the bytes arrived. Not that the photo is ready.
 *
 * This endpoint used to promote the row to 'ready' itself, as a stand-in for a
 * deriver that did not exist yet. It does now — services/deriver claims
 * 'pending' rows, computes the hash, strips location metadata, builds the
 * derivatives and scans for known material, and only then promotes. So the
 * stand-in has to go, because the two together were worse than either alone:
 * `complete` won the race on every single upload, the deriver never saw a row,
 * and photos went live unprocessed.
 *
 * That was not theoretical. On the first real deployment every uploaded photo
 * reached 'ready' with a null content hash, no derivatives, and — checked with
 * exiftool against the bytes R2 was serving — its original GPS coordinates
 * still in place. With a scanner configured it would have skipped that too,
 * which is the same hole wearing a much worse hat.
 *
 * What is left here is the one thing the deriver cannot do for itself: confirm
 * the client's PUT actually landed. A presigned upload that silently failed
 * leaves a 'pending' row pointing at nothing, and the deriver would rediscover
 * that on its own — but slower, and after retries that cannot succeed.
 *
 * That confirmation is also what releases the photo to the deriver at all.
 * `bytesAt` is written here and nowhere else, and the deriver will not claim a
 * row without it — because a row is 'pending' from the instant it is
 * presigned, seconds before the first byte is sent.
 *
 * `status` is still the gate: only 'ready' photos are listed, and now nothing
 * reaches 'ready' without going through the deriver.
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

  // The status stays 'pending' so the deriver has something to claim, but
  // `bytesAt` is what actually lets it claim this row — the deriver waits for
  // this timestamp before looking in storage. Without it a row is claimable
  // from the moment it was presigned, so the deriver reads an object that is
  // still being uploaded, finds nothing, and marks the photo `failed` for
  // good. See `pendingPhotoIds`.
  //
  // byteSize is corrected at the same time, because the number recorded at
  // presign came from the client and is a claim, not a fact.
  await db
    .update(schema.photos)
    .set({ byteSize: head.size, bytesAt: new Date() })
    .where(eq(schema.photos.id, photo.id));

  await db
    .update(schema.events)
    .set({ lastActiveAt: new Date() })
    .where(eq(schema.events.id, event.id));

  return NextResponse.json({ id: photo.id, status: 'pending', size: head.size });
}
