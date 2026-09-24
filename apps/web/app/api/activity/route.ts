/**
 * Lately, for a client that cannot compose it on the server.
 *
 * The web page reads `activityFor` and `pendingRequestsFor` directly and renders
 * the result; the phone has to ask. This is that page's data, in one request,
 * and it is deliberately one rather than two:
 *
 *   - `/api/requests` already answers the top half, and the phone already calls
 *     it for the bubble on Home. It stays exactly as it is.
 *   - But Lately is *both* halves at once. Two round trips to draw one screen
 *     means the answerable cards and the feed underneath arrive separately, so
 *     the screen lays itself out twice — and on a phone the second trip is the
 *     one that happens on a train.
 *
 * ## Worded here
 *
 * `when` and `bucket` are composed on this side, by the same `ago` and
 * `bucketFor` the web page uses — see `src/when.ts` for why a device's own
 * clock is the wrong one to decide "Today" with. The client groups the runs,
 * because a run has to be recomputed as rows leave and a heading handed down as
 * a row would sit there over nothing.
 *
 * ## Looking is what clears the badge
 *
 * `markInvitesSeen` runs here, as it does on the web page's render, and for the
 * same reason: marking read is a side effect of having read, and the
 * alternative is a second round trip to record that the first one happened.
 * After the reads, so a failure halfway leaves the count intact rather than
 * cleared without being shown.
 *
 * A GET with a write in it, which is worth being uneasy about. It is safe in
 * the way that matters — idempotent, and it changes nothing but a timestamp
 * about the caller — but it does mean a prefetch would clear somebody's badge.
 * Nothing prefetches this: it is fetched when the screen opens.
 *
 * There is no capability check because there is nothing here to check one
 * against. Both readers take the actor and every query is scoped to them — the
 * same arrangement `/api/requests` and `/api/events` have, where the
 * authorization is the shape of the query rather than a decision about a thing.
 */

import { NextResponse } from 'next/server';

import { activityFor } from '@/activity';
import { getDb } from '@/db';
import { invitesSeenAtFor, markInvitesSeen } from '@/invites';
import { pendingRequestsFor } from '@/requests';
import { currentActorId } from '@/session';
import { ago, bucketFor } from '@/when';

export const runtime = 'nodejs';

export async function GET() {
  const db = getDb();
  const actorId = await currentActorId();

  const [items, waiting, seenAt] = await Promise.all([
    activityFor(db, actorId),
    pendingRequestsFor(db, actorId),
    // Read before it is written below: asking afterwards would return the
    // moment of this request and mark every line as already read, so the unread
    // state would be correct exactly once, for somebody who never came back.
    invitesSeenAtFor(db, actorId),
  ]);

  await markInvitesSeen(db, actorId);

  const now = new Date();
  // Never looked means everything is new, not nothing. Comparing against null
  // gives false in JavaScript, which is the wrong answer in the quiet way.
  const since = seenAt ? seenAt.toISOString() : null;

  return NextResponse.json({
    waiting: waiting.map((request) => ({ ...request, when: ago(request.at, now) })),
    items: items.map((item) => ({
      id: item.id,
      who: item.who,
      what: item.what,
      when: ago(item.at, now),
      href: item.href,
      image: item.image,
      images: item.images,
      bucket: bucketFor(item.at, now),
      unread: since === null || item.at > since,
    })),
  });
}
