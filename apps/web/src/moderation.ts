/**
 * Shared moderation plumbing — docs/design.md §13.
 *
 * The endpoints are thin; the parts worth centralising are resolving a photo
 * together with its event (so authorization always has an event in scope) and
 * loading a viewer's block list.
 */

import { schema, type ViewerContext } from '@parea/core';
import { and, eq } from 'drizzle-orm';

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

/** Empty for anonymous viewers — you cannot block anyone without an identity. */
export async function viewerContext(
  db: Db,
  actorId: string | null,
): Promise<ViewerContext> {
  if (!actorId) return { blockedActorIds: [] };
  const rows = await db
    .select({ blocked: schema.blocks.blockedActorId })
    .from(schema.blocks)
    .where(eq(schema.blocks.blockerActorId, actorId));
  return { blockedActorIds: rows.map((r) => r.blocked) };
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
