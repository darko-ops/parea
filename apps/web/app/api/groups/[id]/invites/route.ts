/**
 * Asking somebody into a group.
 *
 * The mirror of `app/api/events/[id]/invites`, and deliberately the same
 * shape: the same `invitable` gate, the same offer-not-fact rule, the same
 * bound, and the same answer shape. Two invitations that behave differently
 * would be two things to learn about one act.
 *
 * The gate here is being an **admin** of the group, which is the group's
 * `administer`. It is stricter than the event's in one way that matters:
 * `group_join_request` exists so an admin decides who comes in, and if any
 * member could invite, that decision could be routed around by asking a friend
 * on the inside. The approval and the invitation are the same power pointed in
 * two directions, so they answer to the same person.
 */

import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { findGroup, inviteToGroup, invitedTo, membershipOf } from '@/groups';
import { notifyGroupInvite } from '@/notify';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

/** How many people one request may add. A guest list, not a broadcast. */
const MAX_PER_REQUEST = 50;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const group = await findGroup(db, id);
  if (!group) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const actorId = await currentActorId();
  const membership = actorId ? await membershipOf(db, group.id, actorId) : null;
  /*
   * 404 rather than 403, matching every other group read: whether a group
   * exists is only answerable to somebody who can see it, and "you are not an
   * admin of this" tells a stranger that it is real.
   */
  if (!actorId || membership?.role !== 'admin') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { actorIds?: unknown };
  const asked = Array.isArray(body.actorIds)
    ? body.actorIds.filter((a): a is string => typeof a === 'string')
    : [];
  if (asked.length === 0 || asked.length > MAX_PER_REQUEST) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const invited = await inviteToGroup(db, group.id, actorId, asked);

  if (invited.length > 0) {
    const [admin] = await db
      .select({ displayName: schema.actors.displayName, handle: schema.actors.handle })
      .from(schema.actors)
      .where(eq(schema.actors.id, actorId))
      .limit(1);

    await notifyGroupInvite(db, {
      actorIds: invited,
      groupId: group.id,
      groupName: group.name,
      who: admin?.displayName ?? (admin?.handle ? `@${admin.handle}` : 'Someone'),
    });
  }

  /*
   * How many, not which. The caller already knows who it asked for, and a
   * per-person answer would report whether each one has blocked the admin —
   * which is a question this route should not answer even to them.
   */
  return NextResponse.json({ invited: invited.length });
}

/** Who is already in or already asked, so the picker can leave them out. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();

  const group = await findGroup(db, id);
  if (!group) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const actorId = await currentActorId();
  const membership = actorId ? await membershipOf(db, group.id, actorId) : null;
  if (!actorId || membership?.role !== 'admin') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const members = await db
    .select({ actorId: schema.groupMembers.actorId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, group.id));

  return NextResponse.json({
    members: members.map((row) => row.actorId),
    invited: await invitedTo(db, group.id),
  });
}
