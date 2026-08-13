/**
 * Home — who gets the top of the page, and what the list is ordered by.
 *
 * The hero is the only place in the product that makes a claim about the
 * present tense. "STILL COMING IN" over an event nobody has touched since
 * Tuesday is the kind of wrong that erodes every other thing the interface
 * says, so the rule that decides it is worth pinning.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { CardEvent } from '@/cards';
import type { Db } from '@/db';
import { eventsFor } from '@/events';
import { isLive, LIVE_WINDOW_MS } from '@/../app/components/EventHero';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

const NOW = new Date('2026-08-13T21:00:00Z');

/** Only the fields the hero rule reads; the rest of a card is irrelevant. */
function card(over: Partial<CardEvent> = {}): CardEvent {
  return {
    id: 'e', name: 'An evening', photoCount: 0, mosaic: [], meta: '',
    place: null, contributorCount: 0, memberCount: 1, arrivingCount: 0,
    lastActiveAt: NOW.toISOString(),
    ...over,
  };
}

describe('which event leads the page', () => {
  it('is live while photos are mid-flight, however old the last one was', () => {
    // Somebody uploading right now is the strongest possible signal, and it
    // arrives before `lastActiveAt` moves — the row is only touched once a
    // photo is ready, so an upload of 200 photos would sit outside the window
    // for as long as it takes to send the first one.
    const stale = new Date(NOW.getTime() - 30 * 24 * 3600_000).toISOString();
    expect(isLive(card({ arrivingCount: 12, lastActiveAt: stale }), NOW)).toBe(true);
  });

  it('is live for an hour after the last photo landed', () => {
    const justInside = new Date(NOW.getTime() - LIVE_WINDOW_MS + 1000).toISOString();
    const justOutside = new Date(NOW.getTime() - LIVE_WINDOW_MS - 1000).toISOString();
    expect(isLive(card({ lastActiveAt: justInside }), NOW)).toBe(true);
    expect(isLive(card({ lastActiveAt: justOutside }), NOW)).toBe(false);
  });

  it('is not live for an event whose clock is ahead of ours', () => {
    // Server and browser clocks disagree, and a future timestamp must read as
    // recent rather than as an error — it is inside the window either way.
    const future = new Date(NOW.getTime() + 5 * 60_000).toISOString();
    expect(isLive(card({ lastActiveAt: future }), NOW)).toBe(true);
  });
});

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

  it('is alphabetical by place when asked, with the placeless last', async () => {
    // Last, not first. An event with no place is the one this sort has
    // nothing to say about, and putting it at the top makes the first screen
    // the least useful one.
    const me = await person();
    await event('nowhere', null, NOW, me);
    await event('zed', 'Zanzibar', NOW, me);
    await event('abe', 'Aberdeen', NOW, me);

    const names = (await eventsFor(db, me, 'place')).map((e) => e.name);
    expect(names).toEqual(['abe', 'zed', 'nowhere']);
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
