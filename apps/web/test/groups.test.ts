/**
 * Groups — docs/design.md §3.
 *
 * Two things are worth pinning here. The access rule ("groups can be findable,
 * photos never are") is the only discovery surface in the product, so what a
 * stranger can learn is tested directly. And group membership is what keeps
 * people in an event across a link rotation, which is the payoff that makes a
 * group worth joining at all.
 */

import { PGlite } from '@electric-sql/pglite';
import { authorize, groupSlug, newLinkToken, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { decide } from '@/access';
import type { Db } from '@/db';
import {
  addMember,
  groupEvents,
  memberCount,
  groupsFor,
  membershipOf,
  participatedInGroup,
  searchGroups,
} from '@/groups';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "code", "derivative", "device",
      "event", "event_participant", "group_join_request", "group_member",
      "groups", "photo", "report", "safety_incident"
    restart identity cascade
  `);
});

async function actor() {
  const [row] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  return row!.id;
}

/** Membership is not a substitute for signing in — `contribute` needs both. */
async function signedInActor() {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${crypto.randomUUID()}@example.test` })
    .returning();
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', accountId: account!.id })
    .returning();
  return row!.id;
}

async function group(name: string, findable = false) {
  const [row] = await db
    .insert(schema.groups)
    .values({ name, slug: groupSlug(name), findable })
    .returning();
  return row!;
}

async function eventIn(groupId: string | null, createdBy: string) {
  const [row] = await db
    .insert(schema.events)
    .values({ name: 'Dinner', linkToken: newLinkToken(), createdBy, groupId })
    .returning();
  return row!;
}

describe('search returns a door, not a room', () => {
  it('finds a findable group by name, with only a name and a count', async () => {
    const house = await group('The Flat', true);
    await addMember(db, house.id, await actor());
    await addMember(db, house.id, await actor());

    const results = await searchGroups(db, 'flat');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      id: house.id,
      name: 'The Flat',
      memberCount: 2,
    });
    // No events, no photos, no member names — by construction, not by filtering.
    expect(Object.keys(results[0]!).sort()).toEqual(['id', 'memberCount', 'name']);
  });

  it('does not return unfindable groups at all', async () => {
    // Absent rather than filtered: a query must not be able to confirm that a
    // private group with a given name exists.
    await group('The Flat', false);
    expect(await searchGroups(db, 'flat')).toEqual([]);
  });

  it('ignores very short queries rather than listing everything', async () => {
    await group('The Flat', true);
    expect(await searchGroups(db, 'a')).toEqual([]);
    expect(await searchGroups(db, ' ')).toEqual([]);
  });

  it('treats wildcards as literal text', async () => {
    await group('The Flat', true);
    await group('100% Club', true);
    expect(await searchGroups(db, '%')).toEqual([]);
    expect((await searchGroups(db, '100%')).map((g) => g.name)).toEqual(['100% Club']);
  });

  it('has no equivalent for events or photos', async () => {
    // Enforced structurally: there is no event or photo search function to
    // call. This test exists so deleting that property is a visible act.
    const groupsModule = await import('@/groups');
    expect(Object.keys(groupsModule).filter((k) => /search/i.test(k))).toEqual([
      'searchGroups',
    ]);
  });
});

describe('joining', () => {
  it('lets someone who took part in an event join without approval', async () => {
    // They already had those photos. Joining only says "keep me in the loop".
    const house = await group('The Flat');
    const host = await actor();
    const guest = await actor();
    const event = await eventIn(house.id, host);
    await db
      .insert(schema.eventParticipants)
      .values({ eventId: event.id, actorId: guest });

    expect(await participatedInGroup(db, house.id, guest)).toBe(true);
  });

  it('gives no standing to someone who only holds a link', async () => {
    const house = await group('The Flat');
    const host = await actor();
    await eventIn(house.id, host);
    expect(await participatedInGroup(db, house.id, await actor())).toBe(false);
  });

  it('does not count participation in an unrelated event', async () => {
    const house = await group('The Flat');
    const other = await actor();
    const loose = await eventIn(null, other);
    await db
      .insert(schema.eventParticipants)
      .values({ eventId: loose.id, actorId: other });
    expect(await participatedInGroup(db, house.id, other)).toBe(false);
  });

  it('is idempotent, and leaving works', async () => {
    const house = await group('The Flat');
    const person = await actor();
    await addMember(db, house.id, person);
    await addMember(db, house.id, person);
    expect(await memberCount(db, house.id)).toBe(1);

    await db
      .delete(schema.groupMembers)
      .where(eq(schema.groupMembers.actorId, person));
    expect(await memberCount(db, house.id)).toBe(0);
  });

  it('allows only one open request per person', async () => {
    const house = await group('The Flat', true);
    const person = await actor();
    const values = { groupId: house.id, actorId: person };
    await db.insert(schema.groupJoinRequests).values(values);
    await db.insert(schema.groupJoinRequests).values(values).onConflictDoNothing();

    const open = await db.select().from(schema.groupJoinRequests);
    expect(open).toHaveLength(1);
  });

  it('lets a declined person ask again later', async () => {
    // The unique index only covers open requests, so a decline is not a
    // permanent ban.
    const house = await group('The Flat', true);
    const person = await actor();
    const [first] = await db
      .insert(schema.groupJoinRequests)
      .values({ groupId: house.id, actorId: person })
      .returning();
    await db
      .update(schema.groupJoinRequests)
      .set({ status: 'declined', resolvedAt: new Date() })
      .where(eq(schema.groupJoinRequests.id, first!.id));

    await expect(
      db.insert(schema.groupJoinRequests).values({ groupId: house.id, actorId: person }),
    ).resolves.toBeDefined();
  });
});

describe('what membership buys', () => {
  it('reaches the next event without anyone being invited', async () => {
    // The distribution answer: a member has access to an event created in the
    // group, holding no link and having done nothing.
    const house = await group('The Flat');
    const host = await actor();
    const member = await signedInActor();
    await addMember(db, house.id, host, 'admin');
    await addMember(db, house.id, member);

    const event = await eventIn(house.id, host);
    expect(await decide(db, event, 'view', { actorId: member })).toEqual({
      allow: true,
    });
    expect(await decide(db, event, 'contribute', { actorId: member })).toEqual({
      allow: true,
    });
  });

  it('survives a link rotation, unlike a capability cookie', async () => {
    const house = await group('The Flat');
    const host = await actor();
    const member = await actor();
    await addMember(db, house.id, member);
    const event = await eventIn(house.id, host);

    const [rotated] = await db
      .update(schema.events)
      .set({ linkToken: newLinkToken(), capEpoch: event.capEpoch + 1 })
      .where(eq(schema.events.id, event.id))
      .returning();

    expect(await decide(db, rotated!, 'view', { actorId: member })).toEqual({
      allow: true,
    });
  });

  it('does not make a member an administrator', async () => {
    const house = await group('The Flat');
    const host = await actor();
    const member = await actor();
    await addMember(db, house.id, member);
    const event = await eventIn(house.id, host);

    expect(await decide(db, event, 'administer', { actorId: member })).toEqual({
      allow: false,
      reason: 'not_administrator',
    });
  });

  it('an admin of the group administers its events', async () => {
    const house = await group('The Flat');
    const host = await actor();
    const admin = await actor();
    await addMember(db, house.id, admin, 'admin');
    const event = await eventIn(house.id, host);

    expect(await decide(db, event, 'administer', { actorId: admin })).toEqual({
      allow: true,
    });
  });

  it('carries each event’s window, so auto-selection survives the trip', async () => {
    // A client opening an event from the group archive has nothing else to
    // learn the window from. Without these every grouped event silently
    // falls through to the system picker — the app's whole justification,
    // lost to a missing column in a select.
    const host = await actor();
    const club = await group('Climbing');
    const [event] = await db
      .insert(schema.events)
      .values({
        name: 'Peak trip',
        linkToken: newLinkToken(),
        createdBy: host,
        groupId: club.id,
        startsAt: new Date('2026-07-18T18:00:00Z'),
        endsAt: new Date('2026-07-19T02:00:00Z'),
      })
      .returning();

    const [row] = await groupEvents(db, club.id);
    expect(row!.id).toBe(event!.id);
    expect(row!.startsAt).not.toBeNull();
    expect(row!.endsAt).not.toBeNull();
  });

  it('lists the group’s events and nothing else', async () => {
    const house = await group('The Flat');
    const host = await actor();
    await eventIn(house.id, host);
    await eventIn(null, host);

    const events = await groupEvents(db, house.id);
    expect(events).toHaveLength(1);
    // Events, never photos: a photo is only reachable through an event.
    expect(Object.keys(events[0]!)).not.toContain('photos');
  });

  it('hides a deleted event from the archive', async () => {
    const house = await group('The Flat');
    const host = await actor();
    const event = await eventIn(house.id, host);
    await db
      .update(schema.events)
      .set({ deletedAt: new Date() })
      .where(eq(schema.events.id, event.id));
    expect(await groupEvents(db, house.id)).toHaveLength(0);
  });
});

describe('the groups an actor is in', () => {
  it('is empty for someone who has never contributed', async () => {
    // Asked on every launch of the app, before anyone has done anything.
    // Empty is the answer, not an error.
    expect(await groupsFor(db, null)).toEqual([]);
    expect(await groupsFor(db, await actor())).toEqual([]);
  });

  it('lists membership, with the role', async () => {
    const person = await actor();
    const club = await group('Climbing');
    await addMember(db, club.id, person, 'admin');

    const mine = await groupsFor(db, person);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: club.id, name: 'Climbing', role: 'admin' });
  });

  it('lists only this actor’s groups', async () => {
    const person = await actor();
    const other = await actor();
    await addMember(db, (await group('Mine')).id, person);
    await addMember(db, (await group('Theirs')).id, other);

    expect((await groupsFor(db, person)).map((g) => g.name)).toEqual(['Mine']);
  });

  it('includes unfindable groups, which search never would', async () => {
    // Findability governs discovery by strangers, not whether you can see
    // what you are already in. Most groups are unfindable.
    const person = await actor();
    const secret = await group('The Flat', false);
    await addMember(db, secret.id, person);

    expect((await groupsFor(db, person)).map((g) => g.name)).toEqual(['The Flat']);
    expect(await searchGroups(db, 'The Flat')).toEqual([]);
  });

  it('drops a group that has been deleted', async () => {
    const person = await actor();
    const gone = await group('Old');
    await addMember(db, gone.id, person);
    await db
      .update(schema.groups)
      .set({ deletedAt: new Date() })
      .where(eq(schema.groups.id, gone.id));

    expect(await groupsFor(db, person)).toEqual([]);
  });

  it('drops a group after leaving it', async () => {
    const person = await actor();
    const club = await group('Climbing');
    await addMember(db, club.id, person);
    await db
      .delete(schema.groupMembers)
      .where(eq(schema.groupMembers.actorId, person));

    expect(await groupsFor(db, person)).toEqual([]);
  });
});

describe('slugs', () => {
  it('are system-suffixed, so a name cannot be owned', () => {
    const a = groupSlug('The Flat');
    const b = groupSlug('The Flat');
    expect(a).not.toBe(b);
    expect(a.startsWith('the-flat-')).toBe(true);
  });

  it('survive names that are entirely punctuation', () => {
    expect(groupSlug('!!!').startsWith('group-')).toBe(true);
  });
});

describe('membership lookup', () => {
  it('returns null for an anonymous viewer', async () => {
    const house = await group('The Flat');
    expect(await membershipOf(db, house.id, null)).toBeNull();
  });

  it('distinguishes a member from an admin', async () => {
    const house = await group('The Flat');
    const member = await actor();
    const admin = await actor();
    await addMember(db, house.id, member);
    await addMember(db, house.id, admin, 'admin');

    expect(await membershipOf(db, house.id, member)).toEqual({ role: 'member' });
    expect(await membershipOf(db, house.id, admin)).toEqual({ role: 'admin' });
  });
});

describe('authorize, on group facts alone', () => {
  it('admits a group member with no credential presented', () => {
    // Pure check that the policy honours membership, independent of the
    // database plumbing above.
    const decision = authorize(
      { id: 'a', hasAccount: true },
      'view',
      {
        event: {
          id: 'e',
          linkToken: 'x'.repeat(22),
          capEpoch: 1,
          accessPolicy: 'link_open',
          joinsOpen: false,
          uploadsOpen: true,
          createdBy: 'someone-else',
          groupId: 'g',
          deletedAt: null,
        },
      },
      { isGroupMember: true },
    );
    expect(decision).toEqual({ allow: true });
  });
});
