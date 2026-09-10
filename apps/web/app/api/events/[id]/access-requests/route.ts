/**
 * Asking to be let into a private album, and the creator answering.
 *
 * `private` needs a conversation `public` does not: public answers "who may
 * look?" with a property of the visitor, so there is nobody to ask. Private
 * hands the last step to the person who made it, and this is where that step
 * happens.
 *
 * Approving writes an `event_participant` row and that row is the grant —
 * nothing here is read by `authorize`. It is deliberate: a bug in this file can
 * lose somebody's request, which is visible and fixable by asking again, and
 * cannot open an event, which would not be either.
 */

import { PRIVATE, schema } from '@parea/core';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventById, isSignedIn, recordParticipant } from '@/access';
import { getDb } from '@/db';
import { isBlockedBy } from '@/moderation';
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
 * Signed in, and not blocked. That is the whole gate, and it used to also
 * require the link — the capability cookie `/e/<token>` grants — on the
 * reasoning that otherwise this route sends a stranger's name to the host of
 * an event they only guessed the id of.
 *
 * The link requirement is gone because it now contradicts the product: a
 * private album is listed on its creator's profile, by name, to anybody signed
 * in, and the button under it is this route. Requiring the link would mean the
 * one door the profile offers is the one door that answers 404.
 *
 * What replaces it is the block, checked in the creator's direction. Somebody
 * who has been blocked cannot reach the profile that lists the album and must
 * not reach its door either — and they get the same 404 a nonexistent event
 * gets, because a block is silent and this must not be the thing that tells
 * them. Guessing remains impractical on its own: the id is a v4 UUID.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const event = await findEventById(db, id);
  if (!event || event.accessPolicy !== PRIVATE) return notFound();

  const actorId = (await requesterFor(id)).actorId;
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
  }

  if (await isBlockedBy(db, event.createdBy, actorId)) return notFound();

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
