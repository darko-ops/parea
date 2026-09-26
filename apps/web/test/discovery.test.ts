/**
 * Finding people you may know, and the two things that gate it.
 *
 * Three claims are being tested, and they are the ones the feature would be
 * dishonest without:
 *
 *   **A number counts only once it is proved.** A hash says two people typed the
 *   same digits and nothing about whose digits they are. An unproved number in
 *   the column is a stranger's account handed to whoever typed their number
 *   first, and the person harmed never touched the product.
 *
 *   **The switch actually switches something.** "Let people who have my phone
 *   number or email find me on Parea" is a sentence on a settings screen, and a
 *   flag honoured by one of the two doors is worse than no flag — somebody who
 *   turned it off would still be findable and would have been told otherwise.
 *
 *   **Nothing reads an address book.** The recommendations come from albums,
 *   groups and friendships, which are records the viewer can already see the
 *   other end of. Asserted against the source as well as the behaviour, because
 *   "we do not upload your contacts" is a promise a future commit can break
 *   without any of the assertions below going red.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { newLinkToken } from '@parea/core';
import {
  findByEmail,
  findByPhone,
  findPeople,
  looksLikeEmail,
  recommendationsFor,
} from '@/friends';
import {
  MAX_PHONE_ATTEMPTS,
  PHONE_CODE_TTL_MS,
  confirmVerification,
  hashPhone,
  lastTwo,
  normalisePhone,
  startVerification,
} from '@/phone';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

const SECRET = 'test-secret';

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "account", "actor", "block", "friend_request", "friendship",
      "groups", "group_member", "event", "event_participant", "phone_code"
    restart identity cascade
  `);
});

/** Somebody with an account, which is what "a person" means here. */
async function person(handle: string, email = `${handle}@example.test`) {
  const [account] = await db.insert(schema.accounts).values({ email }).returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: account!.id, handle })
    .returning();
  return actor!.id;
}

/** A device that never signed in. Exists for anybody who opened a link. */
async function guest() {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  return actor!.id;
}

/** A number in the column and proved, the way the verify route leaves it. */
async function withProvedNumber(actorId: string, phone: string, discoverable = true) {
  const e164 = normalisePhone(phone)!;
  await db
    .update(schema.actors)
    .set({
      phoneHash: hashPhone(e164),
      phoneLast2: lastTwo(e164),
      phoneVerifiedAt: new Date(),
      discoverable,
    })
    .where(eq(schema.actors.id, actorId));
}

async function event(name: string, createdBy: string) {
  const [row] = await db
    .insert(schema.events)
    .values({ name, linkToken: newLinkToken(), createdBy })
    .returning();
  return row!.id;
}

async function wereThere(eventId: string, actorIds: string[]) {
  await db
    .insert(schema.eventParticipants)
    .values(actorIds.map((actorId) => ({ eventId, actorId })));
}

async function group(name: string, actorIds: string[]) {
  const [row] = await db
    .insert(schema.groups)
    .values({ name, slug: name.toLowerCase() })
    .returning();
  await db
    .insert(schema.groupMembers)
    .values(actorIds.map((actorId) => ({ groupId: row!.id, actorId })));
  return row!.id;
}

async function makeFriends(a: string, b: string) {
  await db.insert(schema.friendships).values([
    { actorId: a, friendActorId: b },
    { actorId: b, friendActorId: a },
  ]);
}

// --- proving a number --------------------------------------------------------

describe('a number nobody proved', () => {
  it('finds nobody, even though the hash matches', async () => {
    /*
     * The whole reason `phone_verified_at` exists. This is what the old route
     * wrote — a hash straight off a form — and matching on it means anybody can
     * type somebody else's digits and be returned as them.
     */
    const me = await person('me');
    const them = await person('them');
    const e164 = normalisePhone('+15550104477')!;
    await db
      .update(schema.actors)
      .set({ phoneHash: hashPhone(e164), phoneLast2: lastTwo(e164), discoverable: true })
      .where(eq(schema.actors.id, them));

    expect(await findByPhone(db, me, '+15550104477')).toEqual([]);
  });

  it('finds them once a code sent to it comes back', async () => {
    const me = await person('me');
    const them = await person('them');
    await withProvedNumber(them, '+15550104477');

    expect((await findByPhone(db, me, '+15550104477')).map((p) => p.handle)).toEqual([
      'them',
    ]);
  });
});

describe('the code that proves it', () => {
  it('hands back the number the row was opened with, never the digits', async () => {
    const me = await person('me');
    await startVerification(db, SECRET, me, '+15550104477', '123456');

    const check = await confirmVerification(db, SECRET, me, '123456');
    expect(check).toEqual({
      ok: true,
      phoneHash: hashPhone('+15550104477'),
      phoneLast2: '77',
    });

    // And the row itself never held them either. The pending table is the one
    // place a number could have been parked for ten minutes, and it is not.
    const [row] = await db.select().from(schema.phoneCodes);
    expect(JSON.stringify(row)).not.toContain('5550104477');
  });

  it('is spent on use, so the same code cannot claim a number twice', async () => {
    const me = await person('me');
    await startVerification(db, SECRET, me, '+15550104477', '123456');

    expect((await confirmVerification(db, SECRET, me, '123456')).ok).toBe(true);
    expect(await confirmVerification(db, SECRET, me, '123456')).toEqual({
      ok: false,
      reason: 'no_code',
    });
  });

  it('counts wrong guesses against the code, not the request', async () => {
    // A fresh code would otherwise reset the budget and there would be no
    // ceiling at all over a space of a million.
    const me = await person('me');
    await startVerification(db, SECRET, me, '+15550104477', '123456');

    for (let i = 0; i < MAX_PHONE_ATTEMPTS; i += 1) {
      expect(await confirmVerification(db, SECRET, me, '000000')).toEqual({
        ok: false,
        reason: 'wrong',
      });
    }
    // And now not even the right one, because the budget is gone.
    expect(await confirmVerification(db, SECRET, me, '123456')).toEqual({
      ok: false,
      reason: 'too_many',
    });
  });

  it('expires, and says so rather than failing to match', async () => {
    const me = await person('me');
    const longAgo = new Date(Date.now() - PHONE_CODE_TTL_MS - 1000);
    await startVerification(db, SECRET, me, '+15550104477', '123456', longAgo);

    expect(await confirmVerification(db, SECRET, me, '123456')).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('considers only the newest outstanding code', async () => {
    /*
     * Somebody mistypes their number, asks again with the right one, and then
     * presents the code. Two live rows would mean the older one claiming the
     * wrong number — the number they had just corrected.
     */
    const me = await person('me');
    await startVerification(db, SECRET, me, '+15550104466', '111111');
    await startVerification(db, SECRET, me, '+15550104477', '222222');

    expect(await confirmVerification(db, SECRET, me, '111111')).toMatchObject({
      ok: false,
      reason: 'wrong',
    });
    expect(await confirmVerification(db, SECRET, me, '222222')).toMatchObject({
      ok: true,
      phoneLast2: '77',
    });
  });

  it('cannot be presented by somebody else', async () => {
    // The stored hash is keyed on the actor, so a code read off one person's
    // phone is not a code another account can spend.
    const me = await person('me');
    const you = await person('you');
    await startVerification(db, SECRET, me, '+15550104477', '123456');

    expect(await confirmVerification(db, SECRET, you, '123456')).toEqual({
      ok: false,
      reason: 'no_code',
    });
  });
});

// --- the switch --------------------------------------------------------------

describe('letting people who have your number or address find you', () => {
  it('is off until a number is proved', async () => {
    // The column defaults false so that shipping it did not make every account
    // that already existed matchable by its address without anybody being asked.
    const me = await person('me');
    const [row] = await db
      .select({ discoverable: schema.actors.discoverable })
      .from(schema.actors)
      .where(eq(schema.actors.id, me));
    expect(row!.discoverable).toBe(false);
  });

  it('hides the number when it is off', async () => {
    const me = await person('me');
    const them = await person('them');
    await withProvedNumber(them, '+15550104477', false);

    expect(await findByPhone(db, me, '+15550104477')).toEqual([]);
  });

  it('hides the address when it is off', async () => {
    // The half that used to be missing. Turning the switch off retracted the
    // number and nothing else, so the sentence on the screen was half true.
    const me = await person('me');
    await person('them', 'them@example.test');

    expect(await findByEmail(db, me, 'them@example.test')).toEqual([]);
  });

  it('leaves the handle search alone', async () => {
    /*
     * A handle is a name somebody chose in order to be found by it. This setting
     * is about the two things they gave the product to be *reached* at, and
     * reading it in the handle search would quietly turn one switch into general
     * invisibility — a different promise from the one the screen makes.
     */
    const me = await person('me');
    await person('them');
    await withProvedNumber(await person('other'), '+15550104488', false);

    expect((await findPeople(db, me, 'them')).map((p) => p.handle)).toEqual(['them']);
  });
});

describe('finding somebody by an address you already have', () => {
  it('matches the whole address and nothing less', async () => {
    const me = await person('me');
    const them = await person('them', 'wren@example.test');
    await withProvedNumber(them, '+15550104477');

    expect((await findByEmail(db, me, 'wren@example.test')).map((p) => p.handle)).toEqual([
      'them',
    ]);
    // A prefix would be a way to read the account table one letter at a time.
    expect(await findByEmail(db, me, 'wren@example')).toEqual([]);
    expect(await findByEmail(db, me, 'wren')).toEqual([]);
  });

  it('ignores case and surrounding space, as sign-in does', async () => {
    const me = await person('me');
    const them = await person('them', 'wren@example.test');
    await withProvedNumber(them, '+15550104477');

    expect(await findByEmail(db, me, '  WREN@Example.Test ')).toHaveLength(1);
  });

  it('never returns you to yourself', async () => {
    const me = await person('me', 'me@example.test');
    await withProvedNumber(me, '+15550104477');
    expect(await findByEmail(db, me, 'me@example.test')).toEqual([]);
  });

  it('respects a block in either direction', async () => {
    const me = await person('me');
    const them = await person('them', 'wren@example.test');
    await withProvedNumber(them, '+15550104477');
    await db.insert(schema.blocks).values({ blockerActorId: them, blockedActorId: me });

    expect(await findByEmail(db, me, 'wren@example.test')).toEqual([]);
  });

  it('sends back no column that could hold an address', async () => {
    // An email belongs to its owner and to the people they gave it to. The
    // answer is a handle, a name and a picture, exactly as the handle search is.
    const me = await person('me');
    const them = await person('them', 'wren@example.test');
    await withProvedNumber(them, '+15550104477');

    const [found] = await findByEmail(db, me, 'wren@example.test');
    expect(Object.keys(found!).sort()).toEqual([
      'actorId',
      'avatarKey',
      'displayName',
      'handle',
      'standing',
    ]);
  });

  it('is told apart from a handle by the search box', () => {
    expect(looksLikeEmail('wren@example.test')).toBe(true);
    for (const input of ['wren', 'amber-quiet-lantern', '+15550104477', 'wren@local']) {
      expect(looksLikeEmail(input), input).toBe(false);
    }
  });
});

// --- who is recommended ------------------------------------------------------

describe('people you may know', () => {
  it('counts friends you have in common', async () => {
    const me = await person('me');
    const mutualFriend = await person('between');
    const them = await person('them');
    await makeFriends(me, mutualFriend);
    await makeFriends(mutualFriend, them);

    expect(await recommendationsFor(db, me)).toMatchObject([
      { handle: 'them', mutuals: 1, albums: 0, groups: 0 },
    ]);
  });

  it('counts albums you were both in', async () => {
    const me = await person('me');
    const them = await person('them');
    const a = await event('Naxos', me);
    const b = await event('The Anchor', me);
    await wereThere(a, [me, them]);
    await wereThere(b, [me, them]);

    expect(await recommendationsFor(db, me)).toMatchObject([
      { handle: 'them', albums: 2, mutuals: 0 },
    ]);
  });

  it('forgets an album that was deleted', async () => {
    // A deleted album is not a room anybody was in any more, and it is the only
    // record this would otherwise still be reading.
    const me = await person('me');
    const them = await person('them');
    const id = await event('Naxos', me);
    await wereThere(id, [me, them]);
    await db
      .update(schema.events)
      .set({ deletedAt: new Date() })
      .where(eq(schema.events.id, id));

    expect(await recommendationsFor(db, me)).toEqual([]);
  });

  it('counts groups you are both in', async () => {
    const me = await person('me');
    const them = await person('them');
    await group('Sunday', [me, them]);

    expect(await recommendationsFor(db, me)).toMatchObject([
      { handle: 'them', groups: 1, mutuals: 0, albums: 0 },
    ]);
  });

  it('puts mutual friends above albums, and albums above groups', async () => {
    /*
     * The order is the argument. A mutual friend is other people having already
     * vouched; an album is "we were in the same room"; a group is only "we are
     * both on a list". A single score would leave the screen saying "suggested"
     * and nothing a reader could check.
     */
    const me = await person('me');
    const between = await person('between');
    const byFriend = await person('a-friend-of-a-friend');
    const byAlbum = await person('b-was-there');
    const byGroup = await person('c-same-room');

    await makeFriends(me, between);
    await makeFriends(between, byFriend);
    const id = await event('Naxos', me);
    await wereThere(id, [me, byAlbum]);
    await group('Sunday', [me, byGroup]);

    expect((await recommendationsFor(db, me)).map((p) => p.handle)).toEqual([
      'a-friend-of-a-friend',
      'b-was-there',
      'c-same-room',
    ]);
  });

  it('adds up the reasons for one person rather than listing them twice', async () => {
    const me = await person('me');
    const between = await person('between');
    const them = await person('them');
    await makeFriends(me, between);
    await makeFriends(between, them);
    const id = await event('Naxos', me);
    await wereThere(id, [me, them]);
    await group('Sunday', [me, them]);

    const found = await recommendationsFor(db, me);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ mutuals: 1, albums: 1, groups: 1 });
  });

  it('never suggests you to yourself', async () => {
    const me = await person('me');
    const id = await event('Naxos', me);
    await wereThere(id, [me]);
    await group('Sunday', [me]);

    expect(await recommendationsFor(db, me)).toEqual([]);
  });

  it('leaves out people you are already friends with', async () => {
    // A suggestion is an offer to ask, and there is nothing left to ask.
    const me = await person('me');
    const them = await person('them');
    const id = await event('Naxos', me);
    await wereThere(id, [me, them]);
    await makeFriends(me, them);

    expect(await recommendationsFor(db, me)).toEqual([]);
  });

  it('leaves out anybody with a request open either way', async () => {
    const me = await person('me');
    const asked = await person('asked');
    const asking = await person('asking');
    const id = await event('Naxos', me);
    await wereThere(id, [me, asked, asking]);
    await db.insert(schema.friendRequests).values([
      { fromActorId: me, toActorId: asked },
      { fromActorId: asking, toActorId: me },
    ]);

    expect(await recommendationsFor(db, me)).toEqual([]);
  });

  it('leaves out a declined request too, rather than offering to ask again', async () => {
    const me = await person('me');
    const them = await person('them');
    const id = await event('Naxos', me);
    await wereThere(id, [me, them]);
    await db
      .insert(schema.friendRequests)
      .values({ fromActorId: me, toActorId: them, status: 'declined' });

    expect(await recommendationsFor(db, me)).toEqual([]);
  });

  it('respects a block in either direction', async () => {
    /*
     * The exclusion that matters most on this screen. This is the only list in
     * the product that puts a person in front of somebody who never looked for
     * them, so a missed block is somebody reappearing in front of the person who
     * cut them off, on a page they did not ask for.
     */
    const me = await person('me');
    const blocked = await person('blocked');
    const blocker = await person('blocker');
    const id = await event('Naxos', me);
    await wereThere(id, [me, blocked, blocker]);
    await db.insert(schema.blocks).values([
      { blockerActorId: me, blockedActorId: blocked },
      { blockerActorId: blocker, blockedActorId: me },
    ]);

    expect(await recommendationsFor(db, me)).toEqual([]);
  });

  it('leaves out a device that never signed in', async () => {
    const me = await person('me');
    const passing = await guest();
    const id = await event('Naxos', me);
    await wereThere(id, [me, passing]);

    expect(await recommendationsFor(db, me)).toEqual([]);
  });

  it('leaves out an actor that was merged away', async () => {
    const me = await person('me');
    const old = await person('old');
    const now = await person('now');
    const id = await event('Naxos', me);
    await wereThere(id, [me, old]);
    await db
      .update(schema.actors)
      .set({ mergedIntoId: now, accountId: null })
      .where(eq(schema.actors.id, old));

    expect(await recommendationsFor(db, me)).toEqual([]);
  });

  it('answers nothing for a browser that has not signed in', async () => {
    expect(await recommendationsFor(db, null)).toEqual([]);
  });

  it('does not read the discoverability switch', async () => {
    /*
     * Deliberately, and it is worth pinning because the opposite looks tidier.
     *
     * The switch says "do not use my number or my address to put me in front of
     * people". It does not say "hide me from the friends of my friends", who can
     * see me on a mutual friend's list already. Reading it here would make one
     * setting mean general invisibility, which is not what the screen offers.
     */
    const me = await person('me');
    const between = await person('between');
    const them = await person('them');
    await makeFriends(me, between);
    await makeFriends(between, them);
    await db
      .update(schema.actors)
      .set({ discoverable: false })
      .where(eq(schema.actors.id, them));

    expect((await recommendationsFor(db, me)).map((p) => p.handle)).toEqual(['them']);
  });
});

// --- what the feature is built out of ---------------------------------------

describe('no address book', () => {
  const source = (name: string) =>
    readFileSync(fileURLToPath(new URL(name, import.meta.url).href), 'utf8');

  it('asks for no contacts permission in either client', () => {
    /*
     * The promise the whole design rests on, and the one no behavioural
     * assertion above can protect: an uploaded address book is a list of people
     * who never agreed to anything, and it would be one commit and one
     * permission string away.
     *
     * Checked against the app's manifest and the iOS strings rather than against
     * a screen, because that is where the permission would have to be declared
     * before any code could ask for it.
     */
    const manifest = source('../../mobile/app.json');
    expect(manifest).not.toMatch(/CONTACTS|Contacts|expo-contacts/);
  });

  it('builds recommendations out of albums, groups and friendships only', () => {
    // The tables named in the statement are the whole of what this reads. A
    // fourth source would be a new kind of claim about how the product knows
    // two people are connected, and it should not arrive quietly.
    const friends = source('../src/friends.ts');
    const query = friends.slice(
      friends.indexOf('export async function recommendationsFor'),
      friends.indexOf('export type FriendRequest'),
    );
    expect(query).not.toBe('');
    const tables = [...query.matchAll(/from "(\w+)"|join "(\w+)"/g)].map(
      (m) => m[1] ?? m[2]!,
    );
    expect([...new Set(tables)].sort()).toEqual([
      'actor',
      'block',
      'event',
      'event_participant',
      'friend_request',
      'friendship',
      'group_member',
    ]);
  });
});
