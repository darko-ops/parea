/**
 * The bounds that do not depend on the caller's cookie — design §7.8.
 *
 * The per-actor cap is tested in `quota.test.ts`. What is tested here is the
 * hole it left: an actor is minted on demand and costs nothing, so a cap
 * counted per actor is a cap on honesty. Two things close it — a per-event
 * total, and a rate per source — and both need to bound the hostile case
 * without touching the case the product exists for, which is twenty people on
 * one venue wifi uploading at once.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { and, count, eq, isNull, sql, sum } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CREATE_EVENT_LIMIT,
  PRESIGN_LIMIT,
  consume,
  expiredBefore,
  staleRateLimits,
} from '../src/ratelimit';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: any;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "code", "derivative", "device",
      "event", "event_participant", "group_join_request", "group_member",
      "groups", "photo", "rate_limit", "report", "safety_incident"
    restart identity cascade
  `);
});

const TINY = { name: 'test', max: 3, windowSeconds: 3600 };

describe('the counter', () => {
  it('allows up to the limit and refuses past it', async () => {
    const verdicts = [];
    for (let i = 0; i < 5; i++) verdicts.push(await consume(db, 'a', TINY));
    expect(verdicts.map((v) => v.allowed)).toEqual([true, true, true, false, false]);
  });

  it('counts each source separately', async () => {
    for (let i = 0; i < 3; i++) await consume(db, 'a', TINY);
    // One noisy source must not lock out everyone else — and on a shared
    // address, "everyone else" is the rest of the party.
    expect((await consume(db, 'b', TINY)).allowed).toBe(true);
  });

  it('counts each limit separately', async () => {
    for (let i = 0; i < 3; i++) await consume(db, 'a', TINY);
    expect((await consume(db, 'a', { ...TINY, name: 'other' })).allowed).toBe(true);
  });

  it('starts a fresh window once the old one has passed', async () => {
    for (let i = 0; i < 3; i++) await consume(db, 'a', TINY);
    expect((await consume(db, 'a', TINY)).allowed).toBe(false);

    // What the clock would do, done to the row instead.
    await db.execute(sql`
      update "rate_limit" set "window_start" = now() - interval '2 hours'
    `);

    const fresh = await consume(db, 'a', TINY);
    expect(fresh.allowed).toBe(true);
    expect(fresh.count, 'the window restarted rather than continuing').toBe(1);
  });

  it('does not lose counts when requests arrive together', async () => {
    // The reason this is one statement rather than read-then-write. Concurrent
    // requests are exactly what a limiter exists to notice, and each of them
    // reading the same count before any of them writes is how a limiter comes
    // to allow ten of everything.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => consume(db, 'a', TINY)),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    expect(new Set(results.map((r) => r.count)).size, 'every count distinct').toBe(10);
  });
});

describe('the limits themselves', () => {
  it('leaves room for a party on one shared address', async () => {
    // Twenty people, 200 photos each, 50 files a request: 80 requests from one
    // NAT address. If this ever starts refusing that, the limit is wrong and
    // the answer is not to quietly raise it after someone's wedding.
    expect(PRESIGN_LIMIT.max).toBeGreaterThan(80 * 2);
  });

  it('bounds event creation, since every other cap is per event', async () => {
    expect(CREATE_EVENT_LIMIT.max).toBeLessThan(PRESIGN_LIMIT.max);
    expect(CREATE_EVENT_LIMIT.max).toBeGreaterThan(5);
  });

  it('stores no address, only something derived from one', async () => {
    // The table is opaque by construction: nothing in it is personal data to
    // retain, disclose or delete.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(fileURLToPath(new URL('../src/ratelimit.ts', import.meta.url)), 'utf8'),
    );
    expect(source).toMatch(/createHmac\('sha256', secret\)/);
    expect(source).not.toMatch(/values \(\$\{address\}/);
  });
});

describe('cleanup', () => {
  it('marks closed windows as removable and leaves live ones alone', async () => {
    await consume(db, 'live', TINY);
    await consume(db, 'old', TINY);
    await db.execute(sql`
      update "rate_limit" set "window_start" = now() - interval '2 hours'
      where "bucket" = 'test:old'
    `);

    const removed = await db
      .delete(schema.rateLimits)
      .where(staleRateLimits(expiredBefore(new Date())))
      .returning();

    expect(removed.map((r: any) => r.bucket)).toEqual(['test:old']);
  });
});

// --- the per-event cap ------------------------------------------------------

/** Mirrors `used()` in the uploads route, with and without an actor. */
async function used(eventId: string, actorId?: string) {
  const [row] = await db
    .select({ photos: count(), bytes: sum(schema.photos.byteSize) })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.eventId, eventId),
        actorId ? eq(schema.photos.uploaderId, actorId) : undefined,
        isNull(schema.photos.deletedAt),
      ),
    );
  return { photos: row?.photos ?? 0, bytes: Number(row?.bytes ?? 0) };
}

async function scene() {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: actor.id })
    .returning();
  return { actor: actor.id, event: event.id };
}

async function photo(eventId: string, uploaderId: string, bytes = 1000) {
  await db.insert(schema.photos).values({
    eventId,
    uploaderId,
    storageKey: `k-${Math.random()}`,
    byteSize: bytes,
    mime: 'image/jpeg',
    status: 'ready',
  });
}

describe('the per-event total', () => {
  it('counts every actor, so a fresh cookie buys nothing', async () => {
    // The bypass this closes. Three actors is three cookies, and the event
    // total is the same either way.
    const { actor, event } = await scene();
    const others = await Promise.all(
      [0, 1].map(async () => {
        const [a] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
        return a.id;
      }),
    );
    for (const id of [actor, ...others]) await photo(event, id, 1000);

    expect(await used(event)).toEqual({ photos: 3, bytes: 3000 });
    expect((await used(event, actor)).photos, 'while the per-actor view is unchanged')
      .toBe(1);
  });

  it('is per event, so one full event does not close another', async () => {
    const { actor, event } = await scene();
    await photo(event, actor, 9999);
    const second = await scene();
    expect(await used(second.event)).toEqual({ photos: 0, bytes: 0 });
  });

  it('is enforced in the route against the whole-event total', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        fileURLToPath(new URL('../app/api/events/[id]/uploads/route.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(source).toContain('MAX_PHOTOS_PER_EVENT = 20_000');
    expect(source).toMatch(/used\(db, event\.id\)/);
    expect(source).toMatch(/total\.photos \+ files\.length > MAX_PHOTOS_PER_EVENT/);
    expect(source).toMatch(/total\.bytes \+ incomingBytes > MAX_BYTES_PER_EVENT/);
  });

  it('sits far above a large real event and far below a filled bucket', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        fileURLToPath(new URL('../app/api/events/[id]/uploads/route.ts', import.meta.url)),
        'utf8',
      ),
    );
    // A big wedding is a few thousand photos across thirty people.
    expect(source).toContain('MAX_PHOTOS_PER_EVENT = 20_000');
    expect(source).toContain('MAX_BYTES_PER_EVENT = 100 * 1024 * 1024 * 1024');
  });
});
