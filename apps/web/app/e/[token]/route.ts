/**
 * The shareable link. Records that the holder is in, exchanges the token for a
 * scoped capability, then redirects.
 *
 * This is a route handler rather than a page for two reasons. Cookies can only
 * be set outside of rendering, and redirecting to `/event/<id>` means the link
 * token appears in the address bar exactly once and is gone on the next
 * navigation — which, combined with `Referrer-Policy: no-referrer`, is what
 * stops the credential leaking (design §3).
 *
 * The link itself keeps working forever, for everyone. It is the capability
 * that becomes ambient, not the URL.
 */

import { denyStatus, isWellFormedLinkToken } from '@parea/core';
import { redirect } from 'next/navigation';

import {
  AccessError,
  decide,
  findEventByLinkToken,
  recordParticipant,
  toResponse,
} from '@/access';
import { getDb } from '@/db';
import { ensureActor, grantCapability, requesterFor } from '@/session';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  // Cheap shape check before putting an arbitrary path segment near the db.
  if (!isWellFormedLinkToken(token)) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const db = getDb();
  const event = await findEventByLinkToken(db, token);
  if (!event) return Response.json({ error: 'not_found' }, { status: 404 });

  const requester = await requesterFor(event.id, { linkToken: token });
  const decision = await decide(db, event, 'view', requester);

  // A private event, opened by someone signed out. They hold a real link, so
  // this is a step rather than a wall — send them to sign in and bring them
  // back here afterwards, which re-runs the exchange and lands them in the
  // event. Returning JSON would end the journey at a 403 in a browser tab.
  if (!decision.allow && decision.reason === 'sign_in_required') {
    redirect(`/account?next=${encodeURIComponent(`/e/${token}`)}`);
  }

  /*
   * A private event whose host has not let them in yet.
   *
   * The capability is granted anyway, and it grants nothing: `authorize`
   * counts it only alongside participation, so on its own it is a record that
   * this browser held the link. That is precisely what the request page needs
   * to check before showing an event's name to somebody, and it becomes their
   * credential the moment approval writes the participant row — without it
   * they would have to be sent the link a second time.
   *
   * A redirect rather than the 403 below, for the same reason the sign-in case
   * is one: this is a step, and returning JSON ends the journey in a browser
   * tab looking at a word.
   */
  if (!decision.allow && decision.reason === 'approval_required') {
    await grantCapability(event.id, event.capEpoch);
    redirect(`/event/${event.id}/request`);
  }

  if (!decision.allow) {
    // 'view' rather than 'contribute': arriving at a link with uploads closed
    // should still show you the photos.
    return toResponse(new AccessError(denyStatus(decision.reason), decision.reason));
  }

  /*
   * Both halves of the exchange, and for a long time this was only the second.
   *
   * The capability cookie is not a credential on its own: `authorize` accepts
   * it as `isParticipant && capFresh`, so it confirms a relationship rather
   * than creating one. Nothing recorded that relationship on this path —
   * `recordParticipant` was called from the upload route and nowhere else — so
   * a link exchanged cleanly, redirected, and then 404ed on the event page,
   * for everybody except the creator, a group member, and anyone who had
   * already uploaded. That is every person a link is ever sent to.
   *
   * It is recorded here rather than folded into `grantCapability` because they
   * are different claims: one says who is in, and lives in the database where
   * the host can see it and revocation can reach it; the other is a cookie in
   * one browser, and a person who is in has usually got more than one.
   *
   * Ordering is the safety property. `decide` has already refused a closed
   * event with `joins_closed` — that check is what "new people can no longer
   * join" means — so nothing reaches this line without being entitled to join,
   * and this does not become the way in for someone the switch was thrown
   * against.
   */
  const actorId = await ensureActor(db);
  await recordParticipant(db, event.id, actorId);
  await grantCapability(event.id, event.capEpoch);
  redirect(`/event/${event.id}`);
}
