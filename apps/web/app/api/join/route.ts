/**
 * Resolve a link or a spoken code to an event — design §5.
 *
 * The web exchanges a link for a cookie by navigating to `/e/<token>`. Native
 * cannot navigate, and it also needs the other two doors: a QR scan yields the
 * same token, and someone across the room says "amber-fox".
 *
 * Returns only what a join screen needs. No photos, ever — search and joining
 * return a door, not a room.
 */

import { isWellFormedLinkToken, normaliseCode, schema } from '@parea/core';
import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { decide, findEventById, findEventByLinkToken, isSignedIn, recordParticipant } from '@/access';
import { getDb } from '@/db';
import { clientOf, isArriving, observe } from '@/observe';
import { JOIN_CODE_LIMIT, withinLimit, withinLimitFor } from '@/ratelimit';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    linkToken?: unknown;
    code?: unknown;
    eventId?: unknown;
  };

  const db = getDb();
  const actorId = await currentActorId();

  let event = null;
  let presentedCode: string | undefined;
  /** Opened from somebody's profile, by id, with no credential in hand. */
  let byId = false;

  if (typeof body.linkToken === 'string') {
    // Accepts a full URL as well as a bare token, because people paste links.
    const token = body.linkToken.trim().split('/').pop() ?? '';
    if (isWellFormedLinkToken(token)) {
      event = await findEventByLinkToken(db, token);
    }
  } else if (typeof body.code === 'string') {
    /*
     * A spoken code is for somebody signed in, and it is checked as that.
     *
     * This route used to present the album's own link token on the caller's
     * behalf whenever a code matched — which made the code a link, skipped the
     * rule that a code only counts in a signed-in hand, and returned the full
     * token to anybody who guessed one. With no limit on guessing and a pool
     * of about a hundred and seventeen thousand codes, that was every album
     * with a code, its name and its link, to anyone with a script.
     *
     * Signed out, the answer is "sign in" before anything is looked up — the
     * same answer for a live code, a dead one and nonsense, so it is not a way
     * to find out which codes exist. Signed in, attempts are limited per
     * source and per account.
     */
    if (!(await isSignedIn(db, actorId))) {
      return NextResponse.json({ error: 'sign_in_required' }, { status: 403 });
    }
    const secret = process.env.SESSION_SECRET;
    if (
      !(await withinLimit(db, JOIN_CODE_LIMIT, secret)) ||
      !(await withinLimitFor(db, JOIN_CODE_LIMIT, secret, actorId!))
    ) {
      return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
    }
    const words = normaliseCode(body.code);
    if (words) {
      const [row] = await db
        .select({ event: schema.events })
        .from(schema.codes)
        .innerJoin(schema.events, eq(schema.codes.eventId, schema.events.id))
        .where(and(eq(schema.codes.words, words), isNull(schema.codes.releasedAt)))
        .limit(1);
      event = row?.event ?? null;
      presentedCode = words;
    }
  } else if (typeof body.eventId === 'string' && UUID.test(body.eventId)) {
    /*
     * The third door: an album on somebody's profile, opened by somebody who
     * was never sent anything — which `authorize` names as the whole point of
     * `public`. No credential is presented, so the decision below is made on
     * who the viewer is alone: a public album opens, and a private one opens
     * only for somebody already in it. Everybody else gets the same 404 a bad
     * token gets; the profile's own "ask to join" is their way in.
     */
    event = await findEventById(db, body.eventId);
    byId = true;
  }

  // One answer for a bad token, an unknown code and a deleted event, so this
  // is not a way to test whether either exists.
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const decision = await decide(db, event, 'view', {
    actorId,
    /*
     * The event's own token stands in for the caller's only when the caller
     * presented the link: they had it, and `findEventByLinkToken` is how the
     * event was found. By id there is no credential, and by code the code is
     * the credential — presenting the token for either would open the album
     * to anyone who could name it, which is what a code used to do.
     */
    linkToken: presentedCode || byId ? undefined : event.linkToken,
    code: presentedCode,
  });

  // §18: where joining loses people. By id is somebody browsing a profile,
  // not somebody sent a link, so it is not a door and is not counted.
  const arriving = !byId && (await isArriving(db, event.id, actorId));
  if (arriving) {
    await observe(db, { kind: 'link_opened', eventId: event.id, actorId, client: clientOf(request) });
    if (!decision.allow) {
      await observe(db, {
        kind: 'join_refused',
        eventId: event.id,
        actorId,
        client: clientOf(request),
        reason: decision.reason,
      });
    }
  }

  /*
   * A private album whose creator has not let them in yet, and the app's own
   * version of the redirect `/e/<token>` sends a browser.
   *
   * Every denial here used to be 404, which was right when holding the link
   * was the access: there was nothing else a link could mean. Private changed
   * that — a link to one is real, correct, and not a way in — and 404 turned
   * the answer into "Couldn't find that. Check the link and try again", sent
   * to somebody holding exactly the right link. They check it, find it is
   * right, and try again.
   *
   * Safe to distinguish because of what is above it: `event` was found *by*
   * the link token or by an unreleased code, so this reply only ever reaches
   * somebody who presented a real credential — the same test the web's door
   * page applies before it will say an album's name. A guessed token is still
   * 404 below, so this does not become a way to ask whether one exists.
   *
   * The name comes with it. The door has to say which album is being asked
   * about, and it is not news to somebody who was sent the link.
   */
  if (
    !byId &&
    !decision.allow &&
    (decision.reason === 'approval_required' || decision.reason === 'sign_in_required')
  ) {
    return NextResponse.json(
      { error: decision.reason, event: { id: event.id, name: event.name } },
      { status: 403 },
    );
  }

  if (!decision.allow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  /*
   * The same thing `/e/<token>` records, for the door native comes through.
   *
   * Native does not need this to see the event — it keeps the link token and
   * presents it on every call, so `viaLink` carries it — which is why the
   * missing record here failed differently from the web's and not at all
   * until a host reached for a switch. `joins_open` off means "new people can
   * no longer join; everyone already in keeps access", and the second half of
   * that sentence is enforced entirely by this table. Someone who joined on
   * their phone, looked, and did not upload was never written down as being
   * in, so closing joins evicted them from an event they were already at.
   *
   * Below the decision for the same reason as `/e/`: `joins_closed` is refused
   * above, so this cannot become the way in for the people that switch was
   * thrown against.
   *
   * Only for an actor that already exists. `ensureActor` would mint one and
   * set a cookie, and `/api/session` is explicit that native must not carry a
   * cookie and a keychain token for the same actor — and a row naming an actor
   * this client cannot prove it is would record nobody.
   */
  /*
   * Not by id. Opening a public album from a profile is looking at it, the
   * way `/event/<id>` is on the web, and neither writes you into it: being
   * listed as in somebody's album is something you do, not something that
   * happens because you glanced at their page.
   */
  if (actorId && !byId) await recordParticipant(db, event.id, actorId);

  // §18's install-conversion question: which client people actually arrive on,
  // and therefore whether the install wall is costing contribution. Recorded
  // after the decision, so a refused join is not counted as one. Arrivals
  // only, as on the web: somebody already in, opening the album again, is not
  // joining it, and counting them would let regulars outnumber newcomers.
  if (arriving)
    await observe(db, {
      kind: 'joined',
      eventId: event.id,
      actorId,
      client: clientOf(request),
    });

  return NextResponse.json({
    id: event.id,
    name: event.name,
    linkToken: event.linkToken,
    capEpoch: event.capEpoch,
    contributePolicy: event.contributePolicy,
    // Drives auto-selection on the native client (design §7.3). Null is a
    // normal answer — the client falls back rather than guessing a window.
    startsAt: event.startsAt?.toISOString() ?? null,
    endsAt: event.endsAt?.toISOString() ?? null,
  });
}
