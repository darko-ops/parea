/**
 * Whose page exists, and what it is allowed to hold.
 *
 * A profile is the first surface in this product that is *about a person*, so
 * the two things worth testing hardest are the two that are easy to widen by
 * accident: who has no page at all, and where the album list comes from.
 *
 * The second one is the whole safety property. "The viewer's albums, filtered
 * to the ones this person is also in" and "this person's albums, filtered to
 * the ones the viewer may see" describe the same list on a good day and
 * different lists on the day somebody forgets a clause — and the second one
 * fails open. These tests pin the direction by constructing exactly that day.
 */

import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { albumsWithBoth, profileFor } from '@/people';
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
    truncate "account", "actor", "event", "event_participant",
      "friend_request", "friendship", "block"
    restart identity cascade
  `);
});

/** An account, which is what "a person" means everywhere in this product. */
async function person(handle: string) {
  const [account] = await db
    .insert(schema.accounts)
    .values({ email: `${handle}@example.test` })
    .returning();
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: 'user', handle, accountId: account!.id })
    .returning();
  return row!.id;
}

/** An actor with no account behind it: a device that opened a link once. */
async function guest(handle: string | null = null) {
  const [row] = await db
    .insert(schema.actors)
    .values({ kind: 'user', handle })
    .returning();
  return row!.id;
}

async function album(createdBy: string, name = 'Party') {
  const [row] = await db
    .insert(schema.events)
    .values({ name, linkToken: newLinkToken(), createdBy })
    .returning();
  return row!;
}

const joins = (eventId: string, actorId: string) =>
  db.insert(schema.eventParticipants).values({ eventId, actorId });

const befriend = (a: string, b: string) =>
  db.insert(schema.friendships).values([
    { actorId: a, friendActorId: b },
    { actorId: b, friendActorId: a },
  ]);

const asks = (from: string, to: string, status = 'open') =>
  db
    .insert(schema.friendRequests)
    .values({ fromActorId: from, toActorId: to, status } as never)
    .returning();

describe('who has a page', () => {
  it('is anybody the search box would have returned', async () => {
    const me = await person('me');
    const them = await person('wren');

    expect(await profileFor(db, me, 'wren')).toMatchObject({
      actorId: them,
      handle: 'wren',
      standing: 'none',
    });
  });

  it('is found however the handle was typed', async () => {
    // The handle in a URL has been copied or typed by a person, and the unique
    // index is on `lower(handle)` — matching by case could only ever fail to
    // find somebody who is there.
    const me = await person('me');
    await person('Wren');
    expect(await profileFor(db, me, 'WREN')).toMatchObject({ handle: 'Wren' });
  });

  it('is nobody, for a handle nobody has', async () => {
    const me = await person('me');
    expect(await profileFor(db, me, 'nobody')).toBeNull();
  });

  it('is not a device that once opened a link', async () => {
    // `account_id is not null` is what "a person" means, here and in
    // `findPeople`. A guest actor is a browser, and a browser has no page.
    const me = await person('me');
    await guest('borrowed');
    expect(await profileFor(db, me, 'borrowed')).toBeNull();
  });

  it('is not an actor that was merged into another', async () => {
    const me = await person('me');
    const kept = await person('wren');
    const [merged] = await db
      .insert(schema.actors)
      .values({ kind: 'user', handle: 'old-wren', accountId: null, mergedIntoId: kept })
      .returning();
    expect(merged).toBeTruthy();
    expect(await profileFor(db, me, 'old-wren')).toBeNull();
  });

  it('is nobody at all to a browser that has not signed in', async () => {
    await person('wren');
    expect(await profileFor(db, null, 'wren')).toBeNull();
  });
});

describe('a block, from either side', () => {
  it('takes the page away from the person who blocked', async () => {
    const me = await person('me');
    const them = await person('wren');
    await db
      .insert(schema.blocks)
      .values({ blockerActorId: me, blockedActorId: them });

    expect(await profileFor(db, me, 'wren')).toBeNull();
  });

  it('takes it away from the person who was blocked, without saying so', async () => {
    /*
     * The one that matters. Blocking is silent, so the blocked party must get
     * the answer a made-up handle gets — a page that said "unavailable" would
     * be the product telling them what the blocker chose not to.
     */
    const me = await person('me');
    const them = await person('wren');
    await db
      .insert(schema.blocks)
      .values({ blockerActorId: them, blockedActorId: me });

    expect(await profileFor(db, me, 'wren')).toBeNull();
    expect(await profileFor(db, me, 'no-such-handle')).toBeNull();
  });
});

describe('where you and they stand', () => {
  it('knows your own page when you land on it', async () => {
    const me = await person('me');
    expect(await profileFor(db, me, 'me')).toMatchObject({ standing: 'self' });
  });

  it('says friends when you are', async () => {
    const me = await person('me');
    const them = await person('wren');
    await befriend(me, them);
    expect(await profileFor(db, me, 'wren')).toMatchObject({ standing: 'friends' });
  });

  it('says asked when you have asked', async () => {
    const me = await person('me');
    const them = await person('wren');
    await asks(me, them);
    expect(await profileFor(db, me, 'wren')).toMatchObject({
      standing: 'asked',
      requestId: null,
    });
  });

  it('still says asked when the answer was no', async () => {
    /*
     * Telling somebody they were refused is the refuser's to do. `/api/friends`
     * already answers a repeat ask with the status it holds, so a declined ask
     * cannot be pressed past; the page has to agree with that rather than
     * announcing the decline every time it is opened.
     */
    const me = await person('me');
    const them = await person('wren');
    await asks(me, them, 'declined');
    expect(await profileFor(db, me, 'wren')).toMatchObject({ standing: 'asked' });
  });

  it('hands over the request id when they are the one waiting', async () => {
    const me = await person('me');
    const them = await person('wren');
    const [request] = await asks(them, me);

    expect(await profileFor(db, me, 'wren')).toMatchObject({
      standing: 'asking',
      requestId: request!.id,
    });
  });

  it('shows their unanswered question ahead of your own', async () => {
    // Two asks crossing. The one you can act on is the one pointing at you,
    // and "Asked" over an unanswered request is the page hiding it.
    const me = await person('me');
    const them = await person('wren');
    await asks(me, them);
    await asks(them, me);

    expect(await profileFor(db, me, 'wren')).toMatchObject({ standing: 'asking' });
  });
});

describe('what the page looks like', () => {
  const VIEW = stripComments(
    readFileSync(fileURLToPath(new URL('../app/components/PersonView.tsx', import.meta.url)), 'utf8'),
  );
  const PAGE = stripComments(
    readFileSync(fileURLToPath(new URL('../app/u/[handle]/page.tsx', import.meta.url)), 'utf8'),
  );

  it('is your own profile, minus the parts that are yours', () => {
    /*
     * The same header and the same cards, so that somebody arriving from a
     * search result does not have to read the screen before reading the
     * person. What is missing is Edit — it is not theirs to edit — and what is
     * in its place is the one thing you can do about somebody.
     */
    expect(VIEW).toMatch(/className="you-head"/);
    expect(VIEW).toMatch(/<Avatar url=\{person\.avatar\}/);
    expect(VIEW).toMatch(/className="you-name"/);
    expect(VIEW).toMatch(/<EventCard key=\{album\.id\} event=\{album\} \/>/);
    expect(VIEW).not.toMatch(/Edit profile|you-edit/);
  });

  it('draws the albums with the builder every other screen uses', () => {
    // An album should not look like a different kind of thing depending on
    // which page it is on.
    expect(PAGE).toMatch(/albums=\{await toCards\(shared\)\}/);
  });

  it('says which kind of nothing it is', () => {
    /*
     * The two empty states are different sentences, not one sentence with a
     * word swapped. "Yet" is a fact about the two of you and is likely to
     * change; "Account Private" is the true answer to "why is this empty" for
     * anybody else — and neither says how much is behind the door.
     */
    expect(VIEW).toMatch(
      /standing === 'friends' \? 'No Albums Available Yet' : 'Account Private'/,
    );
  });

  it('sends you to your own profile rather than showing you a worse one', () => {
    // The album list here is "albums we are both in", which for yourself is
    // empty — so your own page would tell you your account is private.
    expect(PAGE).toMatch(/if \(person\.standing === 'self'\) redirect\('\/account'\)/);
  });

  it('says the same two things on the phone', () => {
    const NATIVE = stripComments(
      readFileSync(
        fileURLToPath(new URL('../../mobile/src/Person.tsx', import.meta.url)),
        'utf8',
      ),
    );
    expect(NATIVE).toMatch(
      /standing === 'friends' \? 'No Albums Available Yet' : 'Account Private'/,
    );
  });
});

describe('the albums on somebody’s page', () => {
  it('are the ones you are both in', async () => {
    const me = await person('me');
    const them = await person('wren');
    const together = await album(me, 'Barcelona');
    await joins(together.id, me);
    await joins(together.id, them);

    const shared = await albumsWithBoth(db, me, them);
    expect(shared.map((a) => a.name)).toEqual(['Barcelona']);
  });

  it('never include one of theirs you are not in', async () => {
    /*
     * The failure this file exists for. Their album, with them in it, and the
     * viewer nowhere near it — a list built from their side would show its
     * name, which is the product telling somebody what a stranger has been
     * doing.
     */
    const me = await person('me');
    const them = await person('wren');
    const theirs = await album(them, 'Their weekend');
    await joins(theirs.id, them);

    expect(await albumsWithBoth(db, me, them)).toEqual([]);
  });

  it('never include one of yours they are not in', async () => {
    const me = await person('me');
    const them = await person('wren');
    const mine = await album(me, 'Mine');
    await joins(mine.id, me);

    expect(await albumsWithBoth(db, me, them)).toEqual([]);
  });

  it('drop a deleted album, which is gone for both of you', async () => {
    const me = await person('me');
    const them = await person('wren');
    const gone = await album(me, 'Gone');
    await joins(gone.id, me);
    await joins(gone.id, them);
    await db
      .update(schema.events)
      .set({ deletedAt: new Date() })
      .where((await import('drizzle-orm')).eq(schema.events.id, gone.id));

    expect(await albumsWithBoth(db, me, them)).toEqual([]);
  });

  it('are nothing on your own page', async () => {
    // Every album you are in is one you are both in, which would make your own
    // page a second home screen.
    const me = await person('me');
    const mine = await album(me, 'Mine');
    await joins(mine.id, me);

    expect(await albumsWithBoth(db, me, me)).toEqual([]);
  });
});
