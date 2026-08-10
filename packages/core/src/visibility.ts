/**
 * What a given viewer may see — docs/design.md §13.
 *
 * Four independent reasons a photo does not appear, and they are separate on
 * purpose because they undo differently:
 *
 *   deleted   the uploader removed it, or the event was deleted. Terminal,
 *             purged after a grace window.
 *   removed   status set by moderation. Terminal for the viewer, retained for
 *             investigation.
 *   hidden    a removal request went unanswered for 48 hours. Reversible — the
 *             host can still decline and the photo comes back.
 *   blocked   the viewer blocked the uploader. Personal, invisible to the
 *             uploader, and does not affect anyone else's view.
 *
 * Collapsing any pair of these would lose something. In particular, a hidden
 * photo must not be deleted: the wrong call in either direction is bad, but
 * invisible is recoverable and gone is not.
 */

import { and, eq, isNull, notInArray, type SQL } from 'drizzle-orm';

import { photos } from './schema';

export type ViewerContext = {
  /** Actors this viewer has blocked. */
  blockedActorIds: string[];
};

/**
 * The WHERE clause for "photos of this event that this viewer should see".
 *
 * Every listing path must use this. A query that filters by hand will
 * eventually forget one of the four cases, and the one it forgets will be
 * `hidden` — the newest and least familiar.
 */
export function visiblePhotos(eventId: string, viewer: ViewerContext): SQL | undefined {
  const clauses: (SQL | undefined)[] = [
    eq(photos.eventId, eventId),
    eq(photos.status, 'ready'),
    isNull(photos.deletedAt),
    isNull(photos.hiddenAt),
  ];

  if (viewer.blockedActorIds.length > 0) {
    clauses.push(notInArray(photos.uploaderId, viewer.blockedActorIds));
  }

  return and(...clauses);
}

/**
 * Whether an unanswered removal request should hide its photo yet.
 *
 * Auto-*hide* rather than auto-delete. The person asking gets a bounded wait,
 * and the host keeps the ability to say no.
 */
export const REMOVAL_REQUEST_GRACE_HOURS = 48;

export function autoHideDeadline(from: Date = new Date()): Date {
  return new Date(from.getTime() + REMOVAL_REQUEST_GRACE_HOURS * 3600_000);
}
