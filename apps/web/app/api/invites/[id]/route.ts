/**
 * Answering an invitation.
 *
 * The only route in the product where accepting something is what grants
 * access. Everywhere else access comes from a credential somebody was handed —
 * a link, a code, a group — and the person holding it decided by using it.
 * An invitation is the other shape: somebody else proposed it, and this is the
 * yes.
 *
 * Scoped to the invitation's own actor in the statement rather than checked
 * first and written second. Two statements is a window, and the window is "is
 * this mine" answered about a row something else could change.
 *
 * Everything that is not allowed answers 404, including somebody else's
 * invitation. Distinguishing "no such invitation" from "not yours" would make
 * this a way to ask whether an id is real.
 */

import { schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { recordParticipant } from '@/access';
import { getDb } from '@/db';
import { currentActorId, grantCapability } from '@/session';

export const runtime = 'nodejs';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  if (body.action !== 'accept' && body.action !== 'decline') {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  const status = body.action === 'accept' ? 'accepted' : 'declined';

  const [invite] = await db
    .update(schema.eventInvites)
    .set({ status, respondedAt: new Date() })
    .where(
      and(
        eq(schema.eventInvites.id, id),
        eq(schema.eventInvites.actorId, actorId),
        // Only an open one. Answering twice from two tabs must not turn a
        // decline back into an accept.
        eq(schema.eventInvites.status, 'open'),
      ),
    )
    .returning({ eventId: schema.eventInvites.eventId });

  if (!invite) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  /*
   * The participant row is written here and only here.
   *
   * Which is the whole point of the change: an invitation on its own grants
   * nothing, so a host adding somebody by handle cannot put themselves into
   * that person's account. Declining writes no row at all — there is nothing
   * to revoke, because nothing was ever granted.
   */
  if (status === 'accepted') {
    await recordParticipant(db, invite.eventId, actorId);

    /*
     * And the capability cookie, here, because this is the moment it is
     * earned.
     *
     * Participation deliberately is not a credential — `authorize` wants
     * `isParticipant && capFresh`, so a participant row on its own opens
     * nothing. Without this, accepting an invitation wrote the row, sent
     * somebody to the event, and showed them a 404: the exact bug the Invites
     * cards hit before they were routed through `/e/<token>`, arriving from
     * the other direction.
     *
     * Granting it here rather than sending them through the link is the better
     * shape anyway: the decision has just been made against a row that says
     * they were asked, so nothing is being taken on trust from a URL.
     */
    const [event] = await db
      .select({ capEpoch: schema.events.capEpoch })
      .from(schema.events)
      .where(eq(schema.events.id, invite.eventId));
    if (event) await grantCapability(invite.eventId, event.capEpoch);
  }

  return NextResponse.json({ status, eventId: invite.eventId });
}
