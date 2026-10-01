/**
 * The one place the admin API hands out a picture.
 *
 * Everything else in `src/admin.ts` returns identifiers and words, and
 * `access-chokepoint.test.ts` holds it to that. Reviewing a classifier flag is
 * the exception that needs a look: most flags are swimwear, and no label or
 * score tells a beach from something that does not belong. So looking is a
 * separate request, made by a named person, for one photo, and written down.
 *
 * What it will not show:
 *
 * - A photo under a child-safety hold. The runbook's first rule is not to
 *   open it, and nothing about a classifier flag changes that.
 * - A photo already out of sight — removed, deleted, or not yet derived.
 *   There is nothing left to decide about it.
 * - The original. The 640px `card` rendition is enough to judge by.
 *
 * The link is the ordinary signed one, so it lapses as every image link does
 * (within two hours), and a removal revokes it at once.
 */

import { schema } from '@parea/core';
import { and, eq } from 'drizzle-orm';

import { AdminConflict } from './admin';
import type { Db } from './db';
import { hasDerivatives, imageSrc } from './images';

export async function revealFlaggedPhoto(db: Db, staff: string, flagId: string): Promise<{ url: string }> {
  const [row] = await db
    .select({ flag: schema.moderationFlags, photo: schema.photos, capEpoch: schema.events.capEpoch })
    .from(schema.moderationFlags)
    .innerJoin(schema.photos, eq(schema.moderationFlags.photoId, schema.photos.id))
    .innerJoin(schema.events, eq(schema.photos.eventId, schema.events.id))
    .where(and(eq(schema.moderationFlags.id, flagId), eq(schema.moderationFlags.status, 'open')));
  if (!row) throw new AdminConflict('not_found');

  const { photo } = row;
  if (photo.status === 'quarantined') throw new AdminConflict('under_review');
  if (photo.status !== 'ready' || photo.deletedAt || !hasDerivatives(photo)) {
    throw new AdminConflict('not_shown');
  }

  // Written before the link exists, so there is no look without a record.
  await db.insert(schema.staffActions).values({
    staff,
    action: 'flag_photo_viewed',
    targetKind: 'photo',
    targetId: photo.id,
    note: `flag ${flagId}`,
  });

  return { url: await imageSrc(photo, 'card', row.capEpoch) };
}
