/**
 * Delete an event — docs/design.md §13.
 *
 * The blunt instrument, and the one that has to work: whoever created a thing
 * must be able to make it stop existing. Soft delete, so the photos are gone
 * from every view immediately while remaining recoverable for a grace window
 * and available to an abuse investigation.
 *
 * `authorize` already refuses everything on a deleted event, including for the
 * creator, so no listing path needs a special case.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function DELETE(
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

  const now = new Date();
  await db
    .update(schema.events)
    .set({ deletedAt: now })
    .where(eq(schema.events.id, event.id));

  // Photos are tombstoned too rather than relying on the event's state alone,
  // so the purge job can find objects to delete without joining every table.
  await db
    .update(schema.photos)
    .set({ deletedAt: now })
    .where(eq(schema.photos.eventId, event.id));

  // Free the spoken code immediately — no reason to hold it for a dead event.
  await db
    .update(schema.codes)
    .set({ eventId: null, releasedAt: now })
    .where(eq(schema.codes.eventId, event.id));

  return NextResponse.json({ deleted: true });
}
