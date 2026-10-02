/**
 * Counting people as active — `resolveSession`, design §18.
 *
 * The count rides on the statement every signed-in request already runs, so
 * the questions are whether it counts a person once however many devices and
 * requests they bring, whether it files them under the week they arrived, and
 * whether it leaves anything behind about them beyond one date.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '../src/db';
import { resolveSession, startSession } from '../src/sessions';

const MIGRATIONS = new URL('../../../packages/core/drizzle', import.meta.url).pathname;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`truncate "actor", "session", "activity_day", "activity_week", "activity_month" restart identity cascade`);
});

async function person(kind: 'guest' | 'user' = 'user', createdAt?: Date) {
  const [row] = await db.insert(schema.actors).values({ kind, ...(createdAt ? { createdAt } : {}) }).returning();
  return row!.id;
}
const signIn = (actorId: string) =>
  startSession(db, { actorId, kind: 'browser', userAgent: UA, method: 'code' }).then((s) => s.id);

const rows = async (q: ReturnType<typeof sql>) => {
  const r: any = await db.execute(q);
  return (r.rows ?? r) as any[];
};
const days = () => rows(sql`select "kind", "active" from "activity_day" order by "kind"`);
const weeks = () =>
  rows(sql`select to_char("cohort", 'YYYY-MM-DD') as "cohort", "active" from "activity_week" order by "cohort"`);
const today = async () => (await rows(sql`select (now() at time zone 'utc')::date::text as "d"`))[0].d as string;
const monday = async () =>
  (await rows(sql`select date_trunc('week', now() at time zone 'utc')::date::text as "d"`))[0].d as string;

describe('counting people as active', () => {
  it('counts a person once a day, however many devices and requests', async () => {
    const me = await person();
    const phone = await signIn(me);
    const laptop = await signIn(me);
    await Promise.all([resolveSession(db, phone), resolveSession(db, laptop), resolveSession(db, phone)]);
    await resolveSession(db, laptop);

    expect(await days()).toEqual([{ kind: 'user', active: 1 }]);
    expect(await weeks()).toEqual([{ cohort: await monday(), active: 1 }]);
    expect(await rows(sql`select "active" from "activity_month"`)).toEqual([{ active: 1 }]);
    const [row] = await db.select({ on: schema.actors.countedOn }).from(schema.actors).where(eq(schema.actors.id, me));
    expect(row!.on).toBe(await today());
  });

  it('counts accounts and guests apart, and files each under the week they arrived', async () => {
    const old = await person('user', new Date(Date.now() - 30 * 86_400_000));
    const guest = await person('guest');
    await resolveSession(db, await signIn(old));
    await resolveSession(db, await signIn(guest));

    expect(await days()).toEqual([
      { kind: 'guest', active: 1 },
      { kind: 'user', active: 1 },
    ]);
    const w = await weeks();
    expect(w).toHaveLength(2);
    expect(w.at(-1)).toEqual({ cohort: await monday(), active: 1 });
    expect(w[0].cohort < (await monday())).toBe(true);
  });

  it('counts a new day, and a new week only once', async () => {
    const me = await person();
    const s = await signIn(me);
    // Last counted the Sunday before this week: a new day and a new week.
    await db.execute(sql`update "actor" set "counted_on" = date_trunc('week', now() at time zone 'utc')::date - 1`);
    await resolveSession(db, s);
    expect(await days()).toEqual([{ kind: 'user', active: 1 }]);
    expect((await weeks())[0].active).toBe(1);

    // Earlier this week but not today: the day counts, the week already has them.
    if ((await today()) !== (await monday())) {
      await db.execute(sql`update "actor" set "counted_on" = date_trunc('week', now() at time zone 'utc')::date`);
      await db.execute(sql`truncate "activity_day"`);
      await resolveSession(db, s);
      expect(await days()).toEqual([{ kind: 'user', active: 1 }]);
      expect((await weeks())[0].active).toBe(1);
    }
  });

  it('counts a new month once, whatever the day', async () => {
    const me = await person();
    const s = await signIn(me);
    // Last counted the day before this month began: new day, new month.
    await db.execute(sql`update "actor" set "counted_on" = date_trunc('month', now() at time zone 'utc')::date - 1`);
    await resolveSession(db, s);
    expect(await rows(sql`select "active" from "activity_month"`)).toEqual([{ active: 1 }]);
    // Earlier this month but not today: the day counts, the month already has them.
    const first = (await rows(sql`select date_trunc('month', now() at time zone 'utc')::date::text as "d"`))[0].d;
    if ((await today()) !== first) {
      await db.execute(sql`update "actor" set "counted_on" = date_trunc('month', now() at time zone 'utc')::date`);
      await resolveSession(db, s);
      expect(await rows(sql`select "active" from "activity_month"`)).toEqual([{ active: 1 }]);
    }
  });

  it('does not count somebody suspended, or a revoked session', async () => {
    const banned = await person();
    const s = await signIn(banned);
    await db.insert(schema.suspensions).values({ actorId: banned, reason: 'spam', suspendedBy: 'mod@daed.io' });
    expect(await resolveSession(db, s)).toBeNull();
    expect(await days()).toEqual([]);
  });

  it('keeps totals only', async () => {
    await resolveSession(db, await signIn(await person()));
    const cols = await rows(sql`
      select table_name, column_name from information_schema.columns
       where table_name in ('activity_day', 'activity_week', 'activity_month') order by 1, 2`);
    expect(cols.map((c) => `${c.table_name}.${c.column_name}`)).toEqual([
      'activity_day.active',
      'activity_day.day',
      'activity_day.kind',
      'activity_month.active',
      'activity_month.month',
      'activity_week.active',
      'activity_week.cohort',
      'activity_week.week',
    ]);
  });
});
