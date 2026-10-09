/**
 * The hub's Invite loop page — `src/adminLoop.ts`.
 *
 * Against a real schema, one small story: A makes a roll, B and D come into
 * it and C is asked and never answers; it was B's first roll and not D's; B
 * adds photos and, three weeks later, makes a roll of their own with A and D
 * in it — the same three, back together. And a group that made a second roll.
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
const route = await import('../app/api/admin/loop/route');

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
    truncate "account", "actor", "event", "event_participant", "event_invite", "photo", "groups"
    restart identity cascade
  `);
});

function get(query = '', staff: string | null = STAFF) {
  const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
  if (staff) headers.set('x-parea-staff', staff);
  return route.GET(new Request(`https://parea.test/api/admin/loop${query}`, { headers }));
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function person(createdAt = daysAgo(200)) {
  const [row] = await db.insert(schema.actors).values({ kind: 'guest', createdAt }).returning();
  return row!.id;
}
async function roll(createdBy: string, createdAt: Date, groupId: string | null = null) {
  const [row] = await db
    .insert(schema.events)
    .values({ name: 'Roll', linkToken: newLinkToken(), createdBy, createdAt, groupId })
    .returning();
  await db.insert(schema.eventParticipants).values({ eventId: row!.id, actorId: createdBy, firstSeenAt: createdAt });
  return row!.id;
}
const join = (eventId: string, actorId: string, firstSeenAt: Date) =>
  db.insert(schema.eventParticipants).values({ eventId, actorId, firstSeenAt });
const photo = (eventId: string, uploaderId: string) =>
  db.insert(schema.photos).values({ eventId, uploaderId, storageKey: 'k', byteSize: 1, mime: 'image/jpeg', status: 'ready' });

const total = (months: Record<string, number>[], key: string) => months.reduce((n, m) => n + m[key]!, 0);

describe('the loop numbers', () => {
  it('are behind the admin gate, and default to ninety days', async () => {
    expect((await get('', null)).status).toBe(403);
    expect((await (await get('?days=12')).json()).days).toBe(90);
    expect((await (await get('?days=365')).json()).days).toBe(365);
  });

  it('follow a roll from the people it brought to the roll they made', async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    // D's first roll was long ago, outside the period.
    const r0 = await roll(a, daysAgo(120));
    await join(r0, d, daysAgo(120));

    const r1 = await roll(a, daysAgo(40));
    await photo(r1, a);
    await join(r1, b, daysAgo(40));
    await join(r1, d, daysAgo(40));
    await photo(r1, b);
    await db.insert(schema.eventInvites).values({ eventId: r1, actorId: c, invitedByActorId: a });

    const r2 = await roll(b, daysAgo(20));
    await join(r2, a, daysAgo(20));
    await join(r2, d, daysAgo(20));

    // A group: its first roll long ago, its second in the period.
    const [group] = await db.insert(schema.groups).values({ name: 'Us', slug: 'us' }).returning();
    await roll(a, daysAgo(200), group!.id);
    await roll(a, daysAgo(10), group!.id);

    const body = await (await get()).json();
    const months = body.months;
    // R1, R2 and the group's second; only R1 has photos.
    expect(total(months, 'rolls')).toBe(3);
    expect(total(months, 'activeRolls')).toBe(1);
    // Into the active roll: B and D, and only B was new to Parea.
    expect(total(months, 'joinedActive')).toBe(2);
    expect(total(months, 'newActive')).toBe(1);
    // Invitees: B, C, D in R1 and A, D in R2. C never came; B added photos.
    expect(total(months, 'invitees')).toBe(5);
    expect(total(months, 'viewed')).toBe(4);
    expect(total(months, 'contributed')).toBe(1);
    // B and D are past their 30 days; B made a roll in them. A joined R2 too
    // recently to be judged.
    expect(total(months, 'settled')).toBe(2);
    expect(total(months, 'created')).toBe(1);
    expect(total(months, 'settledContributors')).toBe(1);
    expect(total(months, 'createdContributors')).toBe(1);
    // A, B and D in R1, together again in R2.
    expect(body.circles).toEqual({ eligible: 2, repeating: 1 });
    expect(body.groups).toEqual({ withRolls: 1, repeating: 1 });
  });
});
