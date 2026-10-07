/**
 * How far behind the deriver is: how many photographs are waiting, and how
 * long the oldest has. Numbers only — no photograph, event or person — which
 * is why the alarm route that asks can do so without authorizing anybody.
 */

import { schema } from '@parea/core';
import { and, asc, eq, gt, isNotNull, isNull, sql } from 'drizzle-orm';

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
