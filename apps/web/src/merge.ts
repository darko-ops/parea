/**
 * Folding one actor into another — design §3.
 *
 * The situation is ordinary and the handling is not. Someone is a guest on
 * their phone with forty photos in three events. They sign in, and the address
 * already belongs to an account bound to the guest actor on their laptop. Both
 * actors are the same person, and after this they have to behave as one.
 *
 * ## Why rows move, rather than reads following an alias
 *
 * `actor.merged_into_id` invites the other design: leave the rows where they
 * are and resolve through the pointer on every read. That spreads the merge
 * across `authorize()`, the visibility predicate, every ownership check, the
 * quota, the block list — and one missed call site is not a cosmetic bug. It
 * is "you cannot delete your own photo", or a block that silently stops
 * applying. There is no test that catches the site nobody thought of.
 *
 * So the rows move, once, here, and the pointer is kept for one narrower job:
 * the losing actor's token is still in a keychain on a phone, and that phone
 * has to keep working. `currentActorId` follows the chain.
 *
 * ## What does not move
 *
 * `safety_incident.uploader_actor_id` has no foreign key and is left alone on
 * purpose. It records who uploaded a thing at the time it was uploaded, under
 * a preservation duty (§13). Rewriting it would edit evidence to match a
 * later account change, which is the opposite of what it is for.
 */

import { schema } from '@parea/core';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';

import type { Db } from './db';

export type MergeResult = {
  /** The actor that survives. */
  into: string;
  /** The actors folded in, in the order they were processed. */
  merged: string[];
};

/**
 * Every place an actor id is a live reference, and how a clash is settled.
 *
 * Enumerated rather than discovered, because the failure of an incomplete
 * merge is silent: a table nobody listed keeps pointing at the old actor, and
 * the person notices months later when some of their photos are not theirs.
 * `merge.test.ts` asserts this list against the schema, so a new table with an
 * actor column fails the suite instead of being forgotten.
 */
const OWNED: {
  table: string;
  column: string;
  /**
   * Columns that must stay unique alongside the actor. Present means a clash
   * is possible — both actors in the same group, the same event — and the
   * loser's row is dropped rather than moved, because the survivor already
   * has the relationship the row records.
   */
  uniqueWith?: string[];
}[] = [
  { table: 'device', column: 'actor_id' },
  { table: 'photo', column: 'uploader_id' },
  { table: 'event', column: 'created_by' },
  { table: 'event_participant', column: 'actor_id', uniqueWith: ['event_id'] },
  { table: 'group_member', column: 'actor_id', uniqueWith: ['group_id'] },
  { table: 'group_join_request', column: 'actor_id', uniqueWith: ['group_id'] },
  { table: 'group_join_request', column: 'resolved_by' },
  // Someone asks to join on a laptop, then signs in on their phone. Without
  // this the request the host is looking at names an actor that no longer
  // exists to approve, and approving it admits nobody.
  { table: 'event_access_request', column: 'actor_id', uniqueWith: ['event_id'] },
  { table: 'event_access_request', column: 'resolved_by' },
  { table: 'report', column: 'reporter_actor_id' },
  { table: 'report', column: 'resolved_by' },
  { table: 'moderation_flag', column: 'resolved_by' },
  { table: 'block', column: 'blocker_actor_id', uniqueWith: ['blocked_actor_id'] },
  { table: 'block', column: 'blocked_actor_id', uniqueWith: ['blocker_actor_id'] },
  { table: 'observation', column: 'actor_id' },
  { table: 'friend_request', column: 'from_actor_id', uniqueWith: ['to_actor_id'] },
  { table: 'friend_request', column: 'to_actor_id', uniqueWith: ['from_actor_id'] },
  { table: 'friendship', column: 'actor_id', uniqueWith: ['friend_actor_id'] },
  { table: 'friendship', column: 'friend_actor_id', uniqueWith: ['actor_id'] },
  // Somebody talks in an event's thread from a laptop and then signs in on
  // their phone. Without this their own messages stop being theirs — no edit,
  // no delete, and the name on them belongs to an actor nothing points at.
  { table: 'event_message', column: 'author_actor_id' },
  // Both actors having reacted with the same emoji to the same message is one
  // reaction, not two, so the loser's row goes rather than moving — which is
  // also what the primary key requires.
  // Somebody invited on a laptop and then signing in on their phone would
  // otherwise find the invitation addressed to an actor nothing points at —
  // unanswerable, and invisible on the screen that lists it.
  { table: 'event_invite', column: 'actor_id', uniqueWith: ['event_id'] },
  { table: 'event_invite', column: 'invited_by_actor_id' },
  // The same for a group. An invitation addressed to an actor nothing points
  // at is unanswerable and invisible on the screen that lists it, and this one
  // is worse to lose than an event's: a group is the thing that survives, so
  // the invitation is the only route into a room somebody meant you to be in.
  { table: 'group_invite', column: 'actor_id', uniqueWith: ['group_id'] },
  { table: 'group_invite', column: 'invited_by_actor_id' },
  {
    table: 'message_reaction',
    column: 'actor_id',
    uniqueWith: ['message_id', 'emoji'],
  },
  // Lines somebody has dismissed on Activity. Moved rather than dropped: the
  // feed is derived from rows that survive the merge, so a notification hidden
  // on the laptop would otherwise come back the moment the phone signs in —
  // the same line, unhidden, because the key was filed under an actor nothing
  // points at.
  { table: 'hidden_activity', column: 'actor_id', uniqueWith: ['item_key'] },
];

export const MERGED_TABLES = OWNED;

/**
 * Folds `from` into `into`. Idempotent, and safe to call with either order.
 *
 * Runs in one transaction: a merge that stops halfway leaves a person owning
 * some of their own photos, which is worse than not having merged at all.
 */
export async function mergeActor(
  db: Db,
  from: string,
  into: string,
): Promise<MergeResult> {
  if (from === into) return { into, merged: [] };

  await db.transaction(async (tx) => {
    for (const { table, column, uniqueWith } of OWNED) {
      if (uniqueWith?.length) {
        // Drop what would collide first, then move the rest. Doing it the
        // other way round makes the UPDATE fail on the constraint.
        const match = uniqueWith
          .map((other) => `mine.${other} = theirs.${other}`)
          .join(' and ');
        await tx.execute(
          sql.raw(`
            delete from "${table}" theirs
            where theirs."${column}" = '${from}'
              and exists (
                select 1 from "${table}" mine
                where mine."${column}" = '${into}' and ${match}
              )
          `),
        );
      }
      await tx.execute(
        sql.raw(
          `update "${table}" set "${column}" = '${into}' where "${column}" = '${from}'`,
        ),
      );
    }

    /*
     * A blocked B, and A and B turn out to be the same person. The row now
     * says someone blocked themselves, which nothing else in the product can
     * produce and the visibility predicate would honour.
     *
     * Friendship has the same shape and the same problem: two devices that
     * asked each other, merged, leave a person friends with themselves — which
     * would put them in their own friends list with a Remove button.
     */
    await tx
      .delete(schema.blocks)
      .where(eq(schema.blocks.blockerActorId, schema.blocks.blockedActorId));
    await tx
      .delete(schema.friendships)
      .where(eq(schema.friendships.actorId, schema.friendships.friendActorId));
    await tx
      .delete(schema.friendRequests)
      .where(eq(schema.friendRequests.fromActorId, schema.friendRequests.toActorId));

    /*
     * The number comes across, if the survivor has none.
     *
     * A phone number is unique across actors, so it cannot simply be left on
     * the loser: the row is tombstoned and the number goes with it, and the
     * person finds their own number unclaimed and themselves unfindable by it.
     * Carried only into an empty slot — the survivor's own number is the one
     * they set most recently and the one they expect to keep.
     */
    const [loser] = await tx
      .select({ hash: schema.actors.phoneHash, last2: schema.actors.phoneLast2 })
      .from(schema.actors)
      .where(eq(schema.actors.id, from));
    if (loser?.hash) {
      await tx
        .update(schema.actors)
        .set({ phoneHash: loser.hash, phoneLast2: loser.last2 })
        .where(and(eq(schema.actors.id, into), isNull(schema.actors.phoneHash)));
    }

    // Tombstoned rather than deleted: the phone that owned this actor still
    // has its token in the keychain, and `currentActorId` follows the pointer
    // so that phone keeps working without anyone signing in again.
    await tx
      .update(schema.actors)
      .set({ mergedIntoId: into, accountId: null, phoneHash: null, phoneLast2: null })
      .where(eq(schema.actors.id, from));

    // Anything that pointed at the loser now points at the survivor, so a
    // chain never grows past one hop.
    await tx
      .update(schema.actors)
      .set({ mergedIntoId: into })
      .where(and(eq(schema.actors.mergedIntoId, from), ne(schema.actors.id, into)));
  });

  return { into, merged: [from] };
}

/**
 * Follows `merged_into_id` to the actor that is really meant.
 *
 * Bounded rather than looped to exhaustion: a cycle here would hang every
 * authenticated request, and merges are written so a chain is one hop, so
 * more than a couple means something is wrong and stopping is the safe
 * answer.
 */
export async function resolveActor(db: Db, actorId: string): Promise<string> {
  let current = actorId;
  for (let hop = 0; hop < 4; hop++) {
    const [row] = await db
      .select({ mergedIntoId: schema.actors.mergedIntoId })
      .from(schema.actors)
      .where(eq(schema.actors.id, current))
      .limit(1);
    if (!row?.mergedIntoId) return current;
    current = row.mergedIntoId;
  }
  return current;
}

/** Every actor an account speaks for, survivor first. */
export async function actorsOfAccount(db: Db, accountId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.actors.id })
    .from(schema.actors)
    .where(or(eq(schema.actors.accountId, accountId)));
  return rows.map((r) => r.id);
}
