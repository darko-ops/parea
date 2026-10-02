/**
 * The hub's overview tab — `src/adminPulse.ts`.
 *
 * Against a real schema: that days before counting are unknown rather than
 * zero, that this period and the last line up, that DAU/MAU has a month to
 * divide by, and that "today" is compared with the same hours a week ago.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';

const { __setDbForTests } = await import('@/db');
const route = await import('../app/api/admin/pulse/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const TOKEN = 'c'.repeat(48);
const STAFF = 'mod@daed.io';

let db: Db;
const saved = { ...process.env };

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});
afterAll(() => {
  process.env = { ...saved };
});
beforeEach(async () => {
  process.env.ADMIN_API_TOKEN = TOKEN;
  process.env.ADMIN_STAFF = STAFF;
  await db.execute(sql`
    truncate "actor", "event", "photo", "safety_incident", "activity_day", "activity_week", "activity_month"
    restart identity cascade
  `);
});

function get(query = '', staff: string | null = STAFF) {
  const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
  if (staff) headers.set('x-parea-staff', staff);
  return route.GET(new Request(`https://parea.test/api/admin/pulse${query}`, { headers }));
}

describe('the overview numbers', () => {
  it('are behind the admin gate', async () => {
    expect((await get('', null)).status).toBe(403);
  });

  it('line this period up against the last, and leave uncounted days unknown', async () => {
    await db.execute(sql`
      insert into "activity_day" ("day", "kind", "active") values
        ((now() at time zone 'utc')::date, 'user', 6),
        ((now() at time zone 'utc')::date, 'guest', 2),
        ((now() at time zone 'utc')::date - 7, 'user', 5),
        ((now() at time zone 'utc')::date - 9, 'user', 3)
    `);
    const body = await (await get('?days=7')).json();
    expect(body.current).toHaveLength(7);
    expect(body.previous).toHaveLength(7);
    expect(body.current.at(-1)).toMatchObject({ accounts: 6, guests: 2 });
    // A week ago is the last day of the previous period.
    expect(body.previous.at(-1)).toMatchObject({ accounts: 5, guests: 0 });
    // Before the first counted day: unknown, not zero.
    expect(body.previous[0]).toMatchObject({ accounts: null, guests: null });
    expect(body.recordingSince).toBe(body.previous.at(-3).day);
    expect((await (await get('?days=5')).json()).days).toBe(90);
  });

  it('carry this week and this month, so DAU/MAU has something to divide by', async () => {
    await db.execute(sql`
      insert into "activity_month" ("month", "active") values (date_trunc('month', now() at time zone 'utc')::date, 40);
    `);
    await db.execute(sql`
      insert into "activity_week" ("week", "cohort", "active") values
        (date_trunc('week', now() at time zone 'utc')::date, date_trunc('week', now() at time zone 'utc')::date, 9),
        (date_trunc('week', now() at time zone 'utc')::date, date_trunc('week', now() at time zone 'utc')::date - 7, 4)
    `);
    const body = await (await get()).json();
    expect(body).toMatchObject({ week: 13, month: 40 });
    expect(body.monthsSince).not.toBeNull();
    expect(body.retention).toHaveLength(8);
  });

  it('compare today with the same hours a week ago, and mark days with incidents', async () => {
    const [who] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    const [event] = await db
      .insert(schema.events)
      .values({ name: 'Party', linkToken: newLinkToken(), createdBy: who!.id })
      .returning();
    const photo = (uploadedAt: ReturnType<typeof sql>, status: 'ready' | 'failed' = 'ready') =>
      db.execute(sql`
        insert into "photo" ("event_id", "uploader_id", "storage_key", "byte_size", "mime", "status", "uploaded_at", "bytes_at")
        values (${event!.id}, ${who!.id}, ${'k' + Math.random()}, 1, 'image/jpeg', ${status}, ${uploadedAt}, ${uploadedAt})`);
    await photo(sql`now()`);
    await photo(sql`now()`);
    await photo(sql`now()`, 'failed');
    await photo(sql`now() - interval '7 days' - interval '1 minute'`); // same hours last week
    await photo(sql`now() - interval '7 days' + interval '1 minute'`); // later that day: not yet "today" a week ago
    const [p] = await db.select({ id: schema.photos.id }).from(schema.photos).limit(1);
    await db.insert(schema.safetyIncidents).values({
      photoId: p!.id,
      eventId: event!.id,
      uploaderActorId: who!.id,
      provider: 'photodna',
      classification: 'match',
      storageKey: 'preserved/x',
      contentHash: Buffer.alloc(32, 1),
    });

    const body = await (await get()).json();
    const sameHoursLastWeek = await db.execute(sql`select (now() - interval '7 days' - interval '1 minute') >= (date_trunc('day', now() at time zone 'utc') - interval '7 days') at time zone 'utc' as "ok"`);
    const counted = ((sameHoursLastWeek as any).rows ?? sameHoursLastWeek)[0].ok ? 1 : 0;
    expect(body.engagement.photos).toEqual({ today: 2, lastWeek: counted });
    expect(body.engagement).toMatchObject({ comments: { today: 0, lastWeek: 0 }, reactions: { today: 0, lastWeek: 0 } });
    // A day with an incident is marked; which incident is not said.
    expect(body.incidentDays).toEqual([{ day: body.current.at(-1).day, n: 1 }]);
    expect(JSON.stringify(body)).not.toContain(who!.id);
  });
});
