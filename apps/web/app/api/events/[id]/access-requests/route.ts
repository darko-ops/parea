/**
 * Asking to be let into a private event, and the host answering.
 *
 * The third access policy needs a conversation the other two do not. `link_open`
 * and `account_required` both answer "who may look?" with a property of the
 * visitor, so there is nobody to ask. `request_access` hands the last step to
 * the host, and this is where that step happens.
 *
 * Approving writes an `event_participant` row and that row is the grant —
 * nothing here is read by `authorize`. It is deliberate: a bug in this file can
 * lose somebody's request, which is visible and fixable by asking again, and
 * cannot open an event, which would not be either.
 */

import { REQUEST_ACCESS, schema } from '@parea/core';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventById, isSignedIn, recordParticipant } from '@/access';
import { getDb } from '@/db';
import { notifyAccessRequested } from '@/notify';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 });

/**
 * The host's queue.
 *
 * Guarded by `administer`, which no link and no code can grant — so this
 * answers 404 to everyone who is not the creator or a group admin, including
 * people who are themselves waiting in it.
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
      id: schema.eventAccessRequests.id,
      createdAt: schema.eventAccessRequests.createdAt,
      // Whatever they have to be called by. A handle is issued at sign-in so
      // there is always something, but the display name is what a host who was
      // there would recognise.
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
    })
    .from(schema.eventAccessRequests)
    .innerJoin(schema.actors, eq(schema.eventAccessRequests.actorId, schema.actors.id))
    .where(
      and(
        eq(schema.eventAccessRequests.eventId, id),
        eq(schema.eventAccessRequests.status, 'open'),
      ),
    )
    .orderBy(asc(schema.eventAccessRequests.createdAt));

  return NextResponse.json({ requests });
}

/**
 * Asking.
 *
 * Two things have to be true, and they are different questions. They must hold
 * the link — otherwise this route is a way to send a stranger's name to the
 * host of an event they only guessed the id of. And they must be signed in,
 * because the host is being asked to make a decision about a person and an
 * unclaimed actor is not one.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const event = await findEventById(db, id);
  if (!event || event.accessPolicy !== REQUEST_ACCESS) return notFound();

  const requester = await requesterFor(id);
  // The capability cookie granted by `/e/<token>`. It carries no access on its
  // own — `authorize` only counts it alongside participation — which is
  // exactly what makes it the right thing to check here: it proves the link
  // and nothing else.
  if (requester.capEpoch !== event.capEpoch) return notFound();

  const actorId = requester.actorId;
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }

  const [existing] = await db
    .select({ status: schema.eventAccessRequests.status })
    .from(schema.eventAccessRequests)
    .where(
      and(
        eq(schema.eventAccessRequests.eventId, id),
        eq(schema.eventAccessRequests.actorId, actorId),
      ),
    )
    .limit(1);

  // A declined row stays declined. Letting a second POST reopen it would make
  // "no" a thing the host has to keep saying, and the button that sends this
  // is one click.
  if (existing) return NextResponse.json({ status: existing.status });

  await db
    .insert(schema.eventAccessRequests)
    .values({ eventId: id, actorId })
    .onConflictDoNothing();

  /*
   * Tell the host, because otherwise nobody does.
   *
   * Fire-and-forget, like every notification: a push outage must not turn a
   * request that was written into a request the asker believes failed and
   * sends again.
   *
   * The name is the display name or the handle — never the email address,
   * which the host has no business learning from somebody knocking. A handle
   * is issued at sign-in, so there is always something to say.
   */
  const [asker] = await db
    .select({
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
    })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId))
    .limit(1);

  await notifyAccessRequested(db, {
    eventId: id,
    eventName: event.name,
    createdBy: event.createdBy,
    groupId: event.groupId,
    who: asker?.displayName ?? (asker?.handle ? `@${asker.handle}` : 'Someone'),
  });

  return NextResponse.json({ status: 'open' }, { status: 201 });
}

/** The host answering. */
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

  // Scoped to this event as well as to the id: a request id from another event
  // must not be resolvable by the admin of this one.
  const [row] = await db
    .select({ actorId: schema.eventAccessRequests.actorId })
    .from(schema.eventAccessRequests)
    .where(
      and(
        eq(schema.eventAccessRequests.id, body.requestId),
        eq(schema.eventAccessRequests.eventId, id),
        eq(schema.eventAccessRequests.status, 'open'),
      ),
    )
    .limit(1);
  if (!row) return notFound();

  // The participant row first. It is the grant, and the order matters: if this
  // crashes between the two writes, an approved person who is already in reads
  // as still waiting, and the host clicks approve again. The other order leaves
  // someone marked approved who cannot see anything and has no way to say so.
  if (action === 'approve') await recordParticipant(db, id, row.actorId);

  await db
    .update(schema.eventAccessRequests)
    .set({
      status: action === 'approve' ? 'approved' : 'declined',
      resolvedAt: new Date(),
      resolvedBy: actorId,
    })
    .where(eq(schema.eventAccessRequests.id, body.requestId));

  return NextResponse.json({ ok: true });
}
