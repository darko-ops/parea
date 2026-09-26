/**
 * A group — docs/design.md §3.
 *
 * Members see the room: the running archive of events. Everyone else sees the
 * door, and only if the group chose to be findable. There is no state in which
 * a non-member learns what events exist, let alone what is in them.
 */

import { groupSlug, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import {
  attendedEvery,
  findGroup,
  groupArchive,
  groupPeople,
  memberCount,
  membershipOf,
  participatedInGroup,
  titleFor,
  titleOf,
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
      /*
       * A door only ever exists for a findable room, and a findable room has
       * a name — search matches on it, so a nameless one cannot be found at
       * all. `titleFor` still stands behind this rather than `group.name!`,
       * because "cannot happen" and "is asserted not to happen" are different
       * sizes of claim and only one of them survives the next change.
       */
      name: titleFor(group.name, []).title,
      named: group.name,
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
  const [events, people, everyAlbum] = await Promise.all([
    groupArchive(db, group.id, actorId, since),
    groupPeople(db, group.id),
    attendedEvery(db, group.id),
  ]);

  /*
   * What this room is called to the person who opened it.
   *
   * Derived from `people` above rather than by asking again: it is the same
   * list, in the same order, and titling from a second query would be two
   * answers to one question waiting to disagree.
   */
  const identity = titleFor(
    group.name,
    people.filter((person) => person.actorId !== actorId),
  );

  return NextResponse.json({
    id: group.id,
    /** What to draw. A name if there is one, else who is in it. */
    name: identity.title,
    /**
     * The name as stored, null for a room nobody has named.
     *
     * The screen needs both: it draws `name` and it offers to *set* this one,
     * and "name this chat" and "rename this group" are different offers made
     * by the same control.
     */
    named: group.name,
    kind: identity.kind,
    memberCount: await memberCount(db, group.id),
    member: true,
    role: membership.role,
    findable: group.findable,
    events,
    /*
     * When the room started, which is the other half of the line under its
     * name: "34 albums · since Mar 2024". A count says how much is in here and
     * a date says how long it has been going, and a group's age is most of
     * what makes it feel like a room rather than a list.
     */
    createdAt: group.createdAt.toISOString(),
    /*
     * How many of them have been at every album — see `attendedEvery`. Null
     * for a group with no albums, where the answer is a technicality.
     */
    everyAlbum,
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

/**
 * Naming a room, or renaming one.
 *
 * The other half of making a chat out of people and nothing else. A room
 * arrives with no name and is titled from whoever is in it; this is how that
 * title gets replaced by one somebody chose — on the group's own page, once
 * the conversation has turned out to be a standing thing, which is the moment
 * a name is worth typing.
 *
 * ## Only a member, and only a room with more than two people in it
 *
 * The first is the ordinary rule. The second is the design: a conversation
 * with one person is called by their name and is not a room with a door on
 * it, so there is nothing here to name — naming it would turn a chat into a
 * group behind the other person's back, and put it on the Find shelf where
 * they never asked for it to be. A pair that wants to be a group adds
 * somebody.
 *
 * ## Clearing it is allowed, and goes back to the derived title
 *
 * An empty body name writes null, not `''`, which is exactly the distinction
 * the column exists to keep — see `schema.ts`. So a badly named room can be
 * put back to being called after its people rather than being stuck with a
 * name somebody regrets.
 *
 * The slug follows the name, including into null. A findable room that loses
 * its name loses its findability with it, because search matches on name and
 * a nameless row would sit in that index unmatchable — a flag that says yes
 * and means no.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const db = getDb();
  const group = await findGroup(db, id);
  if (!group) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const actorId = await currentActorId();
  const membership = await membershipOf(db, group.id, actorId);
  if (!membership) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length > 80) {
    return NextResponse.json({ error: 'name_too_long' }, { status: 400 });
  }

  if (name && (await memberCount(db, group.id)) < 3) {
    return NextResponse.json({ error: 'chat_not_nameable' }, { status: 409 });
  }

  await db
    .update(schema.groups)
    .set(
      name
        ? { name, slug: groupSlug(name) }
        : { name: null, slug: null, findable: false },
    )
    .where(eq(schema.groups.id, group.id));

  return NextResponse.json({
    id: group.id,
    name: await titleOf(db, { id: group.id, name: name || null }, actorId),
    named: name || null,
  });
}
