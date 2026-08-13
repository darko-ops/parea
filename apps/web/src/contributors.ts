/**
 * Who put the photographs here, for the filter above the grid.
 *
 * A 214-photo grid raises "whose is this?", and until now the event page could
 * only answer it in aggregate — "from 6 people". This is the list behind that
 * number.
 *
 * It is a real change in what an event discloses, so it is worth being precise
 * about what it does and does not add. The photographs were already visible to
 * anybody holding the link; what is new is the names beside them. Two things
 * keep that bounded:
 *
 *   - It is built from the rows the caller already filtered through
 *     `visiblePhotos`, so somebody you have blocked is not in this list any
 *     more than their photos are in the grid. Passing unfiltered rows would
 *     quietly undo a block, which is why this takes rows rather than doing its
 *     own query.
 *   - The identifier that leaves the server is a digest of the actor id and
 *     the event id, not the actor id. It is stable across polls, which is all
 *     the client needs to keep a filter selected, and it is useless anywhere
 *     else — the same person in two events has two keys, so a leaked link
 *     cannot be used to follow somebody between them.
 */

import { schema } from '@parea/core';
import { createHash } from 'node:crypto';
import { inArray } from 'drizzle-orm';

import type { Db } from './db';

export type Contributor = {
  /** Opaque and per-event. See the note above; never an actor id. */
  key: string;
  /** Display name, else handle, else "Someone". */
  name: string;
  photoCount: number;
  /** Whether this is the person looking. Drives the "Mine" chip. */
  mine: boolean;
};

/**
 * The client-facing name for one contributor within one event.
 *
 * Truncated to 12 hex characters — 48 bits. This is not a secret and does not
 * need to resist a search; it needs to not collide inside a single event's
 * contributor list, and 48 bits is enormous for a list whose realistic maximum
 * is a few dozen.
 */
export function contributorKey(eventId: string, actorId: string): string {
  return createHash('sha256').update(`${eventId}:${actorId}`).digest('hex').slice(0, 12);
}

/** A photo row, narrowed to the one column this needs. */
type Uploaded = { uploaderId: string | null };

/**
 * Ordered most photos first, then by name.
 *
 * Not by name alone: the chips are a way of getting to a lot of photographs,
 * and the person who took sixty of them is the more useful chip to reach
 * first. The name is only there to break ties deterministically, so the row
 * does not reshuffle under someone's finger between two polls.
 */
export async function contributorsOf(
  db: Db,
  eventId: string,
  rows: Uploaded[],
  viewerId: string | null,
): Promise<Contributor[]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.uploaderId) continue;
    counts.set(row.uploaderId, (counts.get(row.uploaderId) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const actors = await db
    .select({
      id: schema.actors.id,
      displayName: schema.actors.displayName,
      handle: schema.actors.handle,
    })
    .from(schema.actors)
    .where(inArray(schema.actors.id, [...counts.keys()]));

  const named = new Map(actors.map((actor) => [actor.id, actor]));

  return [...counts.entries()]
    .map(([actorId, photoCount]) => {
      const actor = named.get(actorId);
      return {
        key: contributorKey(eventId, actorId),
        // "Someone" rather than an id or a blank: a guest who arrived by link
        // and added photos has neither a name nor a handle, and they are still
        // a person whose photographs are in the grid.
        name: actor?.displayName?.trim() || (actor?.handle ? `@${actor.handle}` : 'Someone'),
        photoCount,
        mine: viewerId != null && actorId === viewerId,
      };
    })
    .sort((a, b) => b.photoCount - a.photoCount || a.name.localeCompare(b.name));
}
