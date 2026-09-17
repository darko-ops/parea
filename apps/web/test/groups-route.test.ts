/**
 * What `/api/groups?detail=1` actually answers with.
 *
 * This is here because the app's Groups tab said "Nobody has said anything
 * yet" under every group, including the ones people were talking in. The tab
 * is the product's list of conversations and not one of the group
 * conversations was on it.
 *
 * Nothing was wrong with the query. `groupThreadSummaries` had been right the
 * whole time and the web's own Groups page had been drawing those lines for
 * months through `myGroupsDetailed`. The route simply never called it: it
 * composed `myGroups` with `facesFor`, with a comment explaining that it asks
 * for "the half it uses" — and the half it left out was the half that makes a
 * row a conversation.
 *
 * ## Why this calls the handler
 *
 * The route already had source assertions, in `groups-page.test.ts`, and they
 * passed throughout. They could only ever check that the lines present are
 * right; a missing field is invisible to them, and a missing field was the
 * bug. So this runs the real handler against a real database and reads the
 * JSON, which is the only shape of test that can notice an absence.
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

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { postGroupMessage } = await import('@/groupMessages');
const { addMember } = await import('@/groups');
const { GET } = await import('../app/api/groups/route');

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
    truncate "actor", "event", "groups", "group_member", "group_message",
             "group_thread_read"
    restart identity cascade
  `);
  headerBag.clear();
});

async function person(displayName: string) {
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName })
    .returning();
  return actor!.id;
}

let slug = 0;
async function group(name: string) {
  const [row] = await db
    .insert(schema.groups)
    .values({ name, slug: `g${++slug}` })
    .returning();
  return row!.id;
}

/** The app's way in: a signed actor id as a bearer token. */
function as(actorId: string) {
  headerBag.set('authorization', `Bearer ${sign(actorId)}`);
}

async function detailed(actorId: string) {
  as(actorId);
  const response = await GET(new Request('https://parea.test/api/groups?detail=1'));
  expect(response.status).toBe(200);
  const { groups } = (await response.json()) as { groups: Record<string, unknown>[] };
  return groups;
}

describe('the list the app draws its rooms from', () => {
  it('carries the last thing said in each group', async () => {
    const me = await person('Demetri');
    const them = await person('Ana');
    const house = await group('Fam Jam');
    await addMember(db, house, me);
    await addMember(db, house, them);
    await postGroupMessage(db, house, them, 'Fam');

    const [row] = await detailed(me);
    expect(row!.lastMessage).toMatchObject({ author: 'Ana', body: 'Fam', mine: false });
  });

  it('counts what is waiting', async () => {
    const me = await person('Demetri');
    const them = await person('Ana');
    const house = await group('Fam Jam');
    await addMember(db, house, me);
    await addMember(db, house, them);
    await postGroupMessage(db, house, them, 'Sunday?');
    await postGroupMessage(db, house, them, 'Or Monday');

    const [row] = await detailed(me);
    expect(row!.unreadCount).toBe(2);
  });

  it('says so plainly for a group nobody has spoken in', async () => {
    /*
     * Null rather than absent. The row draws a door — "Nobody has said
     * anything yet" — and the difference between a group with no messages and
     * a group whose messages were not asked for is the whole of this bug.
     */
    const me = await person('Demetri');
    const quiet = await group('Mac and phone');
    await addMember(db, quiet, me);

    const [row] = await detailed(me);
    expect(row!.lastMessage).toBeNull();
    expect(row!.unreadCount).toBe(0);
  });

  it('answers with every field the app row reads', async () => {
    /*
     * Against the native type rather than a list written here, so that a field
     * added to `MyGroupDetail` and not to this route fails here rather than on
     * somebody's phone. That is exactly how `lastMessage` went missing: the
     * type said the app needed it and nothing compared the two.
     */
    const { readFileSync } = await import('node:fs');
    const api = readFileSync(
      fileURLToPath(new URL('../../mobile/src/api.ts', import.meta.url)),
      'utf8',
    );
    const slice = (start: string, end: string) => {
      const from = api.indexOf(start);
      const to = api.indexOf(end, from);
      expect(from).toBeGreaterThan(-1);
      expect(to).toBeGreaterThan(from);
      return api.slice(from, to);
    };
    const declared = (block: string) =>
      [...block.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]!);
    const wanted = [
      ...declared(slice('export type ThreadLine = {', '\n};')),
      ...declared(slice('export type MyGroupDetail = ThreadLine & {', '\n};')),
    ];
    expect(wanted).toContain('lastMessage');
    expect(wanted).toContain('faces');

    const me = await person('Demetri');
    const house = await group('Fam Jam');
    await addMember(db, house, me);

    const [row] = await detailed(me);
    expect(Object.keys(row!).sort()).toEqual(expect.arrayContaining(wanted.sort()));
  });

  it('lists nothing for somebody in no groups', async () => {
    const stranger = await person('Nobody');
    expect(await detailed(stranger)).toEqual([]);
  });
});
