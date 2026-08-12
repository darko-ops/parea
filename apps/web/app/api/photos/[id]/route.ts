/**
 * Remove your own upload — docs/design.md §13.
 *
 * Actor-scoped and immediate: no review, no host approval, no explanation
 * asked for. Someone taking their own photo back down is not a moderation
 * event, and putting any friction in front of it would make contributing feel
 * irreversible — which is exactly the fear that stops people uploading.
 *
 * Soft delete. The object is purged on a delay by the jobs runner, so an
 * accidental removal is recoverable for a while and an abuse investigation
 * still has something to look at.
 */

import { recordModeration, REASON, schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const db = getDb();
  const [existing] = await db
    .select({ eventId: schema.photos.eventId })
    .from(schema.photos)
    .where(and(eq(schema.photos.id, id), eq(schema.photos.uploaderId, actorId)))
    .limit(1);

  const updated = await db
    .update(schema.photos)
    .set({ status: 'removed', deletedAt: new Date() })
    .where(
      and(
        eq(schema.photos.id, id),
        // Scoped to the uploader in the WHERE clause rather than checked
        // first: there is no window in which another actor's photo could be
        // removed by a racing request.
        eq(schema.photos.uploaderId, actorId),
      ),
    )
    .returning({ id: schema.photos.id });

  if (updated.length > 0 && existing) {
    await recordModeration(db, {
      photoId: id,
      eventId: existing.eventId,
      action: 'removed',
      actorId,
      reason: REASON.uploaderRemoved,
    });
  }

  // Same answer whether the photo does not exist or is not yours.
  if (updated.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ removed: true });
}
