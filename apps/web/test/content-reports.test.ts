/**
 * Reporting a message, a profile or a group — M11.
 *
 * Through the handler, because the questions that matter are who may call it:
 * somebody outside a group cannot report (and so cannot probe for) its
 * messages, nobody reports their own words, and every report reaches a person.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const headerBag = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const alerts: unknown[] = [];
vi.mock('@parea/core', async (original) => ({
  ...(await original<typeof import('@parea/core')>()),
  alertReport: async (report: unknown) => void alerts.push(report),
}));

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { postGroupMessage } = await import('@/groupMessages');
const { addMember } = await import('@/groups');
const { POST } = await import('../app/api/reports/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "account", "actor", "groups", "group_member", "group_message",
             "content_report", "rate_limit"
    restart identity cascade
  `);
  headerBag.clear();
  alerts.length = 0;
});

async function person(displayName: string) {
  // An account, since nothing answers a guest any more.
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${crypto.randomUUID()}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', displayName, accountId: account!.id })
    .returning();
  return actor!.id;
}

let slug = 0;
async function group(findable = false) {
  const [row] = await db
    .insert(schema.groups)
    .values({ name: 'Fam Jam', slug: `g${++slug}`, findable })
    .returning();
  return row!.id;
}

function as(actorId: string | null) {
  headerBag.clear();
  if (actorId) headerBag.set('authorization', `Bearer ${sign(actorId)}`);
}

const report = (body: unknown) =>
  POST(new Request('https://parea.test/api/reports', { method: 'POST', body: JSON.stringify(body) }));

describe('reporting a group message', () => {
  it('is filed, names the author, and alerts', async () => {
    const [sam, maya] = [await person('Sam'), await person('Maya')];
    const room = await group();
    await addMember(db, room, sam);
    await addMember(db, room, maya);
    const said = await postGroupMessage(db, room, sam, 'something awful');

    as(maya);
    const res = await report({ targetKind: 'group_message', targetId: said });
    expect(res.status).toBe(200);

    const rows = await db.select().from(schema.contentReports);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      targetKind: 'group_message',
      subjectActorId: sam,
      reporterActorId: maya,
      kind: 'abuse',
      status: 'open',
    });
    expect(alerts).toEqual([
      expect.objectContaining({ target: 'group_message', targetId: said, kind: 'abuse' }),
    ]);
  });

  it('is not open to somebody outside the group', async () => {
    const [sam, stranger] = [await person('Sam'), await person('Stranger')];
    const room = await group();
    await addMember(db, room, sam);
    const said = await postGroupMessage(db, room, sam, 'hello');

    as(stranger);
    expect((await report({ targetKind: 'group_message', targetId: said })).status).toBe(404);
    expect(alerts).toHaveLength(0);
  });

  it('refuses a report of your own message', async () => {
    const sam = await person('Sam');
    const room = await group();
    await addMember(db, room, sam);
    const said = await postGroupMessage(db, room, sam, 'hello');

    as(sam);
    expect((await report({ targetKind: 'group_message', targetId: said })).status).toBe(400);
  });
});

describe('reporting a profile or a group', () => {
  it('takes a profile, and keeps a child-safety kind', async () => {
    const [sam, maya] = [await person('Sam'), await person('Maya')];
    as(maya);
    const res = await report({ targetKind: 'profile', targetId: sam, kind: 'child_safety' });
    expect(res.status).toBe(200);
    expect(alerts).toEqual([expect.objectContaining({ kind: 'child_safety', target: 'profile' })]);
  });

  it('takes a findable group from anyone, and a private one only from members', async () => {
    const maya = await person('Maya');
    const open = await group(true);
    const closed = await group(false);
    as(maya);
    expect((await report({ targetKind: 'group', targetId: open })).status).toBe(200);
    expect((await report({ targetKind: 'group', targetId: closed })).status).toBe(404);
  });
});

describe('what the route refuses outright', () => {
  it('needs an identity', async () => {
    as(null);
    expect((await report({ targetKind: 'profile', targetId: crypto.randomUUID() })).status).toBe(401);
  });

  it('needs a known kind of target and a real id', async () => {
    as(await person('Maya'));
    expect((await report({ targetKind: 'photo', targetId: crypto.randomUUID() })).status).toBe(400);
    expect((await report({ targetKind: 'profile', targetId: 'nope' })).status).toBe(400);
  });
});
