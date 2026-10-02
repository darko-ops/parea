/**
 * The hub's growth & retention tab — `src/adminGrowth.ts`.
 *
 * Against a real schema: arrivals by week, accounts closed (and still counted
 * as created), how many people there were by each week, and of each week's
 * arrivals how many joined an album or added photos in their first seven days.
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
const route = await import('../app/api/admin/growth/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const TOKEN = 'd'.repeat(48);
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
    truncate "account", "account_closure", "actor", "event", "photo",
             "activity_day", "activity_week", "activity_month"
    restart identity cascade
  `);
});

function get(query = '', staff: string | null = STAFF) {
  const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
  if (staff) headers.set('x-parea-staff', staff);
  return route.GET(new Request(`https://parea.test/api/admin/growth${query}`, { headers }));
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function guest(createdAt = new Date()) {
  const [row] = await db.insert(schema.actors).values({ kind: 'guest', createdAt }).returning();
  return row!.id;
}

describe('the growth numbers', () => {
  it('are behind the admin gate, and default to ninety days', async () => {
    expect((await get('', null)).status).toBe(403);
    const body = await (await get('?days=12')).json();
    expect(body.days).toBe(90);
    expect(body.weeks).toHaveLength(13);
    expect((await (await get('?days=365')).json()).weeks).toHaveLength(52);
  });

  it('count arrivals by week, closed accounts as created, and people by each week', async () => {
    const [account] = await db.insert(schema.accounts).values({ email: 'sam@example.test' }).returning();
    await db.insert(schema.actors).values({ kind: 'user', accountId: account!.id });
    await guest();
    await guest(daysAgo(30));
    // An account that came and went this week: one created, one closed.
    await db.insert(schema.accountClosures).values({ accountCreatedAt: new Date(), closedAt: new Date() });

    const body = await (await get()).json();
    const now = body.weeks.at(-1);
    expect(now).toMatchObject({ accounts: 2, guests: 1, closed: 1, people: 3 });
    // Thirty days ago the earlier guest was the only one here.
    const earlier = body.weeks.find((w: { people: number }) => w.people === 1);
    expect(earlier).toBeTruthy();
    expect(body.weeks.reduce((n: number, w: { guests: number }) => n + w.guests, 0)).toBe(2);
  });

  it('measure what each week’s arrivals did in their first seven days', async () => {
    const early = await guest(daysAgo(21));
    const idle = await guest(daysAgo(21));
    const late = await guest(daysAgo(21));
    const [event] = await db
      .insert(schema.events)
      .values({ name: 'Party', linkToken: newLinkToken(), createdBy: early })
      .returning();
    await db.insert(schema.eventParticipants).values([
      { eventId: event!.id, actorId: early, firstSeenAt: daysAgo(20) },
      { eventId: event!.id, actorId: late, firstSeenAt: daysAgo(10) }, // after their first week
    ]);
    await db.insert(schema.photos).values({
      eventId: event!.id,
      uploaderId: early,
      storageKey: 'k',
      byteSize: 1,
      mime: 'image/jpeg',
      status: 'ready',
      uploadedAt: daysAgo(20),
      bytesAt: daysAgo(20),
    });

    const body = await (await get()).json();
    const week = body.activation.find((a: { arrived: number }) => a.arrived === 3);
    expect(week).toMatchObject({ arrived: 3, inAlbum: 1, addedPhotos: 1, settled: true });
    expect(body.activation.at(-1).settled).toBe(false);
    expect(JSON.stringify(body)).not.toContain(idle);
  });

  it('leave weekly active unknown before counting, and carry months and a longer retention grid', async () => {
    await db.execute(sql`insert into "activity_day" ("day", "kind", "active") values (date_trunc('week', now() at time zone 'utc')::date, 'user', 2)`);
    await db.execute(sql`insert into "activity_month" ("month", "active") values (date_trunc('month', now() at time zone 'utc')::date, 7)`);
    await db.execute(sql`insert into "activity_week" ("week", "cohort", "active") values (date_trunc('week', now() at time zone 'utc')::date, date_trunc('week', now() at time zone 'utc')::date, 5)`);

    const body = await (await get()).json();
    expect(body.weeks.at(-1).active).toBe(5);
    expect(body.weeks.at(-2).active).toBeNull();
    expect(body.months).toHaveLength(12);
    expect(body.months.at(-1).active).toBe(7);
    expect(body.months[0].active).toBeNull();
    expect(body.retention).toHaveLength(12);
  });
});
