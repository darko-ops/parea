/**
 * A group — docs/design.md §3.
 *
 * Members see the room: the running archive of events. Everyone else sees the
 * door, and only if the group chose to be findable. There is no state in which
 * a non-member learns what events exist, let alone what is in them.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import {
  findGroup,
  groupArchive,
  groupPeople,
  memberCount,
  membershipOf,
  participatedInGroup,
} from '@/groups';
import { invitesSeenAtFor } from '@/invites';
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

  /*
   * The room, drawn rather than listed.
   *
   * This used to answer with `groupEvents` — four bare columns per album, so
   * the native group screen drew its archive as a column of blue words and a
   * raw date, in a product whose subject is photographs. The web page has been
   * building the richer thing for a while out of `groupArchive` and
   * `groupPeople`; it simply called them directly, being a server component,
   * and the route never caught up.
   *
   * So this now answers with what that page already draws: every album with
   * its cover, how much is in it, who was there and when — and the group's own
   * people, which is the other half of "what is in this room".
   *
   * Null `since` means never looked, which has to mean everything is new
   * rather than nothing: the epoch, not `now`. Same rule the web page follows.
   */
  const since = (await invitesSeenAtFor(db, actorId)) ?? new Date(0);
  const [events, people] = await Promise.all([
    groupArchive(db, group.id, actorId, since),
    groupPeople(db, group.id),
  ]);

  return NextResponse.json({
    id: group.id,
    name: group.name,
    memberCount: await memberCount(db, group.id),
    member: true,
    role: membership.role,
    findable: group.findable,
    events,
    /*
     * Everybody in it, with their faces.
     *
     * An actor id per person, which is what the people rows elsewhere in this
     * product deliberately avoid — but a group's membership is not a fact
     * about an event, and the id is what opens somebody's profile from here.
     * It is the same list the web's group page is handed.
     */
    people,
  });
}
