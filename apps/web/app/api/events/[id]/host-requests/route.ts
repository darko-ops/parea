/**
 * Asking to be one of the people who may add photographs, and the answer.
 *
 * The companion to `access-requests`, and shaped like it on purpose — one row
 * per person per album, a declined row kept rather than deleted, and nothing
 * here read by `authorize`. Approving writes `host` into
 * `event_participant.role`, and that column is the grant.
 *
 * ## Why it is a second queue rather than a `kind` on the first
 *
 * They are asked by different people and answered with different information.
 * The access queue is strangers at the door of a private album, and the
 * question is "do I know this person". This one is people already inside, who
 * the host can see in the Members tab and whose photographs — if they have
 * added any elsewhere — the host has already seen. A host reading a list wants
 * one kind of question in it.
 *
 * ## Why there is no push for it
 *
 * The three notifications the privacy policy enumerates are for things nothing
 * else would tell you, and this is not one of them: it is somebody already in
 * the album asking for a little more, and it shows up on the badge over the
 * album's own `⋯` the next time they open it. Interrupting somebody's evening
 * for it would be spending the notification budget on the least urgent thing
 * in the product.
 */

import { CONTRIBUTE_HOST, schema } from '@parea/core';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventById, isSignedIn } from '@/access';
import { getDb } from '@/db';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

/**
 * The queue, for whoever administers the album.
 *
 * Guarded by `administer`, which no link and no code can grant — so this
 * answers 404 to everybody else, including the people waiting in it.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return notFound();

  const decision = await decide(db, event, 'administer', await requesterFor(id));
  if (!decision.allow) return notFound();

  const requests = await db
    .select({
      id: schema.eventHostRequests.id,
      actorId: schema.eventHostRequests.actorId,
      createdAt: schema.eventHostRequests.createdAt,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
    })
    .from(schema.eventHostRequests)
    .innerJoin(schema.actors, eq(schema.eventHostRequests.actorId, schema.actors.id))
    .where(
      and(
        eq(schema.eventHostRequests.eventId, id),
        eq(schema.eventHostRequests.status, 'open'),
      ),
    )
    .orderBy(asc(schema.eventHostRequests.createdAt));

  return NextResponse.json({ requests });
}

/**
 * Asking.
 *
 * Three gates, and each is the answer to a different way of getting this
 * wrong:
 *
 *   - `contribute`, so only somebody who is genuinely in the album can ask.
 *     It is the capability that already means "entitled to take part", and it
 *     is what a message goes through — a stranger with a guessed id gets the
 *     404 a nonexistent album gets.
 *   - signed in, because the host is being asked about a person and a request
 *     from an actor with no account names nobody.
 *   - the album is actually set to `host`. On an `everyone` album they can
 *     already add and the request would be a queue entry for a permission
 *     nobody needs; on `creator` the whole point of the setting is that there
 *     is no set to join, and offering a way to ask would make "Only me" a
 *     thing people are asked to defend.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return notFound();

  const requester = await requesterFor(id);
  const decision = await decide(db, event, 'contribute', requester);
  if (!decision.allow) return notFound();

  const actorId = requester.actorId;
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }

  if (event.contributePolicy !== CONTRIBUTE_HOST) {
    return NextResponse.json({ error: 'not_asking' }, { status: 409 });
  }

  // Already one of them — by the column, or by having made the album. Nothing
  // to ask for, and a queue entry from somebody who can already add is a
  // question the host cannot make sense of.
  const [participant] = await db
    .select({ role: schema.eventParticipants.role })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, id),
        eq(schema.eventParticipants.actorId, actorId),
      ),
    )
    .limit(1);
  if (actorId === event.createdBy || participant?.role === 'host') {
    return NextResponse.json({ status: 'approved' });
  }

  const [existing] = await db
    .select({ status: schema.eventHostRequests.status })
    .from(schema.eventHostRequests)
    .where(
      and(
        eq(schema.eventHostRequests.eventId, id),
        eq(schema.eventHostRequests.actorId, actorId),
      ),
    )
    .limit(1);

  // A declined row stays declined. Letting a second POST reopen it would make
  // "no" a thing the host has to keep saying, and the button that sends this
  // is one tap.
  if (existing) return NextResponse.json({ status: existing.status });

  await db
    .insert(schema.eventHostRequests)
    .values({ eventId: id, actorId })
    .onConflictDoNothing();

  return NextResponse.json({ status: 'open' }, { status: 201 });
}

/** The answer. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    requestId?: unknown;
    action?: unknown;
  };
  const action =
    body.action === 'approve' ? 'approve' : body.action === 'decline' ? 'decline' : null;
  if (!action || typeof body.requestId !== 'string') {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const db = getDb();
  const event = await findEventById(db, id);
  if (!event) return notFound();

  const actorId = await currentActorId();
  const decision = await decide(db, event, 'administer', await requesterFor(id));
  if (!decision.allow || !actorId) return notFound();

  // Scoped to this album as well as to the id: a request id from another one
  // must not be resolvable by whoever administers this.
  const [row] = await db
    .select({ actorId: schema.eventHostRequests.actorId })
    .from(schema.eventHostRequests)
    .where(
      and(
        eq(schema.eventHostRequests.id, body.requestId),
        eq(schema.eventHostRequests.eventId, id),
        eq(schema.eventHostRequests.status, 'open'),
      ),
    )
    .limit(1);
  if (!row) return notFound();

  /*
   * The role first, for the reason the access queue writes the participant row
   * first: if this crashes between the two writes, somebody approved who can
   * already add reads as still waiting and the host approves again, which is
   * harmless. The other order leaves somebody marked approved who cannot add
   * and has no way to say so.
   *
   * Scoped to a participant row that exists. Somebody who left the album
   * between asking and being answered has no row, the update matches nothing,
   * and the request is resolved anyway — the host answered a question, and it
   * should not sit in their queue forever because the asker walked away.
   */
  if (action === 'approve') {
    await db
      .update(schema.eventParticipants)
      .set({ role: 'host' })
      .where(
        and(
          eq(schema.eventParticipants.eventId, id),
          eq(schema.eventParticipants.actorId, row.actorId),
        ),
      );
  }

  await db
    .update(schema.eventHostRequests)
    .set({
      status: action === 'approve' ? 'approved' : 'declined',
      resolvedAt: new Date(),
      resolvedBy: actorId,
    })
    .where(eq(schema.eventHostRequests.id, body.requestId));

  return NextResponse.json({ ok: true });
}
