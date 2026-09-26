/**
 * What the two discovery routes actually do, run against a real database.
 *
 * Here for `groups-route.test.ts`'s reason: source assertions can check that the
 * lines present are right, and a missing one is invisible to them. Three things
 * on the verify route are only observable in the row afterwards, and all three
 * are the feature rather than plumbing:
 *
 *   the number lands, and `phone_verified_at` lands with it — the column every
 *   lookup reads;
 *
 *   `discoverable` goes true on the *first* proof and is never overruled
 *   afterwards, which is the whole of "enabled by default when you connect a
 *   number, and yours to turn off";
 *
 *   a number another account already holds is refused with a sentence, rather
 *   than throwing a constraint error out of a route.
 *
 * And one thing on the recommendations route is only observable in its answer:
 * that it sends nobody until a number is proved. The gate is the server's rather
 * than the screen's — a client is a suggestion — which means it has to be checked
 * where the server is.
 *
 * The send half is not here. It is an HTTP call to a carrier, and `sms.test.ts`
 * is where its request shape is pinned; what this needs is a code in the table,
 * which `startVerification` puts there.
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

/*
 * `SESSION_SECRET` before the modules load.
 *
 * It is the code's HMAC key and the route refuses without it, and `sign` below
 * reads it too — so the fixture and the route have to agree about what it is.
 */
process.env.SESSION_SECRET ??= 'test-secret';
const SECRET = process.env.SESSION_SECRET;

const { __setDbForTests } = await import('@/db');
const { sign } = await import('@/auth/cookies');
const { hashPhone, startVerification } = await import('@/phone');
const { POST } = await import('../app/api/account/phone/verify/route');
const { GET: recommendations } = await import('../app/api/people/recommendations/route');

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
    truncate "account", "actor", "phone_code", "rate_limit", "friendship",
             "friend_request", "block"
    restart identity cascade
  `);
  headerBag.clear();
});

/** Signed in, because a phone number belongs to an account and not a browser. */
async function person(handle: string) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${handle}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: account!.id, handle })
    .returning();
  return actor!.id;
}

function as(actorId: string) {
  headerBag.set('authorization', `Bearer ${sign(actorId)}`);
}

async function present(actorId: string, code: string) {
  as(actorId);
  return POST(
    new Request('https://parea.test/api/account/phone/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  );
}

async function rowFor(actorId: string) {
  const [row] = await db
    .select({
      phoneHash: schema.actors.phoneHash,
      phoneLast2: schema.actors.phoneLast2,
      phoneVerifiedAt: schema.actors.phoneVerifiedAt,
      discoverable: schema.actors.discoverable,
    })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId));
  return row!;
}

describe('presenting the code', () => {
  it('writes the number, the proof and the switch together', async () => {
    const me = await person('me');
    await startVerification(db, SECRET, me, '+15550104477', '123456');

    const res = await present(me, '123456');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ last2: '77', verified: true });

    const row = await rowFor(me);
    expect(row.phoneHash).toBe(hashPhone('+15550104477'));
    expect(row.phoneLast2).toBe('77');
    // The column every lookup reads. A number without it finds nobody.
    expect(row.phoneVerifiedAt).not.toBeNull();
    /*
     * And the switch, in the same statement.
     *
     * This is the sentence the screen made when it asked for the number: adding
     * one is how people who have it find you. Storing the number and leaving
     * discovery off would be the flow not doing the thing it offered.
     */
    expect(row.discoverable).toBe(true);
  });

  it('is forgiving about the spaces a paste brings with it', async () => {
    const me = await person('me');
    await startVerification(db, SECRET, me, '+15550104477', '123456');
    expect((await present(me, ' 123 456 ')).status).toBe(200);
    expect((await rowFor(me)).phoneVerifiedAt).not.toBeNull();
  });

  it('does not turn the switch back on for somebody who turned it off', async () => {
    /*
     * The half of the default that is easy to get wrong. A flat `true` here
     * would overrule a preference somebody set on purpose, silently, every time
     * they re-entered the same number — so the write is conditional on the
     * number not having been proved before.
     */
    const me = await person('me');
    await startVerification(db, SECRET, me, '+15550104477', '111111');
    await present(me, '111111');
    await db
      .update(schema.actors)
      .set({ discoverable: false })
      .where(eq(schema.actors.id, me));

    await startVerification(db, SECRET, me, '+15550104477', '222222');
    expect((await present(me, '222222')).status).toBe(200);
    expect((await rowFor(me)).discoverable).toBe(false);
  });

  it('refuses a number another account already proved, in words', async () => {
    /*
     * The unique index, caught rather than thrown. Two accounts holding one
     * number would give "find by number" two answers and no way to choose.
     *
     * Told here and nowhere earlier: the caller has just read a code off the
     * phone that owns the number, so they are entitled to know. The send
     * endpoint deliberately does not check, because checking there would answer
     * "does this number have a Parea account?" for anybody with a keypad.
     */
    const them = await person('them');
    await startVerification(db, SECRET, them, '+15550104477', '111111');
    await present(them, '111111');

    const me = await person('me');
    await startVerification(db, SECRET, me, '+15550104477', '222222');
    const res = await present(me, '222222');

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'already_claimed' });
    // And nothing of theirs landed on this row, switch included.
    expect(await rowFor(me)).toMatchObject({
      phoneHash: null,
      phoneVerifiedAt: null,
      discoverable: false,
    });
  });

  it('says which of the refusals it is, so a screen can say something useful', async () => {
    const me = await person('me');

    // Nothing outstanding.
    const none = await present(me, '123456');
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ error: 'no_code' });

    // A code that is not six digits is about the caller's own input.
    const short = await present(me, '12');
    expect(short.status).toBe(400);
    expect(await short.json()).toMatchObject({ error: 'invalid_code' });

    await startVerification(db, SECRET, me, '+15550104477', '123456');
    const wrong = await present(me, '000000');
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: 'wrong' });
    // And the wrong guess left the number unclaimed.
    expect((await rowFor(me)).phoneHash).toBeNull();
  });

  it('refuses a browser that is not signed in', async () => {
    // A number attached to a guest actor is a number attached to whoever next
    // picks up that laptop, and the whole point of the column is that it names
    // one person.
    const [guest] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    await startVerification(db, SECRET, guest!.id, '+15550104477', '123456');

    const res = await present(guest!.id, '123456');
    expect(res.status).toBe(403);
    expect((await rowFor(guest!.id)).phoneHash).toBeNull();
  });
});

describe('the list the page draws', () => {
  async function ask(actorId: string) {
    as(actorId);
    const res = await recommendations();
    expect(res.status).toBe(200);
    return (await res.json()) as {
      phone: { last2: string | null; verified: boolean };
      discoverable: boolean;
      people: { handle: string | null; mutuals: number }[];
    };
  }

  async function makeFriends(a: string, b: string) {
    await db.insert(schema.friendships).values([
      { actorId: a, friendActorId: b },
      { actorId: b, friendActorId: a },
    ]);
  }

  it('sends nobody until a number is proved, and says why', async () => {
    /*
     * The reciprocity gate, and it is enforced here rather than only on the
     * screen: this is the one page where somebody is handed the benefit of
     * everybody else being reachable, and the price is being reachable
     * themselves.
     *
     * The empty answer is not an error. It carries enough state for one screen
     * to say "add your number" and "nobody new right now" without a second round
     * trip to find out which.
     */
    const me = await person('me');
    const between = await person('between');
    const them = await person('them');
    await makeFriends(me, between);
    await makeFriends(between, them);

    expect(await ask(me)).toEqual({
      phone: { last2: null, verified: false },
      discoverable: false,
      people: [],
    });
  });

  it('sends them once a number is proved', async () => {
    const me = await person('me');
    const between = await person('between');
    const them = await person('them');
    await makeFriends(me, between);
    await makeFriends(between, them);

    await startVerification(db, SECRET, me, '+15550104477', '123456');
    await present(me, '123456');

    const answer = await ask(me);
    expect(answer.phone).toEqual({ last2: '77', verified: true });
    expect(answer.discoverable).toBe(true);
    expect(answer.people.map((p) => p.handle)).toEqual(['them']);
    expect(answer.people[0]!.mutuals).toBe(1);
  });

  it('never sends a number, an address or a storage key', async () => {
    /*
     * The boundary this whole feature is built on. A phone number is not stored
     * so it cannot leak, but an email address is — and an avatar key is an
     * internal address that does not expire, which is why every picture in this
     * product crosses as a presigned URL.
     */
    const me = await person('me');
    const between = await person('between');
    const them = await person('them');
    await makeFriends(me, between);
    await makeFriends(between, them);
    await db
      .update(schema.actors)
      .set({ avatarKey: 'avatars/them.jpg' })
      .where(eq(schema.actors.id, them));

    await startVerification(db, SECRET, me, '+15550104477', '123456');
    await present(me, '123456');

    as(me);
    const body = await (await recommendations()).text();
    expect(body).not.toContain('avatarKey');
    expect(body).not.toContain('avatars/them.jpg');
    expect(body).not.toContain('@example.test');
    expect(body).not.toContain('5550104477');
  });

  it('refuses a browser that is not signed in', async () => {
    // A suggestion is derived from a relationship graph, and a device that has
    // never signed in has none — so the route says so with a status rather than
    // pretending nobody is out there.
    const [guest] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
    as(guest!.id);
    expect((await recommendations()).status).toBe(403);
  });
});
