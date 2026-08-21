/**
 * Create a group — docs/design.md §3.
 *
 * Made from an event rather than from nothing. "The same people keep doing
 * things together" is a thing you notice afterwards, so the flow is roll this
 * event into a group, not create an empty group and then fill it. The event's
 * existing participants are not auto-enrolled: membership is opt-in, and
 * conscripting everyone who once opened a link would make it the opposite.
 */

import { groupSlug, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { findEventById, guard, isSignedIn, toResponse } from '@/access';
import { accountFor } from '@/accounts';
import { getDb } from '@/db';
import { invitable } from '@/friends';
import { addMember, groupsFor, myGroups } from '@/groups';
import { notifyGroupAdded } from '@/notify';
import { currentActorId, requesterFor } from '@/session';

export const runtime = 'nodejs';

/**
 * The groups this actor is in.
 *
 * Answers an empty list rather than 403 for someone with no actor yet: having
 * no groups and not existing look the same from here, and they should — the
 * app asks this on launch, before anyone has contributed anything.
 *
 * ## Two shapes, and why the cheap one is the default
 *
 * `?detail=1` adds what a group screen needs to tell two rooms apart: how many
 * events are in it, how many people, and when anything last happened. Those
 * are three aggregates per group, and the caller that asks this question most
 * often is the native client at launch — before anybody has opened a group
 * screen, and possibly before they have any groups at all.
 *
 * So the default stays a name and a role, and the screen that draws the fuller
 * line asks for it when somebody opens it. A flag rather than a second route
 * because it is the same question about the same rows; a second route would be
 * two places for the membership rule to be written.
 */
export async function GET(request: Request) {
  const db = getDb();
  const actorId = await currentActorId();
  const detail = new URL(request.url).searchParams.get('detail') === '1';

  return NextResponse.json({
    groups: detail ? await myGroups(db, actorId) : await groupsFor(db, actorId),
  });
}

/** A group made from people rather than from an event. See `POST`. */
async function fromPeople(
  name: string,
  findable: boolean,
  memberIds: string[],
): Promise<Response> {
  const db = getDb();
  const actorId = await currentActorId();
  // Signed in, not merely present: a group belongs to an account, and a guest
  // device making one would be a room that disappears with a browser.
  if (!actorId || !(await isSignedIn(db, actorId))) {
    return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });
  }

  /*
   * Who may actually be put in, decided before anything is written.
   *
   * `invitable` is the same predicate the invite route and the member search
   * apply: an account rather than a passing device, and no block either way.
   * Filtered rather than refused, because the caller's list comes from a
   * cluster the server itself suggested and one stale id should not lose the
   * group — but the filtering is what stops a hand-written `memberIds` from
   * conscripting anybody who has blocked you.
   */
  const targets: string[] = [];
  for (const id of [...new Set(memberIds)]) {
    if (id === actorId) continue;
    if (!(await invitable(db, actorId, id))) continue;
    targets.push(id);
  }

  const [group] = await db
    .insert(schema.groups)
    .values({ name, slug: groupSlug(name), findable })
    .returning();

  await addMember(db, group!.id, actorId, 'admin');
  for (const id of targets) await addMember(db, group!.id, id);

  /*
   * Told after the writing, never before.
   *
   * Nothing is sent while the form is on screen — tapping a chip notifies
   * nobody — so this is the single moment anybody learns the group exists.
   * Doing it last means a failure above sends nothing, which is the right way
   * round: a notification about a group that was not created cannot be undone.
   */
  const me = await accountFor(db, actorId);
  if (targets.length > 0) {
    await notifyGroupAdded(db, {
      actorIds: targets,
      groupId: group!.id,
      groupName: group!.name,
      who: me?.displayName?.trim() || 'Somebody',
    });
  }

  return NextResponse.json(
    { id: group!.id, name: group!.name, findable: group!.findable },
    { status: 201 },
  );
}

/**
 * Make a group — two ways, and they are not the same act.
 *
 * **From an event** (`fromEventId`) is the original: the event moves under the
 * group and its people are left alone to join in their own time. It is the
 * roll-up, and everything below the branch is still it.
 *
 * **From people** (`memberIds`) is new, and it is what `/groups` offers beside
 * a cluster of people you keep ending up in events with. It writes memberships
 * outright rather than invitations — see `fromPeople` — because everyone in
 * that list already has the photographs from the events the cluster was
 * derived from. Asking eleven people to accept a room they are effectively
 * already in is a formality that arrives as eleven chores.
 *
 * That is a real change in what creating a group does to other people, so the
 * form states it in the sentence above the button rather than after it: "They
 * are told when the group is made, and can add photos without being invited
 * again." The notification is the other half of the same promise.
 *
 * Neither shape is required to carry the other. A body with both is treated as
 * a roll-up, because that path also moves an event and is the more specific
 * request.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    fromEventId?: unknown;
    findable?: unknown;
    memberIds?: unknown;
  };

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) {
    return NextResponse.json({ error: 'name_required' }, { status: 400 });
  }

  if (typeof body.fromEventId !== 'string') {
    const memberIds = Array.isArray(body.memberIds)
      ? body.memberIds.filter((id): id is string => typeof id === 'string')
      : null;
    // A group with nobody in it but you is still a group — the quiet "make a
    // group from anyone" link makes exactly that. An absent `memberIds` is
    // the old call with no event, though, and that is still a mistake.
    if (memberIds) {
      return fromPeople(name, body.findable === true, memberIds);
    }
    return NextResponse.json({ error: 'event_required' }, { status: 400 });
  }

  const db = getDb();
  const event = await findEventById(db, body.fromEventId);
  if (!event) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (event.groupId) {
    return NextResponse.json({ error: 'already_grouped' }, { status: 409 });
  }

  const requester = await requesterFor(event.id);
  try {
    await guard(db, event, 'administer', requester);
  } catch (err) {
    return toResponse(err);
  }

  const actorId = (await currentActorId())!;

  const [group] = await db
    .insert(schema.groups)
    .values({
      name,
      slug: groupSlug(name),
      // Asked once, at creation, and defaulting closed. Clubs and teams say
      // yes; friend groups do not, and nobody chose to make their house a
      // public entity.
      findable: body.findable === true,
    })
    .returning();

  await addMember(db, group!.id, actorId, 'admin');

  // The event moves under the group, so its photos become part of a running
  // archive rather than another orphaned link.
  await db
    .update(schema.events)
    .set({
      groupId: group!.id,
      // Grouped events do not expire — the retention lever only applies to
      // one-offs (design §15).
      expiresAt: null,
    })
    .where(eq(schema.events.id, event.id));

  return NextResponse.json(
    { id: group!.id, name: group!.name, findable: group!.findable },
    { status: 201 },
  );
}
