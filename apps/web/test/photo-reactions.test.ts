/**
 * Reacting to a photograph.
 *
 * The same act as reacting to a message and deliberately not the same code: a
 * message reaction is bounded by who can read the thread, a photo reaction by
 * `visiblePhotos`, which also answers for removed, hidden and blocked. The
 * checks below are mostly about the edges a pill has — one tap on, one tap
 * off, two taps racing, and a count that has to mean the same thing to two
 * people looking at the same picture.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import {
  MAX_PER_PHOTO,
  reactionCountFor,
  reactionsForPhotos,
  togglePhotoReaction,
} from '@/photoReactions';
import { REACTIONS } from '@/reactions';

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
    truncate "actor", "event", "photo", "photo_reaction", "block"
    restart identity cascade
  `);
});

let n = 0;
async function person(displayName = 'Someone', handle: string | null = null) {
  const [actor] = await db
    .insert(schema.actors)
    .values({ kind: 'guest', displayName, handle })
    .returning();
  return actor!.id;
}

async function photo(createdBy: string) {
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'An evening', linkToken: `t${++n}`, createdBy })
    .returning();
  const [row] = await db
    .insert(schema.photos)
    .values({
      eventId: event!.id,
      uploaderId: createdBy,
      storageKey: `k${n}`,
      mime: 'image/jpeg',
      byteSize: 1,
      status: 'ready',
    })
    .returning();
  return row!.id;
}

describe('one tap on, one tap off', () => {
  it('adds, then takes it back', async () => {
    const me = await person();
    const id = await photo(me);

    expect(await togglePhotoReaction(db, id, me, '❤️')).toBe('added');
    expect(await togglePhotoReaction(db, id, me, '❤️')).toBe('removed');
    expect((await reactionsForPhotos(db, [id], me)).get(id)).toBeUndefined();
  });

  it('leaves nothing behind when taken back', async () => {
    /*
     * No tombstone, unlike a deleted message. A reaction is not a thing
     * somebody said, so there is nothing the pictures either side of it could
     * appear to be answering — which is the whole argument for the gap.
     */
    const me = await person();
    const id = await photo(me);
    await togglePhotoReaction(db, id, me, '🔥');
    await togglePhotoReaction(db, id, me, '🔥');

    expect((await db.select().from(schema.photoReactions)).length).toBe(0);
  });

  it('names both people, and knows which one is you', async () => {
    /*
     * A row per person rather than a tally. The viewer prints who reacted, so
     * two people leaving the same emoji are two lines, not a count of two.
     */
    const me = await person('Me', 'darko');
    const them = await person('Them', 'priya');
    const id = await photo(me);
    await togglePhotoReaction(db, id, me, '❤️');
    await togglePhotoReaction(db, id, them, '❤️');

    const mine = (await reactionsForPhotos(db, [id], me)).get(id)!;
    expect(mine).toHaveLength(2);
    expect(mine.filter((r) => r.mine).map((r) => r.name)).toEqual(['darko']);
    expect([...mine].map((r) => r.name).sort()).toEqual(['darko', 'priya']);

    // The same picture, to somebody who has not reacted.
    const other = await person('Other');
    const theirs = (await reactionsForPhotos(db, [id], other)).get(id)!;
    expect(theirs.every((r) => !r.mine)).toBe(true);
  });

  it('prints the handle, falling back to a name', async () => {
    // The handle is what the viewer shows — without the `@`, which the client
    // does not add either.
    const named = await person('Ana Ruiz');
    const handled = await person('Whoever', 'tomas');
    const id = await photo(named);
    await togglePhotoReaction(db, id, named, '❤️');
    await togglePhotoReaction(db, id, handled, '😂');

    const names = (await reactionsForPhotos(db, [id], null)).get(id)!.map((r) => r.name);
    expect(names).toContain('Ana Ruiz');
    expect(names).toContain('tomas');
    expect(names.some((n) => n.startsWith('@'))).toBe(false);
  });

  it('hides somebody you have blocked, both ways round', async () => {
    /*
     * A reversal, and the reasoning reverses with it. While a reaction was a
     * count it was deliberately *not* filtered: a missing row would have
     * changed a number that two people could compare, which leaks the block.
     * A name has something to hide and nothing to compare.
     */
    const me = await person('Me', 'darko');
    const them = await person('Them', 'priya');
    const id = await photo(me);
    await togglePhotoReaction(db, id, me, '❤️');
    await togglePhotoReaction(db, id, them, '🔥');

    await db.insert(schema.blocks).values({ blockerActorId: me, blockedActorId: them });

    expect((await reactionsForPhotos(db, [id], me)).get(id)!.map((r) => r.name)).toEqual([
      'darko',
    ]);
    // And the blocked person does not see the blocker's either.
    expect((await reactionsForPhotos(db, [id], them)).get(id)!.map((r) => r.name)).toEqual([
      'priya',
    ]);
  });

  it('is one reaction however many times it races itself', async () => {
    // A phone will send the double-tap; the primary key and the conflict
    // clause between them make it one row.
    const me = await person();
    const id = await photo(me);
    await Promise.all([
      togglePhotoReaction(db, id, me, '👏'),
      togglePhotoReaction(db, id, me, '👏'),
      togglePhotoReaction(db, id, me, '👏'),
    ]);

    const rows = await db.select().from(schema.photoReactions);
    expect(rows.length).toBeLessThanOrEqual(1);
  });
});

describe('the order they come back in', () => {
  it('is newest first, so the column reads as what has just been said', async () => {
    const me = await person('Me', 'darko');
    const them = await person('Them', 'priya');
    const id = await photo(me);

    const { eq, and } = await import('drizzle-orm');
    await togglePhotoReaction(db, id, me, '😂');
    await db
      .update(schema.photoReactions)
      .set({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 1)) })
      .where(and(eq(schema.photoReactions.actorId, me), eq(schema.photoReactions.photoId, id)));
    await togglePhotoReaction(db, id, them, '🔥');
    await db
      .update(schema.photoReactions)
      .set({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 2)) })
      .where(and(eq(schema.photoReactions.actorId, them), eq(schema.photoReactions.photoId, id)));

    const list = (await reactionsForPhotos(db, [id], me)).get(id)!;
    expect(list.map((r) => r.name)).toEqual(['priya', 'darko']);
  });
});

describe('a page of photographs', () => {
  it('answers for all of them in one go', async () => {
    // An album is a column of every picture in the event; a query per row
    // would make opening one an N+1 that grows with the album.
    const me = await person();
    const ids = [await photo(me), await photo(me), await photo(me)];
    await togglePhotoReaction(db, ids[0]!, me, '❤️');
    await togglePhotoReaction(db, ids[2]!, me, '🙏');

    const all = await reactionsForPhotos(db, ids, me);
    expect(all.size).toBe(2);
    expect(all.get(ids[1]!)).toBeUndefined();
    expect(all.get(ids[2]!)![0]!.emoji).toBe('🙏');
    expect(all.get(ids[2]!)![0]!.mine).toBe(true);
  });

  it('returns an empty map rather than querying for nothing', async () => {
    expect((await reactionsForPhotos(db, [], null)).size).toBe(0);
  });

  it('keeps one photograph’s reactions off another', async () => {
    const me = await person();
    const mine = await photo(me);
    const other = await photo(me);
    await togglePhotoReaction(db, mine, me, '🔥');

    expect((await reactionsForPhotos(db, [other], me)).get(other)).toBeUndefined();
  });
});

describe('how many one person may leave', () => {
  it('is the whole offered set', async () => {
    // Nobody reaching the ceiling honestly has been stopped from anything.
    expect(MAX_PER_PHOTO).toBe(REACTIONS.length);
  });

  it('counts only this person, on this photograph', async () => {
    const me = await person();
    const them = await person();
    const id = await photo(me);
    const other = await photo(me);

    await togglePhotoReaction(db, id, me, '❤️');
    await togglePhotoReaction(db, id, me, '😂');
    await togglePhotoReaction(db, id, them, '🔥');
    await togglePhotoReaction(db, other, me, '🙏');

    expect(await reactionCountFor(db, id, me)).toBe(2);
    expect(await reactionCountFor(db, id, them)).toBe(1);
  });
});

describe('when the photograph goes', () => {
  it('takes its reactions with it', async () => {
    // The cascade, which is what stops a reaction outliving the picture it
    // was about.
    const me = await person();
    const id = await photo(me);
    await togglePhotoReaction(db, id, me, '❤️');

    const { eq } = await import('drizzle-orm');
    await db.delete(schema.photos).where(eq(schema.photos.id, id));

    expect((await db.select().from(schema.photoReactions)).length).toBe(0);
  });
});

/**
 * What counts as an emoji, now that the set is open.
 *
 * The picker offered six and the route checked against those six, so the list
 * was both the vocabulary and the validation. The app can reach the system
 * keyboard now, which changes the question from "which emoji do we like" to "is
 * this an emoji at all".
 *
 * The rule doing the real work is *one grapheme*. Without it the column under a
 * photograph is an unmoderated text channel with no length limit and no report
 * button, reached through a box labelled "pick an emoji" — which is the failure
 * these cases exist to prevent, not the taste ones.
 */
describe('what may be reacted with', () => {
  it('takes any single emoji, not just the six', async () => {
    const { isEmoji } = await import('../src/reactions');
    for (const emoji of ['❤️', '😂', '🦑', '🫠', '🇬🇷', '1️⃣', '👨‍👩‍👧‍👦', '🧑🏽‍🚀']) {
      expect(isEmoji(emoji), `${emoji} should be allowed`).toBe(true);
    }
  });

  it('refuses anything that is more than one of them', async () => {
    /*
     * Two emoji is a sentence, and a sentence is the thing a reaction is not.
     * Sequences that *look* like several — a family, a profession with a skin
     * tone — are one grapheme and pass above.
     */
    const { isEmoji } = await import('../src/reactions');
    for (const value of ['❤️❤️', '😂 ', ' 😂', '😂😂😂']) {
      expect(isEmoji(value), `${JSON.stringify(value)} should be refused`).toBe(false);
    }
  });

  it('refuses words, digits and empty strings', async () => {
    const { isEmoji } = await import('../src/reactions');
    for (const value of ['', 'a', '7', 'lol', 'nice photo', ' ', '\n']) {
      expect(isEmoji(value), `${JSON.stringify(value)} should be refused`).toBe(false);
    }
  });

  it('refuses anything that is not a string', async () => {
    const { isEmoji } = await import('../src/reactions');
    for (const value of [null, undefined, 42, {}, ['😂'], true]) {
      expect(isEmoji(value)).toBe(false);
    }
  });

  it('refuses a megabyte before it reaches the segmenter', async () => {
    // The length bound is not really about length — the grapheme check already
    // does that work — it is a cheap first refusal.
    const { isEmoji } = await import('../src/reactions');
    expect(isEmoji('😂'.repeat(100_000))).toBe(false);
  });

  it('still knows the offered six, for the picker that offers them', async () => {
    // `isReaction` did not go away: the set is still what a picker opens with,
    // and it is still the shared vocabulary between the two clients.
    const { isReaction, REACTIONS } = await import('../src/reactions');
    expect(REACTIONS).toHaveLength(6);
    for (const emoji of REACTIONS) expect(isReaction(emoji)).toBe(true);
    expect(isReaction('🦑')).toBe(false);
  });
});

/**
 * The two pushes a photograph can cause.
 *
 * Asserted against the routes rather than against Expo: what matters is who is
 * told and who is not, and both mistakes are silent. Telling somebody about
 * their own action spends a notification budget on nothing; failing to tell
 * the person a claim was made about is the whole feature not happening.
 */
describe('who hears about a photograph', () => {
  const read = async (path: string) =>
    (await import('node:fs')).readFileSync(
      (await import('node:url')).fileURLToPath(new URL(path, import.meta.url)),
      'utf8',
    );

  it('tells the uploader about a comment, and never about their own', async () => {
    const route = await read('../app/api/events/[id]/messages/route.ts');
    expect(route).toMatch(/if \(photoId && uploaderId && uploaderId !== actorId\)/);
    expect(route).toMatch(/notifyPhotoComment\(db, \{/);
    // Only the uploader. Everybody else in the album finds out by opening it.
    expect(route).toMatch(/toActorId: uploaderId/);
  });

  it('tells the person tagged, and never for a self-tag', async () => {
    const route = await read('../app/api/photos/[id]/tags/route.ts');
    expect(route).toMatch(/if \(target !== actorId\)/);
    expect(route).toMatch(/notifyPhotoTagged\(db, \{/);
    expect(route).toMatch(/toActorId: target/);
  });

  it('never makes the request wait on a push', async () => {
    /*
     * Fire-and-forget by design — see `notify.ts`. Somebody pressing Send must
     * not wait on Expo, and must certainly not see an error because Expo is
     * down: the comment and the tag are already written by this point.
     */
    for (const path of [
      '../app/api/events/[id]/messages/route.ts',
      '../app/api/photos/[id]/tags/route.ts',
    ]) {
      const route = await read(path);
      expect(route, path).toMatch(/void notifyPhoto(Comment|Tagged)\(/);
      expect(route, path).not.toMatch(/await notifyPhoto/);
    }
  });

  it('sends the remark rather than the fact of one', async () => {
    /*
     * "Maya commented on your photo" makes somebody open the app to find out
     * whether they wanted to, and most of the time the whole content of the
     * notification is six words that could have been in it.
     */
    const push = await read('../../../packages/push/src/index.ts');
    expect(push).toMatch(/case 'photo_comment':/);
    expect(push).toMatch(/\$\{notification\.who\}: \$\{/);
    // Trimmed by us, so it ends in an ellipsis rather than mid-word at
    // whatever width the phone happens to be.
    expect(push).toMatch(/said\.slice\(0, 80\)\.trimEnd\(\)/);
  });
});
