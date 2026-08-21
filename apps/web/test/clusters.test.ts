/**
 * The people who keep turning up — the observation `/groups` is built on.
 *
 * This is the one piece of derived social data in the product, so what it must
 * never do matters more than what it does. It is computed for one person, from
 * events that person is a participant of, and it is never written down, never
 * sent anywhere and never notified. The tests below are mostly about the
 * boundaries: a cluster must not appear for somebody who was not there, and it
 * must not name a person who cannot be put in a group.
 *
 * The clustering rule itself — people are grouped by the *exact set* of events
 * they share with the actor — is the other thing worth pinning. It is a
 * deliberate choice against overlap-based clustering, which has no natural
 * stopping point and ends up naming somebody you met once.
 */

import { PGlite } from '@electric-sql/pglite';
import { groupSlug, newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { invitable } from '@/friends';
import { addMember, recurringClusters, suggestedNameFrom } from '@/groups';

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "event", "event_participant",
      "group_member", "groups"
    restart identity cascade
  `);
});

/** An account, because a guest device is never offered as somebody to add. */
async function person(name: string) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${crypto.randomUUID()}@example.test` })
    .returning();
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: 'user', displayName: name, accountId: account!.id })
    .returning();
  return row!.id;
}

/** A device that never signed in. Present in events, absent from clusters. */
async function guest(name: string) {
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName: name })
    .returning();
  return row!.id;
}

async function event(name: string, createdBy: string, on?: string) {
  const [row] = await db
    .insert(schema.events)
    .values({
      name,
      linkToken: newLinkToken(),
      createdBy,
      ...(on ? { eventDate: on } : {}),
    })
    .returning();
  return row!.id;
}

async function wereThere(eventId: string, actorIds: string[]) {
  await db
    .insert(schema.eventParticipants)
    .values(actorIds.map((actorId) => ({ eventId, actorId })));
}

describe('what counts as a cluster', () => {
  it('needs two shared events, not one', async () => {
    const me = await person('Me');
    const once = await person('Once');
    const twice = await person('Twice');

    const a = await event('Naxos', me);
    const b = await event('Lisbon', me);
    await wereThere(a, [me, once, twice]);
    await wereThere(b, [me, twice]);

    const clusters = await recurringClusters(db, me);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.personIds).toEqual([twice]);
    // The person met once is not in it, anywhere — not as a face, not in the
    // names line. One evening together is not a pattern.
    expect(clusters[0]!.names).not.toContain('Once');
  });

  it('splits people who share different sets of events', async () => {
    const me = await person('Me');
    const [ana, ben, cal] = [await person('Ana'), await person('Ben'), await person('Cal')];

    const a = await event('One', me);
    const b = await event('Two', me);
    const c = await event('Three', me);
    // Ana and Ben at the same two; Cal at a different two.
    await wereThere(a, [me, ana, ben]);
    await wereThere(b, [me, ana, ben, cal]);
    await wereThere(c, [me, cal]);

    const clusters = await recurringClusters(db, me);
    expect(clusters).toHaveLength(2);
    const shapes = clusters.map((c) => c.personIds.slice().sort().join(','));
    expect(shapes).toContain([ana, ben].sort().join(','));
    expect(shapes).toContain(cal);
  });

  it('never names a guest device', async () => {
    const me = await person('Me');
    const real = await person('Real');
    const passing = await guest('Passing');

    const a = await event('One', me);
    const b = await event('Two', me);
    await wereThere(a, [me, real, passing]);
    await wereThere(b, [me, real, passing]);

    const clusters = await recurringClusters(db, me);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.personIds).toEqual([real]);
  });

  it('shows nothing to somebody who was not at the events', async () => {
    /*
     * The privacy boundary, stated directly. Two people share three evenings;
     * a third person who was at none of them asks the same question and learns
     * nothing — not the count, not the names, not that a cluster exists.
     */
    const [ana, ben, stranger] = [await person('Ana'), await person('Ben'), await person('Str')];
    for (const name of ['One', 'Two', 'Three']) {
      const id = await event(name, ana);
      await wereThere(id, [ana, ben]);
    }

    expect(await recurringClusters(db, stranger)).toEqual([]);
    expect(await recurringClusters(db, null)).toEqual([]);
    // And the pair themselves do see it, so the emptiness above is the rule
    // and not a broken query.
    expect(await recurringClusters(db, ana)).toHaveLength(1);
  });

  it('drops a cluster already gathered in one of your groups', async () => {
    const me = await person('Me');
    const ana = await person('Ana');
    const ben = await person('Ben');

    const a = await event('One', me);
    const b = await event('Two', me);
    await wereThere(a, [me, ana, ben]);
    await wereThere(b, [me, ana, ben]);

    expect(await recurringClusters(db, me)).toHaveLength(1);

    const [room] = await db
      .insert(schema.groups)
      .values({ name: 'Ours', slug: groupSlug('Ours') })
      .returning();
    for (const who of [me, ana, ben]) await addMember(db, room!.id, who);

    // This is what makes the section quiet enough not to need dismissal.
    expect(await recurringClusters(db, me)).toEqual([]);
  });

  it('shows at most two, the most-shared first', async () => {
    const me = await person('Me');
    const few = await person('Few');
    const some = await person('Some');
    const many = await person('Many');

    // Three distinct clusters: 2, 3 and 4 shared events.
    for (let i = 0; i < 4; i += 1) {
      const id = await event(`Many ${i}`, me);
      await wereThere(id, [me, many]);
    }
    for (let i = 0; i < 3; i += 1) {
      const id = await event(`Some ${i}`, me);
      await wereThere(id, [me, some]);
    }
    for (let i = 0; i < 2; i += 1) {
      const id = await event(`Few ${i}`, me);
      await wereThere(id, [me, few]);
    }

    const clusters = await recurringClusters(db, me);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.sharedEventCount)).toEqual([4, 3]);
  });
});

describe('what the card says', () => {
  it('counts the shared events and names three, then the rest', async () => {
    const me = await person('Me');
    const named = ['Ana Diaz', 'Ben Cole', 'Cal Ives', 'Dee Ray', 'Eve Nord'];
    const others = [];
    for (const name of named) others.push(await person(name));

    const a = await event('One', me);
    const b = await event('Two', me);
    await wereThere(a, [me, ...others]);
    await wereThere(b, [me, ...others]);

    const [cluster] = await recurringClusters(db, me);
    expect(cluster!.sharedEventCount).toBe(2);
    expect(cluster!.faces).toHaveLength(3);
    expect(cluster!.moreFaces).toBe(2);
    // First names, `+ N others` and not "and" — a set, not a sentence.
    expect(cluster!.names).toBe('Ana, Ben, Cal + 2 others');
  });

  it('is stable between two loads', async () => {
    // A card that changes places or reorders its faces reads as a feed. The
    // ordering is deterministic all the way down for that reason.
    const me = await person('Me');
    for (const name of ['Ana', 'Ben', 'Cal']) {
      const who = await person(name);
      const a = await event(`${name} one`, me);
      const b = await event(`${name} two`, me);
      await wereThere(a, [me, who]);
      await wereThere(b, [me, who]);
    }
    const first = await recurringClusters(db, me);
    const again = await recurringClusters(db, me);
    expect(again.map((c) => c.key)).toEqual(first.map((c) => c.key));
    expect(again.map((c) => c.names)).toEqual(first.map((c) => c.names));
  });
});

describe('the name the form offers', () => {
  const when = new Date('2025-09-14T00:00:00Z');

  it('dates a name that has no year', () => {
    expect(suggestedNameFrom('Naxos', when)).toBe('Naxos 2025');
  });

  it('drops a trailing month, because the year is about to replace it', () => {
    // "Naxos, September 2025" is a filing reference. "Naxos 2025" is a name.
    expect(suggestedNameFrom('Naxos, September', when)).toBe('Naxos 2025');
  });

  it('leaves a name that already carries a year alone', () => {
    expect(suggestedNameFrom('Naxos 2024', when)).toBe('Naxos 2024');
  });

  it('refuses a generic name rather than dating it', () => {
    /*
     * "Photos 2025" names every group the same. Refusing gives the form an
     * empty field and a placeholder, which is the documented path — a name you
     * have to fix is more work than a name you have to write.
     */
    for (const generic of ['Photos', 'party', 'Untitled', '  dinner  ']) {
      expect(suggestedNameFrom(generic, when)).toBeNull();
    }
    expect(suggestedNameFrom(null, when)).toBeNull();
    expect(suggestedNameFrom('   ', when)).toBeNull();
  });

  it('borrows from the most recent shared event', async () => {
    const me = await person('Me');
    const ana = await person('Ana');
    const older = await event('Lisbon', me, '2024-05-01');
    const newer = await event('Naxos', me, '2025-09-14');
    await wereThere(older, [me, ana]);
    await wereThere(newer, [me, ana]);

    const [cluster] = await recurringClusters(db, me);
    expect(cluster!.suggestedName).toBe('Naxos 2025');
  });
});

/**
 * Creating from people, at the level the route works at.
 *
 * The route itself needs a session, so what is proven here is the rule it
 * delegates to: `invitable` decides who may actually be put in a group, and it
 * is the same predicate the member search and the invite route apply. A
 * hand-written `memberIds` reaches this and nothing else.
 */
describe('who may be put in a group', () => {
  it('refuses a guest device and a block, and accepts an account', async () => {
    const me = await person('Me');
    const friend = await person('Friend');
    const blocked = await person('Blocked');
    const passing = await guest('Passing');

    await db
      .insert(schema.blocks)
      .values({ blockerActorId: blocked, blockedActorId: me });

    expect(await invitable(db, me, friend)).toBe(true);
    // A device that never signed in: being added has to mean something that
    // survives the browser it happened in.
    expect(await invitable(db, me, passing)).toBe(false);
    // Either direction of a block, so a cluster cannot be used to route around
    // somebody having said no.
    expect(await invitable(db, me, blocked)).toBe(false);
    expect(await invitable(db, me, me)).toBe(false);
  });
});
