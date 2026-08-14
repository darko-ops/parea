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

import { ACCOUNT_REQUIRED, LINK_OPEN, REQUEST_ACCESS, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { requesterFor } from '@/session';

export const runtime = 'nodejs';

/**
 * The three switches — docs/design.md §5.
 *
 * All default open and closing one is a host decision, never a default the
 * product imposes. Rotation is a separate endpoint because it is destructive
 * in a way a toggle is not.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    caption?: unknown;
    joinsOpen?: unknown;
    uploadsOpen?: unknown;
    accessPolicy?: unknown;
  };

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(id);
  try {
    await guard(db, event, 'administer', requester);
  } catch (err) {
    return toResponse(err);
  }

  const patch: {
    name?: string;
    caption?: string | null;
    joinsOpen?: boolean;
    uploadsOpen?: boolean;
    accessPolicy?: typeof LINK_OPEN | typeof ACCOUNT_REQUIRED | typeof REQUEST_ACCESS;
  } = {};

  /*
   * The name is the one field here that cannot be emptied. It is what an event
   * is called on a card, in a notification and in the thread, and "" in all of
   * those is a blank space nobody can point at.
   */
  if (typeof body.name === 'string') {
    const name = body.name.trim();
    if (!name || name.length > 120) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 400 });
    }
    patch.name = name;
  }

  // The caption can be cleared, and clearing it is `null` rather than `''` —
  // an empty string would render as a line of nothing under the name.
  if (typeof body.caption === 'string') {
    const caption = body.caption.trim();
    if (caption.length > 200) {
      return NextResponse.json({ error: 'invalid_caption' }, { status: 400 });
    }
    patch.caption = caption || null;
  }

  if (typeof body.joinsOpen === 'boolean') patch.joinsOpen = body.joinsOpen;
  if (typeof body.uploadsOpen === 'boolean') patch.uploadsOpen = body.uploadsOpen;

  /*
   * Who can see it, changed after the fact.
   *
   * It was write-once until now, which reads as a safety property and is not
   * one: the choice is made in the first thirty seconds of an album's life,
   * before anybody has been sent anything, and being unable to loosen it left
   * five albums here permanently making people ask to get in. Nothing about
   * the model needs it fixed — `authorize` reads the column on every request,
   * so a change takes effect at once in both directions.
   *
   * The list is checked against the three known values rather than passed
   * through: `authorize` denies any policy it does not recognise, so a typo
   * written here would lock everybody out of an album including its host, with
   * no way back because the only way back is this endpoint.
   *
   * Tightening does not evict anyone. Whoever is already a participant stays
   * one — `authorize` reads participation before the policy — so switching to
   * approval stops new people rather than removing the people already in. The
   * screen says so, because "private" sounds like it should mean the opposite.
   */
  if (typeof body.accessPolicy === 'string') {
    const known = [LINK_OPEN, ACCOUNT_REQUIRED, REQUEST_ACCESS] as const;
    const chosen = known.find((policy) => policy === body.accessPolicy);
    if (!chosen) {
      return NextResponse.json({ error: 'invalid_access_policy' }, { status: 400 });
    }
    patch.accessPolicy = chosen;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing_to_change' }, { status: 400 });
  }

  const [updated] = await db
    .update(schema.events)
    .set(patch)
    .where(eq(schema.events.id, event.id))
    .returning();

  return NextResponse.json({
    name: updated!.name,
    caption: updated!.caption,
    joinsOpen: updated!.joinsOpen,
    uploadsOpen: updated!.uploadsOpen,
    accessPolicy: updated!.accessPolicy,
  });
}

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
