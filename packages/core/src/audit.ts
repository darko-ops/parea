/**
 * Writing down that a photo's visibility changed.
 *
 * One helper, used by everything that hides, quarantines, removes or restores
 * a photo — the web app, the deriver and the scheduled jobs. A second way to
 * write these rows is how one of the paths quietly stops writing them, and the
 * gap would only be noticed when somebody needed the record.
 *
 * Unlike `observe()`, this is *not* fire-and-forget. An observation is a
 * number about what happened and losing one costs a metric; this is the record
 * that someone acted, and losing one costs the answer to "who hid this". So it
 * throws, and callers write it inside whatever transaction or sequence already
 * guarantees the change itself.
 */

import * as schema from './schema';

export type ModerationAction =
  (typeof schema.moderationActions.$inferInsert)['action'];

export type ModerationRecord = {
  photoId: string;
  eventId: string;
  action: ModerationAction;
  /** Null when a rule acted rather than a person. `reason` must name the rule. */
  actorId?: string | null;
  reason: string;
};

/**
 * The reasons in use, named rather than spelled out at each call site.
 *
 * A closed set here rather than in the column, because the column has to
 * accept a reason invented after this file was last edited — an audit row with
 * an unfamiliar reason is still evidence, while a write that fails on an
 * unrecognised enum is a lost record.
 */
export const REASON = {
  /** The uploader removed their own photo. */
  uploaderRemoved: 'uploader_removed',
  /** A host actioned a removal request. */
  hostRemoved: 'host_removed',
  /** A host declined one, lifting any auto-hide. */
  hostDeclined: 'host_declined',
  /** Nobody answered a removal request within 48 hours. */
  autoHide48h: 'auto_hide_48h',
  /** A person reported it as child sexual abuse material. */
  reportedChildSafety: 'reported_child_safety',
  /** The ingest scanner matched it. */
  csamScanner: 'csam_scanner',
  /** The same bytes were already in this event; first writer won. */
  dedup: 'dedup',
  /** Bytes deleted after the tombstone grace window. */
  purgeGrace: 'purge_grace',
  /** Every photo of an actor who deleted their account and asked for them gone. */
  accountDeleted: 'account_deleted',
} as const;

export async function recordModeration(
  // `any` because the two callers hold different drizzle instances — a
  // postgres-js client in the deriver, a Next-side one in the app — and the
  // structural type that satisfies both is the whole builder surface. The
  // pipeline already takes this shape for the same reason.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  record: ModerationRecord,
): Promise<void> {
  await db.insert(schema.moderationActions).values({
    photoId: record.photoId,
    eventId: record.eventId,
    action: record.action,
    actorId: record.actorId ?? null,
    reason: record.reason,
  });
}
