/**
 * Friends: who they are, asking to be one, and answering.
 *
 * Approving writes the two `friendship` rows and that is the grant — nothing
 * in this file is read to decide whether two people are friends. Same
 * arrangement as the event and group requests, for the same reason: a bug here
 * can lose an ask, which somebody can repeat, and cannot make two people
 * friends who are not.
 */

import { schema } from '@parea/core';
import { and, eq, or } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { isSignedIn } from '@/access';
import { getDb } from '@/db';
import { befriend, friendsOf, requestsFor, unfriend } from '@/friends';
import { notifyFriendRequest } from '@/notify';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

async function me(): Promise<{ db: ReturnType<typeof getDb>; actorId: string } | null> {
  const db = getDb();
  const actorId = await currentActorId();
  if (!actorId || !(await isSignedIn(db, actorId))) return null;
  return { db, actorId };
}

const signIn = () => NextResponse.json({ error: 'sign_in_required' }, { status: 403 });

/** Your friends, and the people waiting on you. */
export async function GET() {
  const session = await me();
  if (!session) return signIn();
  const { db, actorId } = session;

  const [friends, requests] = await Promise.all([
    friendsOf(db, actorId),
    requestsFor(db, actorId),
  ]);
  return NextResponse.json({ friends, requests });
}

/** Asking. */
export async function POST(request: Request) {
  const session = await me();
  if (!session) return signIn();
  const { db, actorId } = session;

  const body = (await request.json().catch(() => ({}))) as { actorId?: unknown };
  const target = typeof body.actorId === 'string' ? body.actorId : null;
  if (!target || target === actorId) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const [them] = await db
    .select({
      id: schema.actors.id,
      accountId: schema.actors.accountId,
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
    })
    .from(schema.actors)
    .where(eq(schema.actors.id, target))
    .limit(1);
  // Same answer for "no such person" and "not an account", so this cannot be
  // used to test whether an id belongs to somebody.
  if (!them || !them.accountId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // A block in either direction ends it here, with the same answer everybody
  // else gets. Blocking is private — they are not told it happened — so this
  // must not become the thing that tells them.
  const [blocked] = await db
    .select({ blocker: schema.blocks.blockerActorId })
    .from(schema.blocks)
    .where(
      or(
        and(
          eq(schema.blocks.blockerActorId, actorId),
          eq(schema.blocks.blockedActorId, target),
        ),
        and(
          eq(schema.blocks.blockerActorId, target),
          eq(schema.blocks.blockedActorId, actorId),
        ),
      ),
    )
    .limit(1);
  if (blocked) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // They asked first: answering their request is what this means, rather than
  // two open asks pointing at each other that neither person can resolve.
  const [incoming] = await db
    .select({ id: schema.friendRequests.id })
    .from(schema.friendRequests)
    .where(
      and(
        eq(schema.friendRequests.fromActorId, target),
        eq(schema.friendRequests.toActorId, actorId),
        eq(schema.friendRequests.status, 'open'),
      ),
    )
    .limit(1);

  if (incoming) {
    await befriend(db, actorId, target);
    await db
      .update(schema.friendRequests)
      .set({ status: 'accepted', resolvedAt: new Date() })
      .where(eq(schema.friendRequests.id, incoming.id));
    return NextResponse.json({ status: 'accepted' });
  }

  const [existing] = await db
    .select({ status: schema.friendRequests.status })
    .from(schema.friendRequests)
    .where(
      and(
        eq(schema.friendRequests.fromActorId, actorId),
        eq(schema.friendRequests.toActorId, target),
      ),
    )
    .limit(1);
  // A declined ask stays declined, so "no" is said once rather than becoming
  // something the other person can keep re-asking past.
  if (existing) return NextResponse.json({ status: existing.status });

  await db
    .insert(schema.friendRequests)
    .values({ fromActorId: actorId, toActorId: target })
    .onConflictDoNothing();

  const [asker] = await db
    .select({
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
    })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId))
    .limit(1);

  await notifyFriendRequest(db, {
    toActorId: target,
    who: asker?.displayName ?? (asker?.handle ? `@${asker.handle}` : 'Someone'),
  });

  return NextResponse.json({ status: 'open' }, { status: 201 });
}

/** Answering. */
export async function PATCH(request: Request) {
  const session = await me();
  if (!session) return signIn();
  const { db, actorId } = session;

  const body = (await request.json().catch(() => ({}))) as {
    requestId?: unknown;
    action?: unknown;
  };
  const action =
    body.action === 'accept' ? 'accept' : body.action === 'decline' ? 'decline' : null;
  if (!action || typeof body.requestId !== 'string') {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  // Scoped to requests pointing at you: a request id belonging to somebody
  // else's inbox is not yours to answer.
  const [row] = await db
    .select({ fromActorId: schema.friendRequests.fromActorId })
    .from(schema.friendRequests)
    .where(
      and(
        eq(schema.friendRequests.id, body.requestId),
        eq(schema.friendRequests.toActorId, actorId),
        eq(schema.friendRequests.status, 'open'),
      ),
    )
    .limit(1);
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // The friendship first, for the same reason the event approval writes the
  // participant row first: a crash between the two leaves a request somebody
  // can answer again, rather than an answer that granted nothing.
  if (action === 'accept') await befriend(db, actorId, row.fromActorId);

  await db
    .update(schema.friendRequests)
    .set({ status: action === 'accept' ? 'accepted' : 'declined', resolvedAt: new Date() })
    .where(eq(schema.friendRequests.id, body.requestId));

  return NextResponse.json({ ok: true });
}

/** Stopping. */
export async function DELETE(request: Request) {
  const session = await me();
  if (!session) return signIn();
  const { db, actorId } = session;

  const target = new URL(request.url).searchParams.get('actorId');
  if (!target) return NextResponse.json({ error: 'invalid' }, { status: 400 });

  await unfriend(db, actorId, target);
  // Both requests between the two are cleared, so asking again is possible.
  // Removing somebody is not the same as refusing them forever, and leaving an
  // accepted row behind would make the next ask look already answered.
  await db
    .delete(schema.friendRequests)
    .where(
      and(
        eq(schema.friendRequests.fromActorId, actorId),
        eq(schema.friendRequests.toActorId, target),
      ),
    );
  await db
    .delete(schema.friendRequests)
    .where(
      and(
        eq(schema.friendRequests.fromActorId, target),
        eq(schema.friendRequests.toActorId, actorId),
      ),
    );

  return NextResponse.json({ ok: true });
}
