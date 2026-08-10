/**
 * Asking to join a findable group, and answering — docs/design.md §3.
 *
 * Only the search path needs this. Someone who found a group by name has no
 * relationship to it, so an admin decides; that is the cost of being findable
 * at all, and it is why findable defaults to off.
 */

import { schema } from '@parea/core';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { addMember, findGroup, membershipOf, participatedInGroup } from '@/groups';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

/** The admin's queue. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const actorId = await currentActorId();
  const membership = await membershipOf(db, id, actorId);
  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const requests = await db
    .select({
      id: schema.groupJoinRequests.id,
      createdAt: schema.groupJoinRequests.createdAt,
      // A display name if they gave one; there are no profiles to link to.
      displayName: schema.actors.displayName,
    })
    .from(schema.groupJoinRequests)
    .innerJoin(schema.actors, eq(schema.groupJoinRequests.actorId, schema.actors.id))
    .where(
      and(
        eq(schema.groupJoinRequests.groupId, id),
        eq(schema.groupJoinRequests.status, 'open'),
      ),
    )
    .orderBy(asc(schema.groupJoinRequests.createdAt));

  return NextResponse.json({ requests });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const db = getDb();
  const group = await findGroup(db, id);
  // Not findable means not askable — and answers the same as nonexistent.
  if (!group || !group.findable) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (await membershipOf(db, group.id, actorId)) {
    return NextResponse.json({ member: true });
  }
  if (await participatedInGroup(db, group.id, actorId)) {
    // They never needed to ask.
    await addMember(db, group.id, actorId);
    return NextResponse.json({ member: true }, { status: 201 });
  }

  await db
    .insert(schema.groupJoinRequests)
    .values({ groupId: group.id, actorId })
    .onConflictDoNothing();

  return NextResponse.json({ requested: true }, { status: 201 });
}

/** An admin approving or declining. */
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
  const actorId = await currentActorId();
  const membership = await membershipOf(db, id, actorId);
  if (membership?.role !== 'admin') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const [pending] = await db
    .select()
    .from(schema.groupJoinRequests)
    .where(
      and(
        eq(schema.groupJoinRequests.id, body.requestId),
        eq(schema.groupJoinRequests.groupId, id),
        eq(schema.groupJoinRequests.status, 'open'),
      ),
    )
    .limit(1);
  if (!pending) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (action === 'approve') await addMember(db, id, pending.actorId);

  await db
    .update(schema.groupJoinRequests)
    .set({
      status: action === 'approve' ? 'approved' : 'declined',
      resolvedAt: new Date(),
      resolvedBy: actorId,
    })
    .where(eq(schema.groupJoinRequests.id, pending.id));

  return NextResponse.json({ resolved: action });
}
