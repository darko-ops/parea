/**
 * Everything waiting on an answer from you.
 *
 * Read-only, and the second client is why it exists: the web page composes
 * this list on the server, and the native app cannot. Answering is
 * deliberately *not* here — an invitation is answered at `/api/invites/[id]`,
 * a friend request at `/api/friends`, and somebody asking into an event at
 * that event's `access-requests`. Each of those already decides who may say
 * yes, and a single "answer anything" endpoint would be a second place where
 * that has to be got right.
 *
 * There is no capability check because there is nothing here to check one
 * against. `pendingRequestsFor` takes the actor and every one of its queries
 * is scoped to them — the same arrangement as `eventsFor` behind
 * `/api/events`, where the authorization is the shape of the query rather
 * than a decision made about an event.
 *
 * An empty list for a caller with no actor, rather than a 403. The bubble
 * renders for everybody now, including a browser that has never been
 * anywhere, and "nothing is waiting on you" is the true answer for one.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { pendingRequestsFor } from '@/requests';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET() {
  const requests = await pendingRequestsFor(getDb(), await currentActorId());
  return NextResponse.json({ requests });
}
