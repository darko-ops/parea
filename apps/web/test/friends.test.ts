/**
 * Friends, and the search that makes them findable.
 *
 * The search is the part worth testing hardest. It is the only read in this
 * product that walks the account table, so every bound on it — what it matches,
 * what it returns, who it leaves out — is the difference between "find somebody
 * you were told about" and "enumerate the users".
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import {
  areFriends,
  befriend,
  findPeople,
  friendsOf,
  requestsFor,
  suggestionsFor,
  unfriend,
} from '@/friends';

import { stripComments } from './support/source';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    truncate "account", "actor", "block", "friend_request", "friendship"
    restart identity cascade
  `);
});

/** Somebody with an account, which is what "a person" means to the search. */
async function person(handle: string, displayName: string | null = null) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${handle}@example.test` })
    .returning();
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'user', accountId: account!.id, handle, displayName })
    .returning();
  return actor!.id;
}

/** A device that has never signed in. Exists for anyone who opened a link. */
async function guest(handle: string | null = null) {
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', handle })
    .returning();
  return actor!.id;
}

describe('finding somebody by handle', () => {
  it('matches the start of a handle, not the middle', async () => {
    // Prefix only. Substring search would let somebody sweep the table with a
    // couple of common letters, which is enumeration wearing a search box.
    const me = await person('me');
    await person('AmberQuietLantern');

    expect((await findPeople(db, me, 'amber')).map((p) => p.handle)).toEqual([
      'AmberQuietLantern',
    ]);
    expect(await findPeople(db, me, 'quiet')).toEqual([]);
  });

  it('ignores case, because nobody remembers capitalising a handle', async () => {
    const me = await person('me');
    await person('AmberQuietLantern');
    expect(await findPeople(db, me, 'AMBERQ')).toHaveLength(1);
  });

  it('refuses a query too short to be aimed at anybody', async () => {
    const me = await person('me');
    await person('AmberQuietLantern');
    expect(await findPeople(db, me, 'a')).toEqual([]);
    expect(await findPeople(db, me, '')).toEqual([]);
  });

  it('never returns the searcher', async () => {
    const me = await person('AmberQuietLantern');
    expect(await findPeople(db, me, 'amber')).toEqual([]);
  });

  it('leaves out devices that have never signed in', async () => {
    // A guest actor exists for anybody who has ever opened a link. They are
    // not a person with an account and must not appear in a list of people.
    const me = await person('me');
    await guest('AmberQuietLantern');
    expect(await findPeople(db, me, 'amber')).toEqual([]);
  });

  it('leaves out an actor folded into another', async () => {
    // Merged actors keep their handle and their row. Returning one offers a
    // person who cannot be asked, because nothing points at them any more.
    const me = await person('me');
    const old = await person('AmberQuietLantern');
    const survivor = await person('survivor');
    await db
      .update(schema.actors)
      .set({ mergedIntoId: survivor })
      .where((await import('drizzle-orm')).eq(schema.actors.id, old));

    expect(await findPeople(db, me, 'amber')).toEqual([]);
  });

  it('hides each of two people from the other after a block', async () => {
    // Both directions. A block that still let them find you and ask to be
    // friends would be a block in name only — and one that let you find them
    // would tell you the block exists, which blocking is careful not to do.
    const me = await person('me');
    const them = await person('AmberQuietLantern');
    await db.insert(schema.blocks).values({ blockerActorId: me, blockedActorId: them });

    expect(await findPeople(db, me, 'amber')).toEqual([]);
    expect(await findPeople(db, them, 'me')).toEqual([]);
  });

  it('returns a handle, a name, a picture and where you stand, and nothing else', async () => {
    /*
     * The shape is the promise: no email, no events, no counts. A field added
     * here is a field published to anybody who can type a handle, so this test
     * exists to make that addition a decision rather than an accident.
     *
     * `avatarKey` is the picture, and it is a *key* — the storage address,
     * which does not expire. It never leaves the server in that form; the two
     * routes below presign it and drop the key, which is what the next
     * describe is about.
     *
     * `standing` was the decision. It is not a fact about the person found —
     * it is a fact about the *reader*: whether they have asked, been asked, or
     * are already friends. All three are things the reader did or was told
     * about, and the profile this row opens has printed the same word for as
     * long as there has been a profile. What it buys is a list that agrees
     * with that page: without it a result offers "Add friend" to somebody you
     * asked last week.
     */
    const me = await person('me');
    await person('AmberQuietLantern', 'Sam');
    const [found] = await findPeople(db, me, 'amber');
    expect(Object.keys(found!).sort()).toEqual([
      'actorId',
      'avatarKey',
      'displayName',
      'handle',
      'standing',
    ]);
  });

  it('says where you and each of them stand', async () => {
    /*
     * The four words, each from the reader's side. `asking` beats `asked` when
     * both are true, which is the order `profileFor` argues for: the one you
     * can act on is the one pointing at you, and a row saying "Requested" over
     * somebody's unanswered question is the list hiding it.
     */
    const me = await person('me');
    const stranger = await person('AmberQuietLantern');
    const friend = await person('AmberWarmHarbour');
    const asked = await person('AmberStillRiver');
    const asking = await person('AmberLongMeadow');

    await db.insert(schema.friendships).values([
      { actorId: me, friendActorId: friend },
      { actorId: friend, friendActorId: me },
    ]);
    await db
      .insert(schema.friendRequests)
      .values({ fromActorId: me, toActorId: asked, status: 'open' });
    await db
      .insert(schema.friendRequests)
      .values({ fromActorId: asking, toActorId: me, status: 'open' });

    const found = await findPeople(db, me, 'amber');
    const standing = Object.fromEntries(found.map((p) => [p.actorId, p.standing]));
    expect(standing[stranger]).toBe('none');
    expect(standing[friend]).toBe('friends');
    expect(standing[asked]).toBe('asked');
    expect(standing[asking]).toBe('asking');
  });

  it('keeps calling a refusal an ask', async () => {
    /*
     * A declined request reads the same as an open one, here and on the
     * profile and in `/api/friends`. "No" is said once rather than becoming
     * something to press past, and telling somebody they were refused is the
     * refuser's to do.
     */
    const me = await person('me');
    const them = await person('AmberQuietLantern');
    await db
      .insert(schema.friendRequests)
      .values({ fromActorId: me, toActorId: them, status: 'declined' });

    const [found] = await findPeople(db, me, 'amber');
    expect(found!.standing).toBe('asked');
  });
});

/**
 * The picture, on its way out.
 *
 * Faces were added to these two endpoints so a picker could be recognised
 * rather than read. What must not follow them out is the storage key: a
 * presigned URL is a permission that expires in an hour, and a key is an
 * internal address that expires never — the difference between handing
 * somebody a photograph and handing them the filing cabinet.
 *
 * Source checks, because the property is about the shape of a reply rather
 * than about anything a unit can be handed.
 */
describe('what the endpoints publish', () => {
  const read = (path: string) =>
    stripComments(
      readFileSync(fileURLToPath(new URL(`../app/api/${path}`, import.meta.url)), 'utf8'),
    );

  for (const route of ['friends/route.ts', 'people/route.ts']) {
    it(`presigns the picture and drops the key in ${route}`, () => {
      const source = read(route);
      // Signed through the same hour-long helper every other face uses.
      expect(source).toMatch(/avatar: await avatarUrl\(/);
      // And the key overwritten rather than merely not mentioned: both build
      // the reply by spreading the row, so a field left in place rides out.
      expect(source).toMatch(/avatarKey: undefined/);
    });
  }

  it('does not hand a key to a client component from the find page', () => {
    /*
     * The other door out, and the one a type will not catch: `friends` and
     * `suggested` are `Person` rows passed straight into a client component,
     * which serialises every property they carry whether the receiving type
     * declares it or not.
     */
    const page = stripComments(
      readFileSync(fileURLToPath(new URL('../app/find/page.tsx', import.meta.url)), 'utf8'),
    );
    expect(page).toMatch(/avatarKey: undefined/);
    expect(page).toMatch(/friends=\{friendFaces\}/);
    expect(page).toMatch(/suggested=\{suggestedFaces\}/);
  });
});

describe('being friends', () => {
  it('is symmetric, and both halves are written together', async () => {
    const a = await person('a');
    const b = await person('b');
    await befriend(db, a, b);

    expect(await areFriends(db, a, b)).toBe(true);
    expect(await areFriends(db, b, a)).toBe(true);
    expect((await friendsOf(db, a)).map((p) => p.handle)).toEqual(['b']);
    expect((await friendsOf(db, b)).map((p) => p.handle)).toEqual(['a']);
  });

  it('cannot be with yourself', async () => {
    const a = await person('a');
    await befriend(db, a, a);
    expect(await friendsOf(db, a)).toEqual([]);
  });

  it('is removed from both sides at once', async () => {
    // Half an unfriending leaves one person with a row the other cannot see,
    // and nothing in the product knows how to read that.
    const a = await person('a');
    const b = await person('b');
    await befriend(db, a, b);
    await unfriend(db, b, a);

    expect(await friendsOf(db, a)).toEqual([]);
    expect(await friendsOf(db, b)).toEqual([]);
  });

  it('doing it twice is not an error', async () => {
    const a = await person('a');
    const b = await person('b');
    await befriend(db, a, b);
    await expect(befriend(db, a, b)).resolves.toBeUndefined();
  });
});

describe('the requests waiting on you', () => {
  it('is the open ones pointed at you', async () => {
    const me = await person('me');
    const them = await person('them');
    const other = await person('other');
    await db.insert(schema.friendRequests).values([
      { fromActorId: them, toActorId: me },
      // Answered, and somebody else's — neither belongs in this list.
      { fromActorId: other, toActorId: me, status: 'declined' } as never,
      { fromActorId: me, toActorId: other },
    ]);

    const waiting = await requestsFor(db, me);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.handle).toBe('them');
  });

  it('is empty for somebody with no actor', async () => {
    expect(await requestsFor(db, null)).toEqual([]);
    expect(await friendsOf(db, null)).toEqual([]);
    expect(await findPeople(db, null, 'amber')).toEqual([]);
  });
});

/**
 * People worth asking, which the app now draws on Find.
 *
 * `suggestionsFor` has existed since the web's Find page was written, and the
 * web called it directly as a server component. The app cannot, so it reaches
 * it through `/api/people/suggestions` — and a query nothing outside one
 * server-rendered page had ever exercised is worth exercising before a second
 * client starts drawing faces from it.
 */
describe('people you may know', () => {
  it('is friends of your friends, most mutuals first', async () => {
    const me = await person('me');
    const ana = await person('ana');
    const bo = await person('bo');
    // Known by both of my friends; should lead.
    const common = await person('common');
    // Known by one; should follow.
    const distant = await person('distant');

    await befriend(db, me, ana);
    await befriend(db, me, bo);
    await befriend(db, ana, common);
    await befriend(db, bo, common);
    await befriend(db, ana, distant);

    const suggested = await suggestionsFor(db, me);
    expect(suggested.map((p) => p.handle)).toEqual(['common', 'distant']);
    expect(suggested[0]!.mutuals).toBe(2);
    expect(suggested[1]!.mutuals).toBe(1);
  });

  it('leaves out you, your friends, and anyone already asked', async () => {
    const me = await person('me');
    const ana = await person('ana');
    const already = await person('already');
    const pending = await person('pending');

    await befriend(db, me, ana);
    await befriend(db, ana, already);
    await befriend(db, ana, pending);
    // Already friends with one of my friend's friends.
    await befriend(db, me, already);
    // And a request open with the other, in either direction.
    await db.insert(schema.friendRequests).values({ fromActorId: me, toActorId: pending });

    const suggested = await suggestionsFor(db, me);
    expect(suggested.map((p) => p.handle)).toEqual([]);
  });

  it('leaves out a device that never signed in', async () => {
    /*
     * The same test everything here applies for "a person": an account, not a
     * device. A guest is somebody who opened a link, and suggesting them would
     * be suggesting a browser.
     */
    const me = await person('me');
    const ana = await person('ana');
    const device = await guest('device');
    await befriend(db, me, ana);
    await befriend(db, ana, device);

    expect(await suggestionsFor(db, me)).toEqual([]);
  });

  it('answers nothing for somebody with no friends, rather than failing', async () => {
    // Which is the common case on a new account, and it is arithmetic rather
    // than an error — the row in the app says so in words.
    expect(await suggestionsFor(db, await person('lonely'))).toEqual([]);
    expect(await suggestionsFor(db, null)).toEqual([]);
  });

  it('hands the app URLs and a count, never a storage key', async () => {
    const ROUTE = stripComments(
      readFileSync(
        fileURLToPath(new URL('../app/api/people/suggestions/route.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(ROUTE).toMatch(/avatar: await avatarUrl\(person\.avatarKey\)/);
    expect(ROUTE).not.toMatch(/avatarKey,/);
    expect(ROUTE).not.toMatch(/avatarKey:/);
    // And the mutual count, which is the whole difference between a suggestion
    // and a list.
    expect(ROUTE).toMatch(/mutuals: person\.mutuals/);
    // Signed in, not merely present.
    expect(ROUTE).toMatch(/isSignedIn/);
    expect(ROUTE).toMatch(/sign_in_required/);
  });
});

