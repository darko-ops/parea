/**
 * What the tray is claiming, for the rail and for the app's corner.
 *
 * Its own route rather than a field on the session, because the rail is on
 * every page and the session is fetched by one of them. A single small answer
 * that any page can ask for beats threading a count through every server
 * component's props — which is the version that gets forgotten on the next
 * page somebody adds.
 *
 * Answers zeroes rather than 403 for a caller with no actor. The rail renders
 * for everyone, and "you have nothing waiting" is the true answer for a
 * browser that has never been anywhere.
 *
 * ## Three claims, one round trip
 *
 * `waiting` is how many things are waiting on an *answer* — an invitation, a
 * friend request, somebody at the door of an event you run. It is a count
 * because each one is a job, and knowing there are four is different from
 * knowing there is one.
 *
 * `unread` is whether anything has *happened* since the last look: somebody
 * commented on your photograph, reacted to one, tagged you in one, added forty
 * to an album you are in. None of those are jobs and counting them would make
 * the badge a measure of volume, which is the number that stops meaning
 * anything. It is a boolean, and the clients draw it as a dot.
 *
 * Without it the tray was silent for most of what this product notifies about:
 * a push would arrive, be tapped away, and the icon it came from carried no
 * mark at all — so anybody who missed the banner had no way back to the thing
 * except to open Lately on the off-chance.
 *
 * `chats` is the same question about conversations, and it is here rather than
 * on `/api/groups` because of where it is drawn: a dot on the Chats tab has to
 * be on screen before anybody has opened Chats, and the call that screen makes
 * fetches every room with its last message and its deck of faces. This route
 * is already the one the chrome asks on launch, on waking, and when a
 * notification lands; carrying a third boolean costs one `exists` and no
 * second round trip.
 *
 * ## Why `unread` is read off the feed itself
 *
 * `activityFor` is the feed, and the feed is derived from a dozen tables. A
 * second, cheaper query shaped like "is anything new" would be a second
 * opinion about what counts as activity, and the two would drift the first
 * time a kind was added to one and not the other — a dot that appears for
 * something the page does not list, or worse, a page with a new line on it and
 * no dot. So this asks the same function the page asks, and the cost is named
 * rather than hidden: a dozen bounded queries on a route the rail calls on
 * every page load.
 *
 * Parea's welcome does not count. It is the one row in that list nobody did —
 * it exists so an empty page has something to be — and a dot is a claim that
 * something happened.
 */

import { NextResponse } from 'next/server';

import { activityFor } from '@/activity';
import { getDb } from '@/db';
import { unreadConversations } from '@/groupMessages';
import { invitesSeenAtFor, invitesWaiting } from '@/invites';
import { otherRequestsWaiting } from '@/requests';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET() {
  const db = getDb();
  const actorId = await currentActorId();
  // Four sources for three answers: two halves of the Activity page — what is
  // waiting on an answer, and what is new — and the state of Chats.
  const [news, unanswered, items, seenAt, chats] = await Promise.all([
    invitesWaiting(db, actorId),
    otherRequestsWaiting(db, actorId),
    activityFor(db, actorId),
    invitesSeenAtFor(db, actorId),
    unreadConversations(db, actorId),
  ]);

  // Never looked means everything is new, not nothing. Comparing against null
  // gives false in JavaScript, which is the wrong answer in the quiet way —
  // the same note `/api/activity` and the page itself carry.
  const since = seenAt ? seenAt.toISOString() : null;
  const unread = items.some(
    (item) => item.kind !== 'welcome' && (since === null || item.at > since),
  );

  return NextResponse.json({ waiting: news + unanswered, unread, chats });
}
