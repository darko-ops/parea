/**
 * A group — docs/design.md §3.
 *
 * Members see the room: the running archive of events. Everyone else sees the
 * door, and only if the group chose to be findable. There is no state in which
 * a non-member learns what events exist, let alone what is in them.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { findGroup, groupEvents, memberCount, membershipOf, participatedInGroup } from '@/groups';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const group = await findGroup(db, id);
  if (!group) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const actorId = await currentActorId();
  const membership = await membershipOf(db, group.id, actorId);

  if (!membership) {
    // Unfindable groups are indistinguishable from nonexistent ones to a
    // stranger, so the id cannot be used to confirm a private group is real.
    if (!group.findable) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    return NextResponse.json({
      id: group.id,
      name: group.name,
      memberCount: await memberCount(db, group.id),
      member: false,
      // Someone who was in one of this group's events can just join; someone
      // who found it by name has to ask.
      canJoinDirectly: actorId
        ? await participatedInGroup(db, group.id, actorId)
        : false,
    });
  }

  return NextResponse.json({
    id: group.id,
    name: group.name,
    memberCount: await memberCount(db, group.id),
    member: true,
    role: membership.role,
    findable: group.findable,
    events: await groupEvents(db, group.id),
  });
}
