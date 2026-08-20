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
import { addMember, groupsFor, myGroups } from '@/groups';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

/**
 * The groups this actor is in.
 *
 * Answers an empty list rather than 403 for someone with no actor yet: having
 * no groups and not existing look the same from here, and they should — the
 * app asks this on launch, before anyone has contributed anything.
 *
 * ## Two shapes, and why the cheap one is the default
 *
 * `?detail=1` adds what a group screen needs to tell two rooms apart: how many
 * albums are in it, how many people, and when anything last happened. Those
 * are three aggregates per group, and the caller that asks this question most
 * often is the native client at launch — before anybody has opened a group
 * screen, and possibly before they have any groups at all.
 *
 * So the default stays a name and a role, and the screen that draws the fuller
 * line asks for it when somebody opens it. A flag rather than a second route
 * because it is the same question about the same rows; a second route would be
 * two places for the membership rule to be written.
 */
export async function GET(request: Request) {
  const db = getDb();
  const actorId = await currentActorId();
  const detail = new URL(request.url).searchParams.get('detail') === '1';

  return NextResponse.json({
    groups: detail ? await myGroups(db, actorId) : await groupsFor(db, actorId),
  });
}

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
