/**
 * Create a group — docs/design.md §3.
 *
 * Made from an event rather than from nothing. "The same people keep doing
 * things together" is a thing you notice afterwards, so the flow is roll this
 * event into a group, not create an empty group and then fill it. The event's
 * existing participants are not auto-enrolled: membership is opt-in, and
 * conscripting everyone who once opened a link would make it the opposite.
 */

import { groupSlug, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, toResponse } from '@/access';
import { getDb } from '@/db';
import { addMember } from '@/groups';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    fromEventId?: unknown;
    findable?: unknown;
  };

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 });
  }
  if (typeof body.fromEventId !== 'string') {
    return NextResponse.json({ error: 'event_required' }, { status: 400 });
  }

  const db = getDb();
  const event = await findEventById(db, body.fromEventId);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (event.groupId) {
    return NextResponse.json({ error: 'already_grouped' }, { status: 409 });
  }

  const requester = await requesterFor(event.id);
  try {
    await guard(db, event, 'administer', requester);
  } catch (err) {
    return toResponse(err);
  }

  const actorId = (await currentActorId())!;

  const [group] = await db
    .insert(schema.groups)
    .values({
      name,
      slug: groupSlug(name),
      // Asked once, at creation, and defaulting closed. Clubs and teams say
      // yes; friend groups do not, and nobody chose to make their house a
      // public entity.
      findable: body.findable === true,
    })
    .returning();

  await addMember(db, group!.id, actorId, 'admin');

  // The event moves under the group, so its photos become part of a running
  // archive rather than another orphaned link.
  await db
    .update(schema.events)
    .set({
      groupId: group!.id,
      // Grouped events do not expire — the retention lever only applies to
      // one-offs (design §15).
      expiresAt: null,
    })
    .where(eq(schema.events.id, event.id));

  return NextResponse.json(
    { id: group!.id, name: group!.name, findable: group!.findable },
    { status: 201 },
  );
}
