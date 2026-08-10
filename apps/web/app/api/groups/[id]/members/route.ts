/**
 * Joining and leaving — docs/design.md §3.
 *
 * Joining is unapproved for anyone who took part in one of the group's events.
 * There is nothing to approve: they already had those photos, and joining is
 * only a statement about the next event. This is the opt-in taken after value
 * has been delivered rather than in front of it.
 *
 * Anyone else has to ask (see ./requests).
 */

import { schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { addMember, findGroup, membershipOf, participatedInGroup } from '@/groups';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const db = getDb();
  const group = await findGroup(db, id);
  if (!group) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (await membershipOf(db, group.id, actorId)) {
    return NextResponse.json({ member: true });
  }
  if (!(await participatedInGroup(db, group.id, actorId))) {
    return NextResponse.json({ error: 'request_required' }, { status: 403 });
  }

  await addMember(db, group.id, actorId);
  return NextResponse.json({ member: true }, { status: 201 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const db = getDb();
  // Leaving is unconditional and needs no permission. Membership that cannot
  // be given up is not membership.
  await db
    .delete(schema.groupMembers)
    .where(
      and(
        eq(schema.groupMembers.groupId, id),
        eq(schema.groupMembers.actorId, actorId),
      ),
    );
  return NextResponse.json({ member: false });
}
