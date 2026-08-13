/**
 * Putting a friend into an event, instead of sending them a link.
 *
 * The product's one invitation has always been the link: whoever holds it is
 * in. This is the second, and it is deliberately the narrower of the two — you
 * can only do it to people who have already agreed to be your friend, and only
 * to an event you administer.
 *
 * Being invited *is* being a participant. There is no pending state, because
 * there is nothing left to decide: they said yes to you when they accepted the
 * friend request, and a second acceptance for each event would be a queue
 * nobody asked for. It lands under their Invites and counts on the badge, and
 * for a private event it is the same row the host would have written by
 * approving them.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventById, recordParticipant } from '@/access';
import { getDb } from '@/db';
import { areFriends } from '@/friends';
import { notifyEventInvite } from '@/notify';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

/** How many people one request may add. A guest list, not a broadcast. */
const MAX_PER_REQUEST = 50;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const actorId = await currentActorId();
  const decision = await decide(db, event, 'administer', await requesterFor(id));
  if (!decision.allow || !actorId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { actorIds?: unknown };
  const asked = Array.isArray(body.actorIds)
    ? body.actorIds.filter((a): a is string => typeof a === 'string')
    : [];
  if (asked.length === 0 || asked.length > MAX_PER_REQUEST) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // Friendship is checked per person rather than trusted from the list the
  // client sent. The list is the client's idea of who your friends are, and
  // this is the only place that decides whether adding somebody is allowed.
  const invited: string[] = [];
  for (const target of asked) {
    if (target === actorId) continue;
    if (!(await areFriends(db, actorId, target))) continue;
    await recordParticipant(db, id, target);
    invited.push(target);
  }

  if (invited.length > 0) {
    const [host] = await db
      .select({ displayName: schema.actors.displayName, handle: schema.actors.handle })
      .from(schema.actors)
      .where(eq(schema.actors.id, actorId))
      .limit(1);

    await notifyEventInvite(db, {
      actorIds: invited,
      eventId: id,
      eventName: event.name,
      who: host?.displayName ?? (host?.handle ? `@${host.handle}` : 'Someone'),
    });
  }

  // Says how many, not which: the caller already knows who it asked for, and a
  // per-person answer would report whether each one is your friend, which is a
  // question this route should not answer even to you in that shape.
  return NextResponse.json({ invited: invited.length });
}

/** Who is already in, so the picker can leave them out. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const event = await findEventById(db, id);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const decision = await decide(db, event, 'administer', await requesterFor(id));
  if (!decision.allow) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const rows = await db
    .select({ actorId: schema.eventParticipants.actorId })
    .from(schema.eventParticipants)
    .where(eq(schema.eventParticipants.eventId, id));

  return NextResponse.json({ already: rows.map((r) => r.actorId) });
}
