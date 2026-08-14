/**
 * Home — what the list contains, in what order, and what a search matches.
 *
 * There was briefly a hero with a rule about which event was "live" enough to
 * lead the page; the grid is uniform now and the rule went with it. What is
 * left is the two things that are still decisions: the order, and the counts
 * a card draws.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { eventsFor } from '@/events';
import { matches, searchable } from '@/search';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

const NOW = new Date('2026-08-13T21:00:00Z');

describe('the order the list comes back in', () => {
  let db: Db;

  beforeAll(async () => {
    db = drizzle(new PGlite(), { schema }) as unknown as Db;
    await migrate(db as never, { migrationsFolder: MIGRATIONS });
  });

  beforeEach(async () => {
    const { sql } = await import('drizzle-orm');
    await db.execute(sql`truncate "actor", "event", "event_participant" restart identity cascade`);
  });

  /** An event this actor is in, with a place and a last-active time. */
  async function event(name: string, place: string | null, activeAt: Date, actorId: string) {
    const [row] = await db
      .insert(schema.events)
      .values({ name, place, linkToken: name, lastActiveAt: activeAt, createdBy: actorId })
      .returning();
    await db
      .insert(schema.eventParticipants)
      .values({ eventId: row!.id, actorId });
    return row!.id;
  }

  async function person() {
    const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    return actor!.id;
  }

  it('is most recently added to first, by default', async () => {
    const me = await person();
    await event('older', 'Zanzibar', new Date(NOW.getTime() - 3600_000), me);
    await event('newer', 'Aberdeen', NOW, me);

    const names = (await eventsFor(db, me)).map((e) => e.name);
    expect(names).toEqual(['newer', 'older']);
  });

  it('puts an event with no place in the list like any other', async () => {
    // There was briefly a second ordering, alphabetical by place, which had to
    // decide where a placeless event went. There is one order now — activity —
    // and a missing place is not a fact about when something happened.
    const me = await person();
    await event('nowhere', null, NOW, me);
    await event('somewhere', 'Zanzibar', new Date(NOW.getTime() - 60_000), me);

    const names = (await eventsFor(db, me)).map((e) => e.name);
    expect(names).toEqual(['nowhere', 'somewhere']);
  });

  it('counts contributors and arrivals apart from members', async () => {
    /*
     * Three different numbers that a card has been known to conflate. A member
     * is anybody who opened the link; a contributor put something in; an
     * arrival has not finished being processed and is in neither of the other
     * two counts, because it cannot be looked at yet.
     */
    const me = await person();
    const them = await person();
    const id = await event('mixed', null, NOW, me);
    await db.insert(schema.eventParticipants).values({ eventId: id, actorId: them });

    await db.insert(schema.photos).values([
      { eventId: id, uploaderId: me, storageKey: 'a', byteSize: 1, mime: 'image/jpeg', status: 'ready' },
      { eventId: id, uploaderId: me, storageKey: 'b', byteSize: 1, mime: 'image/jpeg', status: 'ready' },
      { eventId: id, uploaderId: them, storageKey: 'c', byteSize: 1, mime: 'image/jpeg', status: 'pending' },
    ]);

    const [listing] = await eventsFor(db, me);
    expect(listing!.memberCount, 'members').toBe(2);
    expect(listing!.contributorCount, 'contributors').toBe(1);
    expect(listing!.photoCount, 'photos').toBe(2);
    expect(listing!.arrivingCount, 'arriving').toBe(1);
  });
});

describe('searching your own events', () => {
  const of = (name: string, place: string | null = null) => searchable({ name, place });

  it('matches anywhere in the name, not just the start', () => {
    /*
     * Deliberately unlike the handle search in `friends.ts`, which is
     * prefix-only because a substring match there sweeps the account table
     * with two common letters. This runs over a list the server already
     * decided this person may see — their own events, already on the page —
     * so there is nothing here that a match could disclose.
     */
    expect(matches(of('Sarah’s birthday'), 'birth')).toBe(true);
    expect(matches(of('Sarah’s birthday'), 'sarah')).toBe(true);
  });

  it('ignores case, because nobody capitalises a search', () => {
    expect(matches(of('Kefalonia, June'), 'KEFALONIA')).toBe(true);
  });

  it('searches the place as well as the name', () => {
    // This is what let "By place" go: a whole-list re-ordering existed to
    // answer "the Greece one", and typing it answers that without moving
    // anything.
    expect(matches(of('Sunday roast', 'The Anchor'), 'anchor')).toBe(true);
  });

  it('takes terms in any order, and not necessarily adjacent', () => {
    // The two words somebody remembers are rarely next to each other, and
    // rarely in the order they were written.
    expect(matches(of('Sunday roast', 'The Anchor'), 'anchor roast')).toBe(true);
    expect(matches(of('Sunday roast', 'The Anchor'), 'roast anchor')).toBe(true);
  });

  it('needs every term, not any of them', () => {
    // `some` here would make a second word widen the search instead of
    // narrowing it, which is the opposite of what typing more means.
    expect(matches(of('Sunday roast', 'The Anchor'), 'roast kefalonia')).toBe(false);
  });

  it('matches everything when there is nothing to match', () => {
    // What lets the caller filter unconditionally rather than branch on
    // whether a search is running.
    expect(matches(of('Anything'), '')).toBe(true);
    expect(matches(of('Anything'), '   ')).toBe(true);
  });

  it('does not fall over an event with no place', () => {
    expect(matches(of('Just a name', null), 'name')).toBe(true);
    expect(matches(of('Just a name', null), 'null')).toBe(false);
  });
});
