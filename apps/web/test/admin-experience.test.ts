/**
 * §18's numbers for the hub — `src/adminExperience.ts`.
 *
 * Against a real schema, because every one of these is a query and the
 * question is whether the query counts what it says: a failed or unfinished
 * upload is not a contribution, an old album is outside the period, and
 * nothing that comes back names anybody.
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
const route = await import('../app/api/admin/experience/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const TOKEN = 'b'.repeat(48);
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
    truncate "actor", "event", "photo", "observation", "groups", "job_run", "event_access_request",
             "activity_day", "activity_week"
    restart identity cascade
  `);
});

function get(query = '', staff: string | null = STAFF) {
  const headers = new Headers({ authorization: `Bearer ${TOKEN}` });
  if (staff) headers.set('x-parea-staff', staff);
  return route.GET(new Request(`https://parea.test/api/admin/experience${query}`, { headers }));
}

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);

async function person(name: string) {
  const [row] = await db.insert(schema.actors).values({ kind: 'guest', displayName: name }).returning();
  return row!.id;
}

async function album(createdBy: string, opts: { hoursAgo?: number; window?: boolean } = {}) {
  const createdAt = ago(opts.hoursAgo ?? 48);
  const [row] = await db
    .insert(schema.events)
    .values({
      name: 'Party',
      linkToken: newLinkToken(),
      createdBy,
      createdAt,
      ...(opts.window ? { startsAt: createdAt, endsAt: ago(1) } : {}),
    })
    .returning();
  await db.insert(schema.eventParticipants).values({ eventId: row!.id, actorId: createdBy, firstSeenAt: createdAt });
  return row!.id;
}

async function join(eventId: string, actorId: string, hoursAgo = 40) {
  await db.insert(schema.eventParticipants).values({ eventId, actorId, firstSeenAt: ago(hoursAgo) });
}

async function photos(
  eventId: string,
  uploaderId: string,
  n: number,
  opts: { hoursAgo?: number; status?: 'ready' | 'failed' | 'pending'; bytes?: boolean } = {},
) {
  const status = opts.status ?? 'ready';
  await db.insert(schema.photos).values(
    Array.from({ length: n }, () => ({
      eventId,
      uploaderId,
      storageKey: `k-${Math.random()}`,
      byteSize: 1,
      mime: 'image/jpeg',
      status,
      uploadedAt: ago(opts.hoursAgo ?? 30),
      bytesAt: opts.bytes === false ? null : ago(opts.hoursAgo ?? 30),
    })),
  );
}

describe('the experience numbers', () => {
  it('are behind the same gate as the rest of the admin API', async () => {
    expect((await get('', null)).status).toBe(403);
    process.env.ADMIN_API_TOKEN = '';
    expect((await get()).status).toBe(404);
  });

  it('count who contributed to each album, and only uploads that arrived', async () => {
    const [creator, a, b, c] = [await person('C'), await person('A'), await person('B'), await person('D')];

    const shared = await album(creator, { window: true });
    await photos(shared, creator, 5, { hoursAgo: 47 });
    await join(shared, a);
    await photos(shared, a, 2, { hoursAgo: 46 }); // first outside upload two hours in
    await join(shared, b);
    await photos(shared, b, 1);
    await photos(shared, c, 3, { status: 'failed' }); // never appeared: not a contributor

    const solo = await album(creator);
    await photos(solo, creator, 4);
    await photos(solo, a, 2, { status: 'pending', bytes: false }); // started, never finished

    await album(creator); // nothing in it
    const old = await album(creator, { hoursAgo: 24 * 60 });
    await photos(old, a, 1, { hoursAgo: 24 * 59 }); // outside thirty days

    const body = await (await get()).json();
    expect(body.days).toBe(30);
    expect(body.loop).toMatchObject({
      events: 3,
      contributors: { none: 1, one: 1, few: 1, many: 0 },
      otherUploaded: 1,
      withPhotos: 2,
      withWindow: 1,
      contributions: 4,
    });
    expect(body.loop.medianHoursToOther).toBeCloseTo(2, 1);
    // Five of eight photos came from the busiest contributor.
    expect(body.loop.medianTopShare).toBeCloseTo(5 / 8, 3);
    expect(body.loop.weeks).toHaveLength(12);
    expect(body.loop.weeks.reduce((n: number, w: { shared: number }) => n + w.shared, 0)).toBe(1);

    expect(body.reliability.photos).toMatchObject({ failed: 3, abandoned: 2, stuck: 0 });

    // Totals only: no actor or album id anywhere in the answer.
    const text = JSON.stringify(body);
    for (const id of [creator, a, b, c, shared, solo, old]) expect(text).not.toContain(id);
  });

  it('take the period from the request, and fall back to thirty days', async () => {
    const creator = await person('C');
    await album(creator, { hoursAgo: 24 * 60 });
    expect((await (await get('?days=90')).json()).loop.events).toBe(1);
    expect((await (await get('?days=12')).json()).days).toBe(30);
  });

  it('count downloads, repeat gatherings, and people in more than one album', async () => {
    const [x, y, z] = [await person('X'), await person('Y'), await person('Z')];
    const first = await album(x);
    await join(first, y);
    await join(first, z);
    await photos(first, x, 1);
    const second = await album(y, { hoursAgo: 20 });
    await join(second, x, 19);
    await photos(second, y, 1, { hoursAgo: 19 });
    await db.insert(schema.observations).values({ kind: 'download', eventId: first, actorId: z, client: 'web', count: 1 });

    const body = await (await get()).json();
    expect(body.loop).toMatchObject({ withPhotos: 2, downloaded: 1, sharedPeople: 2 });
    expect(body.loop.people).toEqual({ inAny: 3, inTwo: 2 });
    expect(body.app.downloads).toEqual({ web: 1, ios: 0, android: 0 });
  });

  it('split joins and contributions by client', async () => {
    const [host, w, i] = [await person('H'), await person('W'), await person('I')];
    const e = await album(host);
    await db.insert(schema.observations).values([
      { kind: 'joined', eventId: e, actorId: w, client: 'web' },
      { kind: 'joined', eventId: e, actorId: w, client: 'web' }, // the same person twice is one join
      { kind: 'joined', eventId: e, actorId: i, client: 'ios' },
    ]);
    await photos(e, w, 1);

    const body = await (await get()).json();
    expect(body.app.joined).toEqual({ web: 1, ios: 1, android: 0 });
    expect(body.app.contributed).toEqual({ web: 1, ios: 0, android: 0 });
  });

  it('measure how much of a suggestion is kept, and whether heavy deselectors come back', async () => {
    const [heavy, light, other] = [await person('H'), await person('L'), await person('O')];
    const e = await album(heavy, { hoursAgo: 30 });
    await photos(e, heavy, 2, { hoursAgo: 29 });
    await db.insert(schema.observations).values([
      { kind: 'autoselect_shown', eventId: e, actorId: heavy, client: 'ios', count: 10, outOf: 40, createdAt: ago(29) },
      { kind: 'autoselect_confirmed', eventId: e, actorId: heavy, client: 'ios', count: 2, outOf: 10, createdAt: ago(29) },
      { kind: 'autoselect_confirmed', eventId: e, actorId: light, client: 'ios', count: 9, outOf: 10, createdAt: ago(28) },
      { kind: 'picker_used', eventId: e, actorId: light, client: 'android', createdAt: ago(28) },
    ]);
    // Somebody else's album, later: the heavy deselector came back, the other did not.
    const later = await album(other, { hoursAgo: 5 });
    await join(later, heavy, 4);

    const body = await (await get()).json();
    expect(body.app.suggestions).toMatchObject({ shown: 1, picker: 1, confirmed: 2, kept: 11, offered: 20 });
    expect(body.app.suggestions.medianUnticked).toBeCloseTo(4.5, 3);
    expect(body.app.deselectors).toEqual({ heavy: { people: 1, returned: 1 }, others: { people: 1, returned: 0 } });
    // The album's first contributor was shown a suggestion.
    expect(body.app.firstContributor).toMatchObject({ suggested: 1 });
  });

  it('show photos stuck in processing, the scheduled jobs, and requests left waiting', async () => {
    const [host, guest] = [await person('H'), await person('G')];
    const e = await album(host);
    await photos(e, host, 2, { status: 'pending', hoursAgo: 1 });
    await db.insert(schema.jobRuns).values({ name: 'hourly', lastSucceededAt: ago(1), lastFailedAt: ago(30), lastError: 'boom' });
    await db.insert(schema.eventAccessRequests).values({ eventId: e, actorId: guest, createdAt: ago(24 * 9) });

    const body = await (await get()).json();
    expect(body.reliability.photos).toMatchObject({ processing: 2, stuck: 2 });
    expect(body.reliability.jobs).toEqual([
      expect.objectContaining({ name: 'hourly', lastError: 'boom' }),
    ]);
    expect(body.reliability.waiting).toContainEqual(expect.objectContaining({ kind: 'album_access', open: 1, overAWeek: 1 }));
  });

  it('chart activity by day, and say when counting began', async () => {
    await db.execute(sql`
      insert into "activity_day" ("day", "kind", "active") values
        ((now() at time zone 'utc')::date, 'user', 5),
        ((now() at time zone 'utc')::date, 'guest', 2),
        ((now() at time zone 'utc')::date - 3, 'user', 4)
    `);
    const body = await (await get('?days=7')).json();
    expect(body.activity.days).toHaveLength(28);
    expect(body.activity.days.at(-1)).toMatchObject({ accounts: 5, guests: 2 });
    expect(body.activity.days.at(-4)).toMatchObject({ accounts: 4, guests: 0 });
    expect(body.activity.recordingSince).toBe(body.activity.days.at(-4).day);
  });

  it('draw retention by signup week, blank where a week is ahead or before counting', async () => {
    // Three people who arrived two weeks ago; counting began then.
    const twoWeeksAgo = sql`(date_trunc('week', now() at time zone 'utc')::date - 14)`;
    for (let i = 0; i < 3; i++) {
      await db.execute(sql`insert into "actor" ("kind", "created_at") values ('user', ${twoWeeksAgo}::timestamp + interval '1 day')`);
    }
    await db.execute(sql`insert into "activity_day" ("day", "kind", "active") values (${twoWeeksAgo}, 'user', 3)`);
    await db.execute(sql`
      insert into "activity_week" ("week", "cohort", "active") values
        (${twoWeeksAgo}, ${twoWeeksAgo}, 3),
        (${twoWeeksAgo} + 7, ${twoWeeksAgo}, 2)
    `);
    const body = await (await get()).json();
    const grid = body.activity.retention;
    expect(grid).toHaveLength(8);
    const row = grid.at(-3);
    expect(row.size).toBe(3);
    // W0 and W1 counted, W2 is this week with nobody back yet, W3 on is ahead.
    expect(row.weeks).toEqual([3, 2, 0, null, null, null, null, null]);
    // Weekly active is every cohort's count for the week, once.
    expect(body.activity.weeks).toHaveLength(12);
    expect(body.activity.weeks.at(-3).active).toBe(3);
    expect(body.activity.weeks.at(-2).active).toBe(2);
    // Earlier cohorts' weeks before counting began are unknown, not zero.
    expect(grid[0].weeks.slice(0, 5)).toEqual([null, null, null, null, null]);
  });

  it('count arrivals, joins and refusals at the door, by client and by reason', async () => {
    const host = await person('H');
    const e = await album(host);
    await db.insert(schema.observations).values([
      { kind: 'link_opened', eventId: e, client: 'web' },
      { kind: 'link_opened', eventId: e, client: 'web' },
      { kind: 'link_opened', eventId: e, client: 'ios' },
      { kind: 'joined', eventId: e, client: 'web' },
      { kind: 'join_refused', eventId: e, client: 'web', reason: 'sign_in_required' },
      { kind: 'join_refused', eventId: e, client: 'ios', reason: 'joins_closed' },
    ]);
    const body = await (await get()).json();
    expect(body.doors.byClient).toEqual({
      web: { opened: 2, joined: 1, refused: 1 },
      ios: { opened: 1, joined: 0, refused: 1 },
      android: { opened: 0, joined: 0, refused: 0 },
    });
    expect(body.doors.refusals).toEqual(
      expect.arrayContaining([{ reason: 'sign_in_required', n: 1 }, { reason: 'joins_closed', n: 1 }]),
    );
    expect(body.doors.recordingSince).not.toBeNull();
  });
});
