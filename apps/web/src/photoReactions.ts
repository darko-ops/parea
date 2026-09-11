/**
 * Reacting to a photograph.
 *
 * The same act as reacting to a message and deliberately not the same code.
 * A message reaction is bounded by who can read the thread; this one is
 * bounded by `visiblePhotos`, which also answers for removed, hidden and
 * blocked — three states a message does not have. Sharing a module would mean
 * one function satisfying two different bounds, and the day they disagree is
 * the day a reaction outlives the photograph it was about.
 *
 * What *is* shared is the set of emoji, from `reactions.ts`, because a picker
 * offering one thing on a photograph and another in a thread would be two
 * vocabularies in one product.
 */

import { schema } from '@parea/core';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Db } from './db';

/** Emoji to the people who chose it, and whether the viewer is one of them. */
export type PhotoReaction = { emoji: string; count: number; mine: boolean };

/**
 * Reactions for many photographs at once.
 *
 * One query for a page of them rather than one per photograph: the album is a
 * column of every picture in the event, and a query per row would make opening
 * one an N+1 that grows with the album.
 *
 * Blocked people are not filtered here. A reaction carries no name and no
 * face — it is a number on an emoji — so there is nothing of a blocked
 * person's to hide, and dropping their row would leak the block by making the
 * count differ between two viewers of the same photograph.
 */
export async function reactionsForPhotos(
  db: Db,
  photoIds: string[],
  viewerId: string | null,
): Promise<Map<string, PhotoReaction[]>> {
  const byPhoto = new Map<string, PhotoReaction[]>();
  if (photoIds.length === 0) return byPhoto;

  const rows = await db
    .select({
      photoId: schema.photoReactions.photoId,
      emoji: schema.photoReactions.emoji,
      actorId: schema.photoReactions.actorId,
    })
    .from(schema.photoReactions)
    .where(inArray(schema.photoReactions.photoId, photoIds));

  /** photo id → emoji → tally. Built once rather than per photograph. */
  const tallies = new Map<string, Map<string, PhotoReaction>>();
  for (const row of rows) {
    const forPhoto = tallies.get(row.photoId) ?? new Map<string, PhotoReaction>();
    const tally = forPhoto.get(row.emoji) ?? { emoji: row.emoji, count: 0, mine: false };
    tally.count += 1;
    if (viewerId != null && row.actorId === viewerId) tally.mine = true;
    forPhoto.set(row.emoji, tally);
    tallies.set(row.photoId, forPhoto);
  }

  for (const [photoId, forPhoto] of tallies) {
    byPhoto.set(
      photoId,
      [...forPhoto.values()].sort(
        // Most-reacted first, then by emoji so two polls agree. Never by time:
        // a pill that moves because somebody else tapped one is a pill that
        // moves under your finger.
        (a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji),
      ),
    );
  }

  return byPhoto;
}

/**
 * One tap on, one tap off.
 *
 * A delete that returns nothing means there was nothing to take back, so the
 * same call adds one — which makes this idempotent per (photo, person, emoji)
 * without a read first, and safe against the double-tap a phone will send.
 */
export async function togglePhotoReaction(
  db: Db,
  photoId: string,
  actorId: string,
  emoji: string,
): Promise<'added' | 'removed'> {
  const removed = await db
    .delete(schema.photoReactions)
    .where(
      and(
        eq(schema.photoReactions.photoId, photoId),
        eq(schema.photoReactions.actorId, actorId),
        eq(schema.photoReactions.emoji, emoji),
      ),
    )
    .returning({ emoji: schema.photoReactions.emoji });
  if (removed.length > 0) return 'removed';

  await db
    .insert(schema.photoReactions)
    .values({ photoId, actorId, emoji })
    // Two taps racing each other are one reaction, not a primary-key violation.
    .onConflictDoNothing();
  return 'added';
}

/**
 * How many of these a person may leave on one photograph.
 *
 * Not a rule about taste — it is the bound that stops one account turning a
 * picture into a wall of pills. Six is the whole offered set, so nobody
 * reaching it honestly has been stopped from anything.
 */
export const MAX_PER_PHOTO = 6;

export async function reactionCountFor(
  db: Db,
  photoId: string,
  actorId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.photoReactions)
    .where(
      and(
        eq(schema.photoReactions.photoId, photoId),
        eq(schema.photoReactions.actorId, actorId),
      ),
    );
  return row?.n ?? 0;
}
