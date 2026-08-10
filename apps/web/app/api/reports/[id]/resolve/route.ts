/**
 * The host answering a removal request — docs/design.md §13.
 *
 * Two outcomes. `remove` takes the photo down for good; `decline` clears the
 * request and un-hides the photo if the 48-hour deadline had already passed.
 * That second half is why hiding and deleting are separate states: a host who
 * was on holiday can still say no, and the photo comes back.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action === 'remove' ? 'remove' : body.action === 'decline' ? 'decline' : null;
  if (!action) return NextResponse.json({ error: 'invalid_action' }, { status: 400 });

  const db = getDb();
  const [found] = await db
    .select({ report: schema.reports, photo: schema.photos })
    .from(schema.reports)
    .innerJoin(schema.photos, eq(schema.reports.photoId, schema.photos.id))
    .where(eq(schema.reports.id, id))
    .limit(1);

  if (!found) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const event = await findEventById(db, found.photo.eventId);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(event.id);
  try {
    await guard(db, event, 'administer', requester);
  } catch (err) {
    return toResponse(err);
  }

  const actorId = await currentActorId();
  const now = new Date();

  if (action === 'remove') {
    await db
      .update(schema.photos)
      .set({ status: 'removed', deletedAt: now })
      .where(eq(schema.photos.id, found.photo.id));
  } else {
    // Declining also lifts an auto-hide that already took effect.
    await db
      .update(schema.photos)
      .set({ hiddenAt: null })
      .where(eq(schema.photos.id, found.photo.id));
  }

  await db
    .update(schema.reports)
    .set({
      status: action === 'remove' ? 'actioned' : 'declined',
      resolvedAt: now,
      resolvedBy: actorId,
    })
    .where(eq(schema.reports.id, id));

  return NextResponse.json({ resolved: action });
}
