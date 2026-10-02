/**
 * Who runs a roll or a group next: chosen when the Host or last admin goes,
 * and handed on by name while they are still here. See `@/succession`.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { and, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Db } from '@/db';

const headerBag = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
}));

const pushed: { to: string; body: string; data: Record<string, string> }[] = [];
vi.mock('@parea/push', async (actual) => ({
  ...(await actual<typeof import('@parea/push')>()),
  sendAll: async (messages: { to: string; body: string; data: Record<string, string> }[]) => {
    pushed.push(...messages);
    return { sent: messages.length, failed: 0, unregistered: [] };
  },
}));

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { addMember, membershipOf } = await import('@/groups');
const { deleteAccount } = await import('@/accounts');
const { DELETE: leaveRoute } = await import('../app/api/groups/[id]/members/route');
const { POST: rollHandover } = await import('../app/api/events/[id]/handover/route');
const { POST: groupHandover } = await import('../app/api/groups/[id]/handover/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "groups", "group_member", "event", "event_participant",
      "photo", "suspension", "block"
    restart identity cascade
  `);
  headerBag.clear();
  pushed.length = 0;
});

async function person(name: string, opts: { account?: boolean } = {}) {
  const accountId =
    opts.account === false
      ? null
      : (
          await db
            .insert(schema.accounts)
            .values({ email: `${crypto.randomUUID()}@example.test` })
            .returning()
        )[0]!.id;
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName: name, accountId })
    .returning();
  return actor!.id;
}

let tokens = 0;
async function roll(createdBy: string, groupId: string | null = null) {
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'The evening', linkToken: `tok-${++tokens}`, createdBy, groupId })
    .returning();
  await join(event!.id, createdBy);
  return event!.id;
}

/** In the roll, each a second after the last, so "there longest" is defined. */
let seen = Date.now() - 3_600_000;
async function join(eventId: string, actorId: string, role: 'member' | 'host' = 'member') {
  await db
    .insert(schema.eventParticipants)
    .values({ eventId, actorId, role, firstSeenAt: new Date((seen += 1000)) });
}

async function photos(
  eventId: string,
  uploaderId: string,
  n: number,
  opts: { status?: 'ready' | 'pending'; deleted?: boolean } = {},
) {
  await db.insert(schema.photos).values(
    Array.from({ length: n }, () => ({
      eventId,
      uploaderId,
      storageKey: `k-${Math.random()}`,
      byteSize: 1,
      mime: 'image/jpeg',
      status: opts.status ?? 'ready',
      deletedAt: opts.deleted ? new Date() : null,
    })),
  );
}

async function hostOf(eventId: string) {
  const [row] = await db
    .select({ createdBy: schema.events.createdBy })
    .from(schema.events)
    .where(eq(schema.events.id, eventId));
  return row!.createdBy;
}

async function roleIn(eventId: string, actorId: string) {
  const [row] = await db
    .select({ role: schema.eventParticipants.role })
    .from(schema.eventParticipants)
    .where(
      and(eq(schema.eventParticipants.eventId, eventId), eq(schema.eventParticipants.actorId, actorId)),
    );
  return row?.role ?? null;
}

let slug = 0;
async function group(...people: [string, 'admin' | 'member'][]) {
  const [row] = await db.insert(schema.groups).values({ name: 'Fam', slug: `g${++slug}` }).returning();
  let at = Date.now() - 60_000;
  for (const [id, role] of people) {
    await addMember(db, row!.id, id, role);
    await db
      .update(schema.groupMembers)
      .set({ joinedAt: new Date((at += 1000)) })
      .where(and(eq(schema.groupMembers.groupId, row!.id), eq(schema.groupMembers.actorId, id)));
  }
  return row!.id;
}

function as(actorId: string) {
  headerBag.clear();
  headerBag.set('authorization', `Bearer ${sign(actorId)}`);
}

type Handler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const post = (handler: Handler, path: string, id: string, actorId: string) =>
  handler(
    new Request(`https://parea.test/api/${path}/${id}/handover`, {
      method: 'POST',
      body: JSON.stringify({ actorId }),
    }),
    { params: Promise.resolve({ id }) },
  );

describe('a roll whose Host closes their account', () => {
  it('goes to whoever has the most live photos in it', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const e = await roll(ada);
    await join(e, sam);
    await join(e, tom, 'host');
    await photos(e, sam, 2);
    await photos(e, tom, 3);
    // Deleted, and not yet ready, are not anything anybody can see.
    await photos(e, sam, 5, { deleted: true });
    await photos(e, sam, 5, { status: 'pending' });

    expect(await deleteAccount(db, ada)).toBe(true);
    expect(await hostOf(e)).toBe(tom);
    // Host by being the creator, so not a co-host on the row as well.
    expect(await roleIn(e, tom)).toBe('member');
  });

  it('goes to whoever has been there longest when nobody is ahead', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const e = await roll(ada);
    await join(e, sam);
    await join(e, tom);
    await deleteAccount(db, ada);
    expect(await hostOf(e)).toBe(sam);
  });

  it('passes over a guest, and somebody suspended while anyone else is there', async () => {
    const [ada, guest, sam, tom] = [
      await person('Ada'),
      await person('Guest', { account: false }),
      await person('Sam'),
      await person('Tom'),
    ];
    const e = await roll(ada);
    await join(e, guest);
    await join(e, sam);
    await join(e, tom);
    await photos(e, guest, 9);
    await photos(e, sam, 4);
    await photos(e, tom, 1);
    await db.insert(schema.suspensions).values({ actorId: sam, reason: 'x', suspendedBy: 'staff@x' });

    await deleteAccount(db, ada);
    expect(await hostOf(e)).toBe(tom);
  });

  it('stays as it was when nobody can take it', async () => {
    const [ada, guest] = [await person('Ada'), await person('Guest', { account: false })];
    const e = await roll(ada);
    await join(e, guest);
    await deleteAccount(db, ada);
    expect(await hostOf(e)).toBe(ada);
  });

  it('is the rule migration 0061 applied to the rolls orphaned before it', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const e = await roll(ada);
    await join(e, sam);
    await join(e, tom);
    await photos(e, tom, 2);
    // Closed the old way: the account gone, the roll still theirs.
    await db.update(schema.actors).set({ accountId: null }).where(eq(schema.actors.id, ada));
    const kept = await roll(sam);

    const migration = readFileSync(`${MIGRATIONS}/0061_roll_succession.sql`, 'utf8');
    await db.execute(sql.raw(migration));
    expect(await hostOf(e)).toBe(tom);
    expect(await hostOf(kept)).toBe(sam);
  });
});

describe('a group whose last admin goes', () => {
  it('goes to whoever has added most to its rolls when they close their account', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const g = await group([ada, 'admin'], [sam, 'member'], [tom, 'member']);
    const e = await roll(ada, g);
    await join(e, sam);
    await join(e, tom);
    await photos(e, sam, 1);
    await photos(e, tom, 4);
    // A roll outside the group counts for nothing here.
    const elsewhere = await roll(sam);
    await photos(elsewhere, sam, 10);

    await deleteAccount(db, ada);
    expect(await membershipOf(db, g, tom)).toEqual({ role: 'admin' });
    expect(await membershipOf(db, g, sam)).toEqual({ role: 'member' });
  });

  it('follows the same rule when they leave', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const g = await group([ada, 'admin'], [sam, 'member'], [tom, 'member']);
    const e = await roll(ada, g);
    await join(e, tom);
    await photos(e, tom, 1);

    as(ada);
    const res = await leaveRoute(
      new Request(`https://parea.test/api/groups/${g}/members`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: g }) },
    );
    expect(res.status).toBe(200);
    expect(await membershipOf(db, g, tom)).toEqual({ role: 'admin' });
  });
});

describe('handing a roll on', () => {
  it('makes them Host and keeps the giver in as a co-host', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const e = await roll(ada);
    await join(e, sam, 'host');
    as(ada);
    const res = await post(rollHandover, 'events', e, sam);
    expect(res.status).toBe(200);
    expect(await hostOf(e)).toBe(sam);
    expect(await roleIn(e, sam)).toBe('member');
    expect(await roleIn(e, ada)).toBe('host');
  });

  it('is only the Host’s to do', async () => {
    const [ada, sam, tom] = [await person('Ada'), await person('Sam'), await person('Tom')];
    const e = await roll(ada);
    await join(e, sam);
    await join(e, tom);
    as(sam);
    expect((await post(rollHandover, 'events', e, tom)).status).toBe(404);
    expect(await hostOf(e)).toBe(ada);
  });

  it('is refused to somebody not in it, a guest, or across a block', async () => {
    const [ada, out, guest, sam] = [
      await person('Ada'),
      await person('Out'),
      await person('Guest', { account: false }),
      await person('Sam'),
    ];
    const e = await roll(ada);
    await join(e, guest);
    await join(e, sam);
    await db.insert(schema.blocks).values({ blockerActorId: sam, blockedActorId: ada });
    as(ada);
    for (const to of [out, guest, sam]) {
      expect((await post(rollHandover, 'events', e, to)).status).toBe(409);
    }
    expect(await hostOf(e)).toBe(ada);
  });
});

describe('handing a group on', () => {
  it('makes them admin and the giver a member', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const g = await group([ada, 'admin'], [sam, 'member']);
    as(ada);
    expect((await post(groupHandover, 'groups', g, sam)).status).toBe(200);
    expect(await membershipOf(db, g, sam)).toEqual({ role: 'admin' });
    expect(await membershipOf(db, g, ada)).toEqual({ role: 'member' });
  });

  it('is refused to a member, and to somebody outside the group', async () => {
    const [ada, sam, out] = [await person('Ada'), await person('Sam'), await person('Out')];
    const g = await group([ada, 'admin'], [sam, 'member']);
    as(sam);
    expect((await post(groupHandover, 'groups', g, ada)).status).toBe(403);
    as(ada);
    expect((await post(groupHandover, 'groups', g, out)).status).toBe(409);
    expect(await membershipOf(db, g, ada)).toEqual({ role: 'admin' });
  });
});

describe('telling whoever runs it now', () => {
  async function phone(actorId: string) {
    const pushToken = `ExponentPushToken[${actorId}]`;
    await db.insert(schema.devices).values({ actorId, pushToken, platform: 'ios' });
    return pushToken;
  }

  it('names who handed a roll over', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const e = await roll(ada);
    await join(e, sam);
    const to = await phone(sam);
    as(ada);
    await post(rollHandover, 'events', e, sam);
    expect(pushed).toEqual([
      expect.objectContaining({ to, body: 'Ada made you the Host.', data: expect.objectContaining({ kind: 'roll_handed', eventId: e }) }),
    ]);
  });

  it('says the Host left when a roll passes on, without naming them', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const e = await roll(ada);
    await join(e, sam);
    const g = await group([ada, 'admin'], [sam, 'member']);
    await phone(sam);
    await deleteAccount(db, ada);
    expect(pushed.map((m) => [m.data.kind, m.body]).sort()).toEqual([
      ['group_handed', 'Its admin has left, so you run it now.'],
      ['roll_handed', 'Its Host has left, so you’re the Host now.'],
    ]);
    expect(pushed.every((m) => !('who' in m.data))).toBe(true);
    expect(pushed.find((m) => m.data.kind === 'group_handed')!.data.groupId).toBe(g);
  });

  it('tells the new admin when the last one leaves a group', async () => {
    const [ada, sam] = [await person('Ada'), await person('Sam')];
    const g = await group([ada, 'admin'], [sam, 'member']);
    await phone(sam);
    as(ada);
    await leaveRoute(new Request(`https://parea.test/api/groups/${g}/members`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: g }),
    });
    expect(pushed.map((m) => m.data.kind)).toEqual(['group_handed']);
  });
});
