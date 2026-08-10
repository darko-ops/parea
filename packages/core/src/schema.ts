/**
 * Data model — docs/design.md §4.
 *
 * Two deliberate departures from the doc, both noted there:
 *   - the table is `groups`, not `"group"`, to avoid quoting a reserved word
 *     in every hand-written query.
 *   - `event_participant` exists here and not in the doc. Without it,
 *     `joins_open` is unenforceable: "new people can no longer join, existing
 *     people keep access" requires knowing who is already in.
 */

import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// --- identity --------------------------------------------------------------

export const accounts = pgTable('account', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: createdAt(),
});

/**
 * Every upload, removal and membership belongs to an actor. A guest actor has
 * no credentials — just a signed cookie or a keychain token. Claiming an
 * account sets `accountId`; nothing else moves. See design §3.
 */
export const actors = pgTable('actor', {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind', { enum: ['guest', 'user'] }).notNull(),
  displayName: text('display_name'),
  accountId: uuid('account_id').references(() => accounts.id, {
    onDelete: 'set null',
  }),
  /** Set when a guest actor is merged into an account's canonical actor. */
  mergedIntoId: uuid('merged_into_id'),
  createdAt: createdAt(),
});

export const devices = pgTable('device', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => actors.id, { onDelete: 'cascade' }),
  platform: text('platform', { enum: ['ios', 'android'] }).notNull(),
  pushToken: text('push_token'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: createdAt(),
});

// --- groups ----------------------------------------------------------------

export const groups = pgTable('groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  /** Asked once at creation. Groups can be findable; photos never are. */
  findable: boolean('findable').notNull().default(false),
  createdAt: createdAt(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const groupMembers = pgTable(
  'group_member',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['member', 'admin'] })
      .notNull()
      .default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.actorId] })],
);

/**
 * Asking to join a findable group — design §3.
 *
 * Only needed for the search path: someone who found a group by name has no
 * relationship to it yet, so an admin decides. People who arrive through an
 * event they were already in do not go through this — they had access to the
 * photos already, and joining the group is just saying "keep me in the loop".
 */
export const groupJoinRequests = pgTable(
  'group_join_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['open', 'approved', 'declined'] })
      .notNull()
      .default('open'),
    createdAt: createdAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => actors.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    // One open request per person per group; a declined one can be re-made.
    uniqueIndex('group_join_request_open_idx')
      .on(t.groupId, t.actorId)
      .where(sql`${t.status} = 'open'`),
  ],
);

// --- events ----------------------------------------------------------------

export const events = pgTable(
  'event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * The credential. Separate from `id` so rotation is a column update rather
     * than a rewrite of every foreign key.
     */
    linkToken: text('link_token').notNull().unique(),
    /** Bumped on rotate; invalidates stored capabilities and signed image URLs. */
    capEpoch: integer('cap_epoch').notNull().default(1),
    name: text('name').notNull(),
    eventDate: date('event_date'),
    /** Drives auto-selection (design §7.3). Set at creation where possible. */
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    groupId: uuid('group_id').references(() => groups.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => actors.id),
    /** One value today. The point is that adding another is a branch, not a rewrite. */
    accessPolicy: text('access_policy', { enum: ['link_open'] })
      .notNull()
      .default('link_open'),
    joinsOpen: boolean('joins_open').notNull().default(true),
    uploadsOpen: boolean('uploads_open').notNull().default(true),
    /** Hard cap of one nudge, enforced in the schema so config can't lose it. */
    nudgedAt: timestamp('nudged_at', { withTimezone: true }),
    /** Retention lever; null when grouped. Populated but not enforced in v1. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('event_group_idx').on(t.groupId)],
);

/**
 * Who is already in. Required to enforce `joins_open` — see the header note.
 * A row appears the first time an actor successfully presents a credential.
 */
export const eventParticipants = pgTable(
  'event_participant',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.actorId] })],
);

/**
 * Spoken word-pairs, allocated from a pool and recycled after dormancy. The
 * pool is explicit so allocation is a SELECT ... FOR UPDATE SKIP LOCKED rather
 * than a generate-and-retry loop.
 */
export const codes = pgTable(
  'code',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    words: text('words').notNull().unique(),
    eventId: uuid('event_id').references(() => events.id, {
      onDelete: 'set null',
    }),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => [index('code_free_pool_idx').on(t.eventId)],
);

// --- photos ----------------------------------------------------------------

export const photos = pgTable(
  'photo',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => actors.id),
    /** Content-addressed: ev/<eventId>/<sha256>. Makes re-uploads idempotent. */
    storageKey: text('storage_key').notNull(),
    contentHash: bytea('content_hash'),
    /** Precomputed so a streaming zip can carry an exact Content-Length (§10). */
    crc32: bigint('crc32', { mode: 'number' }),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** Untrusted, and sometimes absent — see design §4 and §8. */
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    capturedOffsetMinutes: integer('captured_offset_minutes'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * `quarantined` is terminal and unlike every other state: the object is
     * retained rather than purged, because destroying it would destroy
     * evidence subject to a preservation duty. See docs/csam-runbook.md.
     */
    status: text('status', {
      enum: ['pending', 'ready', 'failed', 'removed', 'quarantined'],
    })
      .notNull()
      .default('pending'),
    /**
     * Temporarily invisible, pending a host decision on a removal request.
     * Distinct from deletion on purpose: being wrong in either direction is
     * bad, but hidden is recoverable and deleted is not.
     */
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // The dedup rule: one copy per event, ignoring tombstones.
    uniqueIndex('photo_event_hash_idx')
      .on(t.eventId, t.contentHash)
      .where(sql`${t.deletedAt} is null`),
    index('photo_event_time_idx').on(
      t.eventId,
      sql`coalesce(${t.capturedAt}, ${t.uploadedAt})`,
    ),
  ],
);

export const derivatives = pgTable(
  'derivative',
  {
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['thumb', 'grid', 'full'] }).notNull(),
    storageKey: text('storage_key').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    mime: text('mime').notNull(),
    /**
     * Recorded for the same reason the original's are (§10): an archive of
     * derivatives can only carry an exact Content-Length if their sizes and
     * CRCs are known without reading them.
     *
     * Nullable because derivatives written before this existed have neither,
     * and backfilling means re-deriving every photo. The download path refuses
     * rather than guessing — see the 409 in the download route.
     */
    byteSize: bigint('byte_size', { mode: 'number' }),
    crc32: bigint('crc32', { mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.photoId, t.kind] })],
);

export const reports = pgTable(
  'report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    /** Null: reporting never requires an account. */
    reporterActorId: uuid('reporter_actor_id').references(() => actors.id, {
      onDelete: 'set null',
    }),
    /**
     * `removal_request` goes to the event's host — "that's a photo of me,
     * please take it down". `abuse` comes to us, not the host, because the
     * host may be the problem.
     */
    kind: text('kind', {
      enum: ['removal_request', 'abuse', 'other'],
    }).notNull(),
    note: text('note'),
    status: text('status', { enum: ['open', 'actioned', 'declined'] })
      .notNull()
      .default('open'),
    /**
     * When an unanswered removal request auto-hides the photo. Hosts are
     * ordinary people who may not open the app for a week, and "wait
     * indefinitely for the host" is not an answer to someone asking for a
     * photo of themselves to come down.
     */
    autoHideAt: timestamp('auto_hide_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => actors.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index('report_open_idx').on(t.status, t.autoHideAt),
    index('report_photo_idx').on(t.photoId),
  ],
);

/**
 * A confirmed match from automated child-safety scanning at ingest.
 *
 * Separate from `report` on purpose. Reports are user-generated and routed to
 * a moderation queue; this is machine-detected, carries statutory duties in
 * the US (18 U.S.C. §2258A: report to NCMEC, then preserve for 90 days), and
 * must never appear in any host- or user-facing surface.
 *
 * The row exists to answer, months later and under scrutiny: what was
 * detected, by what, when, where is it, who uploaded it, was it reported, and
 * is the preservation window still open.
 */
export const safetyIncidents = pgTable(
  'safety_incident',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Nullable, and cleared rather than cascaded when the photo is finally
     * purged. Two requirements pull against each other here: the incident must
     * outlive the photo row, and once a hold genuinely lifts the photo must
     * become deletable. A cascade loses the record; a strict reference makes
     * the photo undeletable forever. Everything a reviewer needs — the object
     * key, the hash, the event, the uploader — is copied onto this row, so the
     * pointer going null costs nothing.
     */
    photoId: uuid('photo_id').references(() => photos.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').notNull(),
    uploaderActorId: uuid('uploader_actor_id').notNull(),
    /** Which scanner, and what it called it. Both matter to a reviewer. */
    provider: text('provider').notNull(),
    classification: text('classification').notNull(),
    /** Provider-side identifier, for corroboration without re-sending content. */
    providerReference: text('provider_reference'),
    /** The object, kept exactly where it was. Never re-encoded, never moved. */
    storageKey: text('storage_key').notNull(),
    contentHash: bytea('content_hash'),
    detectedAt: createdAt(),
    /**
     * Set by a human after filing. Deliberately not settable by any automated
     * path — see the runbook on why submission is not wired up.
     */
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    reportReference: text('report_reference'),
    /**
     * Objects under a hold are exempt from the purge job. Null means the hold
     * is open-ended and purge must skip it regardless of age.
     */
    preservationEndsAt: timestamp('preservation_ends_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    notes: text('notes'),
  },
  (t) => [
    index('safety_incident_open_idx').on(t.reportedAt, t.detectedAt),
    index('safety_incident_photo_idx').on(t.photoId),
  ],
);

/**
 * A personal block list — App Store Guideline 1.2 requires the ability to
 * block abusive users, and it is the right feature regardless.
 *
 * Two effects: the blocker stops seeing the blocked actor's uploads anywhere,
 * and the blocked actor cannot join events the blocker administers. It is
 * deliberately one-directional and invisible to the blocked party.
 */
export const blocks = pgTable(
  'block',
  {
    blockerActorId: uuid('blocker_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    blockedActorId: uuid('blocked_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerActorId, t.blockedActorId] })],
);

// --- relations -------------------------------------------------------------

export const eventRelations = relations(events, ({ one, many }) => ({
  group: one(groups, { fields: [events.groupId], references: [groups.id] }),
  creator: one(actors, { fields: [events.createdBy], references: [actors.id] }),
  photos: many(photos),
  participants: many(eventParticipants),
}));

export const photoRelations = relations(photos, ({ one, many }) => ({
  event: one(events, { fields: [photos.eventId], references: [events.id] }),
  uploader: one(actors, {
    fields: [photos.uploaderId],
    references: [actors.id],
  }),
  derivatives: many(derivatives),
}));

export const groupRelations = relations(groups, ({ many }) => ({
  members: many(groupMembers),
  events: many(events),
}));

export type Event = typeof events.$inferSelect;
export type Photo = typeof photos.$inferSelect;
export type Actor = typeof actors.$inferSelect;
export type Group = typeof groups.$inferSelect;
