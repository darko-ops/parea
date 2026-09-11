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
import { and, asc, desc, eq, inArray, not, sql } from 'drizzle-orm';

import type { Db } from './db';

/**
 * One reaction, and who left it.
 *
 * This was a tally — `{ emoji, count, mine }` — on the reasoning that a
 * reaction should say how many rather than who. The viewer names people now,
 * so it is a row per person, and two things follow from that which did not
 * apply to a count.
 *
 * The first is blocking. A count has no name in it, so there was nothing of a
 * blocked person's to hide and dropping their row would have leaked the block
 * by making the number differ between two viewers of one photograph. A named
 * reaction is the opposite on both halves: there *is* something to hide, and a
 * name missing from a list discloses nothing, because a list of names is not a
 * number anybody can check against somebody else's.
 *
 * The second is the handle. It is what the viewer prints, and it is already
 * how this product names a person in every list that is not a thread — an
 * actor id still does not cross this boundary.
 */
export type PhotoReaction = {
  emoji: string;
  /** What to print. The handle where there is one, else the display name. */
  name: string;
  /** True where this is the viewer's own. */
  mine: boolean;
};

/**
 * Reactions for many photographs at once.
 *
 * One query for a page of them rather than one per photograph: the album is a
 * column of every picture in the event, and a query per row would make opening
 * one an N+1 that grows with the album.
 *
 * Blocked people are filtered, in SQL and in both directions — the same rule
 * and the same reasoning as `messagesFor`. This is a reversal: while a
 * reaction was a count it was deliberately *not* filtered, because a missing
 * row would have changed a number that two people could compare. Now that it
 * carries a name there is something to hide and nothing to compare, so the
 * rule flips with it.
 *
 * In SQL rather than afterwards, so that adding a `limit` later cannot
 * silently return a short page instead of skipping the rows.
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
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
    })
    .from(schema.photoReactions)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.photoReactions.actorId))
    .where(
      and(
        inArray(schema.photoReactions.photoId, photoIds),
        viewerId
          ? not(
              sql`exists (
                select 1 from "block" b
                where (b.blocker_actor_id = ${viewerId}
                       and b.blocked_actor_id = ${schema.photoReactions.actorId})
                   or (b.blocked_actor_id = ${viewerId}
                       and b.blocker_actor_id = ${schema.photoReactions.actorId})
              )`,
            )
          : undefined,
      ),
    )
    /*
     * Newest first, then by actor.
     *
     * The column reads as "who has just said something about this", so the
     * most recent belongs at the top. The actor breaks ties: `created_at`
     * defaults to the transaction clock, so two reactions written in the same
     * instant would otherwise come back in either order and swap places
     * between two reads of the same photograph.
     */
    .orderBy(desc(schema.photoReactions.createdAt), asc(schema.photoReactions.actorId));

  for (const row of rows) {
    const list = byPhoto.get(row.photoId) ?? [];
    list.push({
      emoji: row.emoji,
      // The handle, which is what the viewer prints — and a display name only
      // where somebody has not chosen one.
      name: row.handle ?? row.displayName?.trim() ?? 'Someone',
      mine: viewerId != null && row.actorId === viewerId,
    });
    byPhoto.set(row.photoId, list);
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
