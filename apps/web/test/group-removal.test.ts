/**
 * An admin removing somebody from a group, and a group never left without one.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { and, eq, sql } from 'drizzle-orm';
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
const { addMember, membershipOf, participatedInGroup } = await import('@/groups');
const { deleteAccount } = await import('@/accounts');
const { DELETE } = await import('../app/api/groups/[id]/members/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "groups", "group_member", "group_removal", "event"
    restart identity cascade
  `);
  headerBag.clear();
});

async function person(name: string) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${crypto.randomUUID()}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName: name, accountId: account!.id })
    .returning();
  return actor!.id;
}

let slug = 0;
async function group() {
  const [row] = await db.insert(schema.groups).values({ name: 'Fam', slug: `g${++slug}` }).returning();
  return row!.id;
}

function as(actorId: string) {
  headerBag.clear();
  headerBag.set('authorization', `Bearer ${sign(actorId)}`);
}

const leave = (groupId: string, target?: string) =>
  DELETE(
    new Request(
      `https://parea.test/api/groups/${groupId}/members${target ? `?actorId=${target}` : ''}`,
      { method: 'DELETE' },
    ),
    { params: Promise.resolve({ id: groupId }) },
  );

/** Joined in this order, a millisecond apart, so "longest in it" is defined. */
async function joinInOrder(groupId: string, ...people: [string, 'admin' | 'member'][]) {
  let at = Date.now() - 60_000;
  for (const [id, role] of people) {
    await addMember(db, groupId, id, role);
    await db
      .update(schema.groupMembers)
      .set({ joinedAt: new Date((at += 1000)) })
      .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.actorId, id)));
  }
}

describe('an admin removing a member', () => {
  it('takes them out and keeps them out of the self-join door', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const g = await group();
    await joinInOrder(g, [ada, 'admin'], [sam, 'member']);
    // Sam hosted one of the group's events, which is a way back in.
    await db.insert(schema.events).values({ name: 'Picnic', linkToken: 'tok-1', createdBy: sam, groupId: g });
    expect(await participatedInGroup(db, g, sam)).toBe(true);

    as(ada);
    const res = await leave(g, sam);
    expect(res.status).toBe(200);
    expect(await membershipOf(db, g, sam)).toBeNull();
    expect(await participatedInGroup(db, g, sam)).toBe(false);

    // An admin letting them back in clears it.
    await addMember(db, g, sam);
    await db.delete(schema.groupMembers).where(eq(schema.groupMembers.actorId, sam));
    expect(await participatedInGroup(db, g, sam)).toBe(true);
  });

  it('is refused to a member', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const g = await group();
    await joinInOrder(g, [ada, 'admin'], [sam, 'member'], [tom, 'member']);
    as(sam);
    expect((await leave(g, tom)).status).toBe(403);
    expect(await membershipOf(db, g, tom)).not.toBeNull();
  });

  it('cannot remove another admin', async () => {
    const [ada, bea] = [await person('Ada'), await person('Bea')];
    const g = await group();
    await joinInOrder(g, [ada, 'admin'], [bea, 'admin']);
    as(ada);
    expect((await leave(g, bea)).status).toBe(409);
  });
});

describe('succession', () => {
  it('makes the longest-standing member admin when the last admin leaves', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const g = await group();
    await joinInOrder(g, [ada, 'admin'], [sam, 'member'], [tom, 'member']);
    as(ada);
    expect((await leave(g)).status).toBe(200);
    expect(await membershipOf(db, g, sam)).toEqual({ role: 'admin' });
    expect(await membershipOf(db, g, tom)).toEqual({ role: 'member' });
  });

  it('leaves things alone while another admin remains', async () => {
    const [ada, bea, sam] = [await person('Ada'), await person('Bea'), await person('Sam')];
    const g = await group();
    await joinInOrder(g, [ada, 'admin'], [sam, 'member'], [bea, 'admin']);
    as(ada);
    await leave(g);
    expect(await membershipOf(db, g, sam)).toEqual({ role: 'member' });
  });

  it('happens when the last admin deletes their account', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const g = await group();
    await joinInOrder(g, [ada, 'admin'], [sam, 'member']);
    expect(await deleteAccount(db, ada)).toBe(true);
    expect(await membershipOf(db, g, sam)).toEqual({ role: 'admin' });
  });
});
