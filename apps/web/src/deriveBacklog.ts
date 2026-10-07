/**
 * How far behind the deriver is: how many photographs are waiting, and how
 * long the oldest has. Numbers only — no photograph, event or person — which
 * is why the alarm route that asks can do so without authorizing anybody.
 */

import { schema } from '@parea/core';
import { and, asc, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm';

import type { Db } from './db';

/**
 * Older than this is a stuck photograph, not a queue. Its delivery has gone
 * astray and the hourly job deals with it; counted here it would keep the
 * alarm on for good after one lost message, and an alarm that is always on is
 * one nobody reads.
 */
const IGNORE_OLDER_THAN_MS = 6 * 60 * 60 * 1000;

export async function deriveBacklog(db: Db, now: Date): Promise<{ waiting: number; oldestWaitedMs: number }> {
  // Waiting: bytes landed, not yet through the deriver, not taken away.
  const waiting = and(
    eq(schema.photos.status, 'pending'),
    isNull(schema.photos.deletedAt),
    isNotNull(schema.photos.bytesAt),
    gt(schema.photos.bytesAt, new Date(now.getTime() - IGNORE_OLDER_THAN_MS)),
  );
  const [oldest] = await db
    .select({ bytesAt: schema.photos.bytesAt })
    .from(schema.photos)
    .where(waiting)
    .orderBy(asc(schema.photos.bytesAt))
    .limit(1);
  const [counted] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.photos)
    .where(waiting);
  return {
    waiting: counted?.count ?? 0,
    oldestWaitedMs: oldest?.bytesAt ? now.getTime() - oldest.bytesAt.getTime() : 0,
  };
}

/**
 * Photographs whose bytes arrived but which the deriver never took: the upload
 * was confirmed, and the message that should have woken the deriver was
 * refused (a queue over its quota), lost, or retried out while it was down.
 * Nothing else ever looks at these — the hourly sweep deliberately leaves a
 * confirmed upload alone — so without a resend they wait for ever.
 *
 * Waiting more than fifteen minutes, which no healthy queue does; and less
 * than a week, past which the stored file is not worth a delivery. Oldest
 * first, a bounded number at a time.
 */
export async function strandedPhotos(db: Db, now: Date, limit = 200): Promise<string[]> {
  const rows = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(
      and(
        eq(schema.photos.status, 'pending'),
        isNull(schema.photos.deletedAt),
        isNotNull(schema.photos.bytesAt),
        lt(schema.photos.bytesAt, new Date(now.getTime() - 15 * 60 * 1000)),
        gt(schema.photos.bytesAt, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
      ),
    )
    .orderBy(asc(schema.photos.bytesAt))
    .limit(limit);
  return rows.map((row) => row.id);
}
