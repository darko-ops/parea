/**
 * One of your drafts: try it again, or let it go. See `@/drafts`.
 *
 * POST tries again from what the server holds. A file that is here — one
 * processing failed on, or one that arrived without the upload ever being
 * confirmed — is sent back to the deriver. One that is not answers
 * `needs_file`, and the client asks for the photograph again; choosing it
 * completes this draft through the upload route's `claimDrafts`.
 *
 * DELETE discards it, file and all. Only a draft: a photo that is live is
 * deleted the ordinary way, and nothing here reaches a quarantined one.
 *
 * Both scoped to the uploader in the query, and both the same `not_found`
 * for a photo that is somebody else's or does not exist.
 */

import { schema } from '@parea/core';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { draftState } from '@/drafts';
import { publishDerive } from '@/queue';
import { currentActorId, requesterFor } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

async function myDraft(id: string, actorId: string) {
  const [photo] = await getDb()
    .select()
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.id, id),
        eq(schema.photos.uploaderId, actorId),
        inArray(schema.photos.status, ['pending', 'failed']),
        isNull(schema.photos.deletedAt),
        isNull(schema.photos.hiddenAt),
      ),
    )
    .limit(1);
  return photo ?? null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { linkToken?: unknown; code?: unknown };
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const photo = await myDraft(id, actorId);
  if (!photo) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const db = getDb();
  const event = await findEventById(db, photo.eventId);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Still allowed to add to it: a roll can close, or its link change, between
  // the first attempt and this one.
  try {
    const requester = await requesterFor(event.id, {
      linkToken: typeof body.linkToken === 'string' ? body.linkToken : undefined,
      code: typeof body.code === 'string' ? body.code : undefined,
    });
    await guard(db, event, 'upload', requester);
  } catch (err) {
    return toResponse(err);
  }

  if (draftState(photo) === 'sending') {
    return NextResponse.json({ id: photo.id, state: 'sending' });
  }

  const head = await getStorage().head(photo.storageKey);
  if (!head) {
    // Nothing here to try again with. Said on the row too, so the list agrees.
    await db
      .update(schema.photos)
      .set({ status: 'failed', bytesAt: null, failedAt: photo.failedAt ?? new Date(), failureReason: photo.failureReason ?? 'never_arrived' })
      .where(eq(schema.photos.id, photo.id));
    return NextResponse.json({ error: 'needs_file' }, { status: 409 });
  }

  await db
    .update(schema.photos)
    .set({
      status: 'pending',
      byteSize: head.size,
      // Now, so the hourly requeue treats it as just arrived if this delivery goes astray.
      bytesAt: new Date(),
      failedAt: null,
      failureReason: null,
    })
    .where(eq(schema.photos.id, photo.id));

  try {
    await publishDerive(photo.id, `retry-${Date.now()}`);
  } catch (err) {
    console.error(`could not queue ${photo.id} for deriving:`, err);
    return NextResponse.json({ error: 'queue_unavailable' }, { status: 503 });
  }
  return NextResponse.json({ id: photo.id, state: 'processing' });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const photo = await myDraft(id, actorId);
  if (!photo) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Tombstoned, as any removal is; the purge takes the row and anything left
  // in storage. The file goes now if it is here, since nothing was ever shown
  // from it and it may carry the camera's location.
  await getStorage().delete(photo.storageKey).catch(() => {});
  await getDb()
    .update(schema.photos)
    .set({ status: 'removed', deletedAt: new Date(), bytesAt: null })
    .where(and(eq(schema.photos.id, photo.id), eq(schema.photos.uploaderId, actorId)));
  return NextResponse.json({ removed: true });
}
