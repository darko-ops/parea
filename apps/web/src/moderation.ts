/**
 * Shared moderation plumbing — docs/design.md §13.
 *
 * The endpoints are thin; the parts worth centralising are resolving a photo
 * together with its event (so authorization always has an event in scope) and
 * loading a viewer's block list.
 */

import { schema, type ViewerContext } from '@parea/core';
import { and, eq, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';

import type { EventRow } from './access';
import type { Db } from './db';

export type PhotoRow = typeof schema.photos.$inferSelect;

/**
 * Photos are only ever reachable through their event — that is what makes a
 * future per-collection access rule expressible, and what stops any handler
 * from authorizing against nothing.
 */
export async function findPhotoWithEvent(
  db: Db,
  photoId: string,
): Promise<{ photo: PhotoRow; event: EventRow } | null> {
  const [row] = await db
    .select({ photo: schema.photos, event: schema.events })
    .from(schema.photos)
    .innerJoin(schema.events, eq(schema.photos.eventId, schema.events.id))
    .where(eq(schema.photos.id, photoId))
    .limit(1);
  return row ?? null;
}

/**
 * Everybody a block stands between this viewer and, in either direction.
 *
 * It used to be only the people this viewer had blocked, so a block hid their
 * photographs from you and left yours in front of them — in every album you
 * were both in. Now it is both sides, and every photo listing that goes
 * through `visiblePhotos` hides the two of you from each other.
 *
 * Empty for anonymous viewers — you cannot block anyone without an identity.
 */
export async function viewerContext(
  db: Db,
  actorId: string | null,
): Promise<ViewerContext> {
  if (!actorId) return { blockedActorIds: [] };
  const rows = await db
    .select({ blocker: schema.blocks.blockerActorId, blocked: schema.blocks.blockedActorId })
    .from(schema.blocks)
    .where(or(eq(schema.blocks.blockerActorId, actorId), eq(schema.blocks.blockedActorId, actorId)));
  const others = rows.map((r) => (r.blocker === actorId ? r.blocked : r.blocker));
  return { blockedActorIds: [...new Set(others)] };
}

/**
 * The SQL for "a block stands between `viewer` and the actor in `column`",
 * either way round. For the queries written in SQL rather than through
 * `visiblePhotos`; every one of them should say it the same way.
 */
export function blockedBetween(viewer: string, column: SQL | AnyColumn): SQL {
  return sql`exists (
    select 1 from "block" b
    where (b.blocker_actor_id = ${viewer} and b.blocked_actor_id = ${column})
       or (b.blocked_actor_id = ${viewer} and b.blocker_actor_id = ${column})
  )`;
}

/** Whether a block stands between these two people, in either direction. */
export async function blockedEitherWay(db: Db, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ one: schema.blocks.blockedActorId })
    .from(schema.blocks)
    .where(
      or(
        and(eq(schema.blocks.blockerActorId, a), eq(schema.blocks.blockedActorId, b)),
        and(eq(schema.blocks.blockerActorId, b), eq(schema.blocks.blockedActorId, a)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Whether `blocker` has blocked `candidate`.
 *
 * Used to stop a blocked actor rejoining an event the blocker administers,
 * which is the second half of what a block means.
 */
export async function isBlockedBy(
  db: Db,
  blockerActorId: string,
  candidateActorId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ one: schema.blocks.blockedActorId })
    .from(schema.blocks)
    .where(
      and(
        eq(schema.blocks.blockerActorId, blockerActorId),
        eq(schema.blocks.blockedActorId, candidateActorId),
      ),
    )
    .limit(1);
  return row !== undefined;
}
