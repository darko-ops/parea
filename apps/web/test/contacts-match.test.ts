/**
 * Which of your contacts are on Parea — `findContacts`, and the route that
 * carries it.
 *
 * The rule is `findByPhone`'s, an address book at a time: a proved number, an
 * owner still discoverable, nobody blocked, never yourself. And nothing the
 * request carried is kept.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
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
const { findContacts, MAX_CONTACT_NUMBERS } = await import('@/friends');
const { hashPhone, lastTwo } = await import('@/phone');
const { POST } = await import('../app/api/people/contacts/route');

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
    truncate "account", "actor", "block", "friend_request", "friendship", "rate_limit"
    restart identity cascade
  `);
  headerBag.clear();
});

let seq = 0;
async function person(handle: string) {
  const [account] = await db.insert(schema.accounts).values({ email: `c${++seq}@example.test` }).returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: account!.id, handle, displayName: handle })
    .returning();
  return actor!.id;
}

async function withNumber(actorId: string, e164: string, { proved = true, discoverable = true } = {}) {
  await db
    .update(schema.actors)
    .set({
      phoneHash: hashPhone(e164),
      phoneLast2: lastTwo(e164),
      phoneVerifiedAt: proved ? new Date() : null,
      discoverable,
    })
    .where(eq(schema.actors.id, actorId));
}

describe('which contacts are here', () => {
  it('finds the people whose proved number is in the list, and says which number', async () => {
    const me = await person('me');
    const ana = await person('ana');
    await withNumber(ana, '+15550104477');

    const found = await findContacts(db, me, ['+15550104477', '+15550100000']);
    expect(found.map((p) => [p.handle, p.number, p.standing])).toEqual([['ana', '+15550104477', 'none']]);
  });

  it('finds nobody by a number that was only typed, or whose owner turned discovery off', async () => {
    const me = await person('me');
    const typed = await person('typed');
    const hidden = await person('hidden');
    await withNumber(typed, '+15550104401', { proved: false });
    await withNumber(hidden, '+15550104402', { discoverable: false });

    expect(await findContacts(db, me, ['+15550104401', '+15550104402'])).toEqual([]);
  });

  it('never finds yourself or anybody blocked either way', async () => {
    const me = await person('me');
    const blocked = await person('blocked');
    await withNumber(me, '+15550104400');
    await withNumber(blocked, '+15550104403');
    await db.insert(schema.blocks).values({ blockerActorId: blocked, blockedActorId: me });

    expect(await findContacts(db, me, ['+15550104400', '+15550104403'])).toEqual([]);
  });

  it('ignores what is not a full international number', async () => {
    const me = await person('me');
    const ana = await person('ana');
    await withNumber(ana, '+15550104477');
    expect(await findContacts(db, me, ['5550104477', 'not a number'])).toEqual([]);
  });
});

describe('the route', () => {
  async function ask(actorId: string | null, numbers: unknown) {
    if (actorId) headerBag.set('authorization', `Bearer ${sign(actorId)}`);
    const response = await POST(
      new Request('https://parea.test/api/people/contacts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ numbers }),
      }),
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }

  it('answers people with a picture address, not a storage key', async () => {
    const me = await person('me');
    const ana = await person('ana');
    await withNumber(ana, '+15550104477');

    const { status, body } = await ask(me, ['+15550104477']);
    expect(status).toBe(200);
    const [found] = body.people as Record<string, unknown>[];
    expect(found).toMatchObject({ handle: 'ana', number: '+15550104477', avatar: null });
    expect(found).not.toHaveProperty('avatarKey');
  });

  it('refuses the signed out, and a list longer than an address book', async () => {
    expect((await ask(null, ['+15550104477'])).status).toBe(403);
    const me = await person('me');
    const tooMany = Array.from({ length: MAX_CONTACT_NUMBERS + 1 }, (_, i) => `+1555${String(i).padStart(7, '0')}`);
    expect((await ask(me, tooMany)).status).toBe(400);
  });

  it('keeps nothing the request carried', async () => {
    const me = await person('me');
    await ask(me, ['+15550109999']);
    const { sql } = await import('drizzle-orm');
    const dump = await db.execute(sql`select to_jsonb(r) from "rate_limit" r`);
    expect(JSON.stringify(dump)).not.toContain('5550109999');
    expect(JSON.stringify(await db.select().from(schema.actors))).not.toContain('5550109999');
  });
});
