/**
 * Putting somebody into an event, instead of sending them a link.
 *
 * The product's one invitation has always been the link: whoever holds it is
 * in. This is the second, and it is still narrower — only an event you
 * administer, only fifty at a time, and only people the search would show you.
 *
 * It began as friends-only. That is no longer the rule, because the Members
 * screen searches by handle and a host who can find somebody has to be able to
 * add them; the honest way to see it is that a host who wanted this could
 * always send the link, and this is the same act with the recipient's name on
 * it. What the friendship rule really bought was a consent gate, and what
 * replaces it is smaller: blocks. `findPeople` hides each of two people from
 * the other after a block, so nobody can be added by somebody they blocked —
 * and being added lands in Invites, which somebody can ignore, rather than
 * anywhere they have to look.
 *
 * The gate that remains is `administer`. This is a host's guest list, not a
 * way for anybody in an event to pull people into it.
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
import { invitable } from '@/friends';
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

  /*
   * Checked per person rather than trusted from the list the client sent.
   *
   * Two things are verified here and nowhere else: that the target is a real
   * account, and that neither of you has blocked the other. The second is the
   * whole of what protects somebody from being added by a person they have
   * cut off — the search already hides them from each other, but a search
   * result is a suggestion and this is the decision.
   */
  const invited: string[] = [];
  for (const target of asked) {
    if (target === actorId) continue;
    if (!(await invitable(db, actorId, target))) continue;
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
