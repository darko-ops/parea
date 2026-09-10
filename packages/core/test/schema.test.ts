/**
 * Schema behaviour, against a real Postgres.
 *
 * PGlite runs Postgres in-process, so the migrations, the partial unique index
 * and the cascade rules are exercised for real rather than asserted about. A
 * mock would happily agree with a wrong schema.
 */

import { PGlite } from '@electric-sql/pglite';
import { eq, isNull, sql } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '../src/schema';
import { newLinkToken } from '../src/tokens';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

let db: PgliteDatabase<typeof schema>;

async function seedEvent() {
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest' })
    .returning();
  const [event] = await db
    .insert(schema.events)
    .values({ linkToken: newLinkToken(), name: 'Test event', createdBy: actor!.id })
    .returning();
  return { actor: actor!, event: event! };
}

function hash(seed: string): Buffer {
  return Buffer.from(seed.padEnd(32, '.'), 'utf8');
}

// Migrating is the slow part, so it happens once and each test starts from a
// truncated database instead of a fresh one.
beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "code", "derivative", "device", "event",
      "event_participant", "group_member", "groups", "photo", "report"
    restart identity cascade
  `);
});

describe('migrations', () => {
  it('apply cleanly to an empty database', async () => {
    const { rows } = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const expected of [
      'account', 'actor', 'code', 'derivative', 'device', 'event',
      'event_participant', 'group_member', 'groups', 'photo', 'report',
    ]) {
      expect(names, expected).toContain(expected);
    }
  });
});

describe('event defaults', () => {
  it('opens all three switches and starts at epoch 1', async () => {
    const { event } = await seedEvent();
    expect(event.joinsOpen).toBe(true);
    expect(event.uploadsOpen).toBe(true);
    expect(event.accessPolicy).toBe('public');
    expect(event.capEpoch).toBe(1);
    expect(event.deletedAt).toBeNull();
  });

  it('rejects a duplicate link token', async () => {
    const { actor, event } = await seedEvent();
    await expect(
      db.insert(schema.events).values({
        linkToken: event.linkToken,
        name: 'Collision',
        createdBy: actor.id,
      }),
    ).rejects.toThrow();
  });
});

describe('photo dedup', () => {
  it('collapses the same photo contributed twice to one row', async () => {
    const { actor, event } = await seedEvent();
    const values = {
      eventId: event.id,
      uploaderId: actor.id,
      storageKey: `ev/${event.id}/abc`,
      contentHash: hash('abc'),
      byteSize: 1234,
      mime: 'image/heic',
    };
    await db.insert(schema.photos).values(values);
    await expect(db.insert(schema.photos).values(values)).rejects.toThrow();
  });

  it('scopes dedup to the event — the same photo at two parties is two photos', async () => {
    const first = await seedEvent();
    const second = await seedEvent();
    const base = {
      uploaderId: first.actor.id,
      contentHash: hash('shared'),
      byteSize: 10,
      mime: 'image/jpeg',
    };
    await db.insert(schema.photos).values({
      ...base, eventId: first.event.id, storageKey: 'a',
    });
    await db.insert(schema.photos).values({
      ...base, eventId: second.event.id, storageKey: 'b',
    });
    const rows = await db.select().from(schema.photos);
    expect(rows).toHaveLength(2);
  });

  it('lets a removed photo be re-contributed', async () => {
    // The index ignores tombstones: deleting your upload must not permanently
    // blacklist that image from the event.
    const { actor, event } = await seedEvent();
    const values = {
      eventId: event.id,
      uploaderId: actor.id,
      storageKey: 'k',
      contentHash: hash('redo'),
      byteSize: 10,
      mime: 'image/jpeg',
    };
    const [inserted] = await db.insert(schema.photos).values(values).returning();
    await db
      .update(schema.photos)
      .set({ deletedAt: new Date() })
      .where(eq(schema.photos.id, inserted!.id));

    await expect(db.insert(schema.photos).values(values)).resolves.toBeDefined();

    const live = await db
      .select()
      .from(schema.photos)
      .where(isNull(schema.photos.deletedAt));
    expect(live).toHaveLength(1);
  });
});

describe('cascades', () => {
  it('deleting an event takes its photos and participants with it', async () => {
    const { actor, event } = await seedEvent();
    await db.insert(schema.photos).values({
      eventId: event.id, uploaderId: actor.id, storageKey: 'k',
      contentHash: hash('x'), byteSize: 1, mime: 'image/jpeg',
    });
    await db
      .insert(schema.eventParticipants)
      .values({ eventId: event.id, actorId: actor.id });

    await db.delete(schema.events).where(eq(schema.events.id, event.id));

    expect(await db.select().from(schema.photos)).toHaveLength(0);
    expect(await db.select().from(schema.eventParticipants)).toHaveLength(0);
  });

  it('keeps an event when its group is deleted', async () => {
    // Events own their photos; groups own their events. Losing the group must
    // not lose the archive.
    const { actor } = await seedEvent();
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'House', slug: 'house' })
      .returning();
    const [event] = await db
      .insert(schema.events)
      .values({
        linkToken: newLinkToken(), name: 'Dinner',
        createdBy: actor.id, groupId: group!.id,
      })
      .returning();

    await db.delete(schema.groups).where(eq(schema.groups.id, group!.id));

    const [survivor] = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, event!.id));
    expect(survivor).toBeDefined();
    expect(survivor!.groupId).toBeNull();
  });
});

describe('code pool', () => {
  it('allocates without collision under concurrency', async () => {
    // Allocation is SELECT ... FOR UPDATE SKIP LOCKED against the free pool,
    // so two racing claims must take different codes rather than one failing.
    await db
      .insert(schema.codes)
      .values([{ words: 'amber-fox' }, { words: 'silver-otter' }]);

    const a = await seedEvent();
    const b = await seedEvent();

    const claim = async (eventId: string) => {
      const { rows } = await db.execute<{ id: string; words: string }>(sql`
        update "code" set event_id = ${eventId}, claimed_at = now()
        where id = (
          select id from "code" where event_id is null
          order by random() limit 1 for update skip locked
        )
        returning id, words
      `);
      return rows[0];
    };

    const [first, second] = await Promise.all([claim(a.event.id), claim(b.event.id)]);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.words).not.toBe(second!.words);
  });

  it('returns a code to the pool on release', async () => {
    const { event } = await seedEvent();
    const [code] = await db
      .insert(schema.codes)
      .values({ words: 'amber-fox', eventId: event.id, claimedAt: new Date() })
      .returning();

    await db
      .update(schema.codes)
      .set({ eventId: null, releasedAt: new Date() })
      .where(eq(schema.codes.id, code!.id));

    const free = await db
      .select()
      .from(schema.codes)
      .where(isNull(schema.codes.eventId));
    expect(free).toHaveLength(1);
  });
});
