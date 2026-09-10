/**
 * The people who keep turning up, for a client that cannot run a query.
 *
 * The web computes this inside `/groups` because that page is a server
 * component and can. The native client cannot, so the same two calls are
 * exposed here — one route rather than two, because no screen wants either
 * answer without the other: the clusters are the cards and `also` is the add
 * row inside the form one of those cards becomes.
 *
 * ## What this route is allowed to say
 *
 * Only ever about the caller. `recurringClusters` derives its answer from
 * events the actor is a participant of, so everything returned is something
 * they could already read — but that is a property of the query, not of this
 * route, and the route must not grow a way to ask about somebody else. There
 * is deliberately no `?actorId=`: the only subject is whoever is holding the
 * credential.
 *
 * Answers an empty pair rather than 401 for a caller with no actor, matching
 * `GET /api/groups` directly above it. The app asks this at launch, possibly
 * before anybody has signed in, and "you have no clusters" and "you are
 * nobody" are the same screen.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { recurringClusters, sharedOnceWith } from '@/groups';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET() {
  const db = getDb();
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ clusters: [], also: [] });

  const clusters = await recurringClusters(db, actorId);
  // Anybody already standing in a cluster is excluded, so the "add somebody
  // who was not at those events" row never offers a person who is already a
  // chip above it.
  const also = await sharedOnceWith(
    db,
    actorId,
    clusters.flatMap((cluster) => cluster.personIds),
  );

  return NextResponse.json({ clusters, also });
}
