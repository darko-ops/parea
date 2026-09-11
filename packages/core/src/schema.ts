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
  /** Normalised before it gets here — see `normaliseEmail`. */
  email: text('email').notNull().unique(),
  createdAt: createdAt(),
});

/**
 * A one-time sign-in code — design §3.
 *
 * No passwords, and not because they are hard: an account here holds an email
 * address and nothing else, so a password would be the most sensitive thing in
 * the system, protecting the least. Codes need no storage of a secret, no
 * reset flow, and no "forgot" path that is itself the weakest link.
 *
 * A code and not a magic link, for a reason specific to this product: mail
 * often opens on a different device from the one signing in, and a link that
 * has to be tapped on the right phone fails exactly when someone is setting up
 * a new one — which is the main thing accounts are for here.
 *
 * The code is stored as an HMAC, never in the clear, so a read of this table
 * grants nothing. Rows are consumed on use and expire quickly; the purge job
 * clears the rest.
 */
export const signInCodes = pgTable(
  'sign_in_code',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    codeHash: bytea('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    /**
     * Wrong guesses against this code. Six digits is a million, but a million
     * is only a few hours of guessing without a ceiling, and the ceiling has
     * to be per code rather than per request or a new code resets it.
     */
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('sign_in_code_email_idx').on(t.email, t.createdAt)],
);

/**
 * Every upload, removal and membership belongs to an actor. A guest actor has
 * no credentials — just a signed cookie or a keychain token. Claiming an
 * account sets `accountId`; nothing else moves. See design §3.
 */
export const actors = pgTable(
  'actor',
  {
  id: uuid('id').primaryKey().defaultRandom(),
  kind: text('kind', { enum: ['guest', 'user'] }).notNull(),
  displayName: text('display_name'),
  /**
   * A name that is unique, unlike `display_name` which is not and should not
   * be — two people called Sam at the same party are two people called Sam.
   *
   * Stored with its capitals and unique without them; see the note in
   * `handles.ts` for why those are two different questions. Everyone gets one
   * on signing in, so this is null only for guests and for accounts that
   * cleared theirs.
   */
  handle: text('handle'),
  /**
   * Object key for the profile picture, or null. Not a URL: the bucket is
   * private and reads are presigned per request, so a stored URL would be a
   * stored credential with an expiry.
   */
  avatarKey: text('avatar_key'),
  /**
   * A phone number, kept as a keyed hash and never as a number.
   *
   * It exists for one thing: somebody who already has your number being able
   * to find you. That is the whole feature, and it is why the column is a
   * hash — the product has no use for the digits themselves, so it does not
   * hold them, and a copy of this table is not a phone book.
   *
   * HMAC rather than a bare digest, because the space of phone numbers is
   * about ten billion and a plain SHA-256 of one is reversible on a laptop in
   * an afternoon. The key lives in the environment; see `phone.ts`.
   *
   * Unique, so a number names at most one account. Somebody claiming a number
   * another account holds is told so rather than quietly given a second
   * listing that makes "find by number" ambiguous.
   */
  phoneHash: text('phone_hash').unique(),
  /**
   * The last two digits, in the clear, and nothing else.
   *
   * So the profile can say "••• ••• ••47" and somebody can tell which of their
   * numbers they gave us. Two digits identify nobody; the alternative is a
   * screen that can only say "a number is set", which is not enough to answer
   * "is it my old one?".
   */
  phoneLast2: text('phone_last2'),
  /**
   * A line or two somebody writes about themselves, shown on their profile.
   *
   * Bounded short on purpose. This is a product about photographs of an
   * evening, not a place to be somebody — a bio with room for paragraphs is a
   * bio that becomes a page, and the page would need moderating like one.
   */
  bio: text('bio'),
  /**
   * When this actor last opened Invites.
   *
   * The whole of "unread" for that screen. A per-row `seen` flag on every
   * invitation and every answer would be more state to write, more to migrate
   * and one more thing to get out of step; a single timestamp says the same
   * thing and cannot disagree with itself.
   *
   * Null means never, which counts everything — right for someone who has an
   * event waiting from before this column existed.
   */
  invitesSeenAt: timestamp('invites_seen_at', { withTimezone: true }),
  accountId: uuid('account_id').references(() => accounts.id, {
    onDelete: 'set null',
  }),
  /** Set when a guest actor is merged into an account's canonical actor. */
  mergedIntoId: uuid('merged_into_id'),
  createdAt: createdAt(),
  },
  (t) => [
    // On `lower(handle)` rather than on the column: the column keeps the case
    // someone typed, and `Sam` and `sam` still have to be one account. This is
    // the only thing that actually decides a race for a handle — the check in
    // the route ahead of it is there to produce a sentence, not a guarantee.
    uniqueIndex('actor_handle_idx').on(sql`lower(${t.handle})`),
  ],
);

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
/**
 * An admin asking somebody into a group, rather than waiting to be asked.
 *
 * The mirror of `group_join_request`, and the pair answers the question this
 * table exists to raise: does an invitation bypass the approval? It does, and
 * it has to — the person who would be approving is the person who sent it.
 * A join request is a stranger asking an admin; an invitation is that admin
 * asking first. One rule, taken in two directions: an admin decides who is in
 * the group.
 *
 * Being invited is an offer and never a fact, exactly as `event_invite` is.
 * Writing the membership outright would let one person's guest list write
 * itself into another person's account — so this is `open` until answered, and
 * accepting is what makes somebody a member.
 *
 * Shaped after `event_invite` deliberately, down to the index names: they are
 * the same act about a different room, and the surface that answers them —
 * "waiting on you" — reads both.
 */
export const groupInvites = pgTable(
  'group_invite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    /** Who did the asking. Shown to the person deciding. */
    invitedByActorId: uuid('invited_by_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['open', 'accepted', 'declined'] })
      .notNull()
      .default('open'),
    createdAt: createdAt(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    // One row per group and person. Asking again does not overwrite an answer:
    // re-inviting somebody who declined would turn "no" back into "waiting",
    // which is an admin overruling a decision that was not theirs to make.
    uniqueIndex('group_invite_pair_idx').on(t.groupId, t.actorId),
    // "What am I being asked?" — the only read this table has from the side of
    // the person deciding.
    index('group_invite_inbox_idx').on(t.actorId, t.status),
  ],
);

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
    /**
     * Where it was, as a person would say it — "Hackney", "Mum's".
     *
     * Typed by the host, never derived. The obvious source is the photos and
     * it is the one source that must not be used: §7.6 strips GPS at ingest
     * and the deriver *fails* a photo if any survives, so there is no location
     * in this system to derive from, deliberately. Reversing that to power a
     * map would trade a safety guarantee for a nicety.
     *
     * Free text rather than coordinates, because it is shown to the people who
     * were already there and its job is to be recognised, not resolved. Any
     * mapping happens client-side, from the string.
     */
    place: text('place'),
    /**
     * A line under the name — what it was, in the host's words.
     *
     * Not a description field with a thousand characters and a scrollbar: one
     * sentence, on a card and at the top of the event. The name answers "which
     * one" and this answers "what was it", and an event that wants more than
     * that has photographs for the purpose.
     */
    caption: text('caption'),
    /**
     * The picture the event leads with, chosen by whoever made it.
     *
     * A key into storage rather than a photo id, and that is the decision worth
     * recording. A cover *could* be "one of the event's photographs", which
     * costs no bytes and inherits deletion for free — but at the moment
     * somebody is making an event, its photographs do not exist yet: they are
     * `File` handles on a phone, queued to go up over the next few minutes.
     * Pointing at one would mean the cover arrives some time after the event
     * does, which is not what choosing a cover feels like.
     *
     * So it is its own small object, re-encoded on the way in exactly as an
     * avatar is — one wide JPEG under the event's own prefix, written before
     * the event page opens. What that inherits from `avatars/` is the same gap:
     * the child-safety scanner is reached from the deriver's pipeline, which
     * is photo-shaped, and this does not go round it. The bytes almost always
     * *also* go up as an ordinary photograph, which is scanned — so what the
     * gap really covers is a cover whose photograph was later quarantined.
     * docs/csam-runbook.md carries the step that closes it.
     */
    coverKey: text('cover_key'),
    groupId: uuid('group_id').references(() => groups.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => actors.id),
    /**
     * Chosen by whoever creates the event, and it is one of two things.
     * `public` is the original model — possession of the link is the access.
     * `private` means added or approved: an accepted invitation or a request
     * the creator let in, both of which are an `event_participant` row,
     * because that is already what "in" means here. Holding the link to a
     * private album gets somebody to the door and no further.
     *
     * Plain text with no CHECK: the constraint that matters is in `authorize`,
     * which denies any value it does not recognise, so an unknown string here
     * closes the album rather than opening it. Which is also what makes the
     * migration off the old three-way column safe in either order — a row
     * still reading `account_required` mid-deploy is closed, not open.
     */
    accessPolicy: text('access_policy', {
      enum: ['public', 'private'],
    })
      .notNull()
      .default('public'),
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
 * Someone holding the link to a `request_access` event, asking to be let in.
 *
 * Deliberately not the thing that grants access — approving writes an
 * `event_participant` row, and that row is what `authorize` reads. This table
 * is the conversation: who asked, when, and what the host said. Keeping the
 * grant in one place means a bug here can lose a request but cannot open an
 * event, and `joins_open` keeps reading the column it always did.
 *
 * A declined row is kept rather than deleted, so asking again is a decision
 * the host made once rather than a loop the same person can run.
 */
export const eventAccessRequests = pgTable(
  'event_access_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
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
    // One row per person per event, so asking twice updates rather than
    // stacking — a host looking at a list wants people, not attempts.
    uniqueIndex('event_access_request_actor_idx').on(t.eventId, t.actorId),
    index('event_access_request_open_idx').on(t.eventId, t.status),
  ],
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
    /**
     * When the row was created, which is when the upload was *presigned* —
     * not when any byte arrived. The distinction is the whole reason
     * `bytesAt` exists below.
     */
    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * When storage was confirmed to hold the object, written by
     * `/api/uploads/<id>/complete`.
     *
     * A row is `pending` from the moment it is presigned, and `pending` is the
     * queue the deriver drains — so without this the deriver claims rows whose
     * bytes are still being sent, finds nothing, and marks them `failed`,
     * which is terminal. The upload then lands into a row nothing will ever
     * look at again: every photo uploaded, and none of them appeared.
     *
     * So this is the deriver's gate. Null means "not yet", not "never" — see
     * `pendingPhotoIds`, which waits for it and then stops waiting, because a
     * client that uploaded and never got to say so must not strand the photo
     * either.
     */
    bytesAt: timestamp('bytes_at', { withTimezone: true }),
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
    /*
     * `card` arrived after the other three and is not backfilled by its
     * existence here: a photograph ingested before it exists has no row for it
     * and the client must not offer one. See `hasCard` in the web app, which
     * asks this table rather than assuming.
     */
    kind: text('kind', { enum: ['thumb', 'card', 'grid', 'full'] }).notNull(),
    /**
     * A size can exist in two encodings — §11. AVIF is smaller and JPEG is
     * the fallback for the viewers who cannot decode it, so both are stored
     * and the client picks; nothing here negotiates.
     *
     * Defaulted rather than nullable: every derivative written before this
     * column existed was a JPEG, so the default is a fact rather than a guess,
     * and it keeps the primary key non-null.
     */
    format: text('format', { enum: ['jpeg', 'avif'] }).notNull().default('jpeg'),
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
  (t) => [primaryKey({ columns: [t.photoId, t.kind, t.format] })],
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
     *
     * `child_safety` is the only kind that acts before a human looks. It
     * quarantines on receipt and opens a safety incident, because the cost of
     * being slow is categorically different from the cost of being wrong, and
     * a false one is undone by a reviewer releasing the hold. Every other kind
     * deliberately leaves the photo up: one report is not a verdict, and a
     * kind that hid on sight would hand any guest a way to empty an event a
     * photo at a time.
     */
    kind: text('kind', {
      enum: ['removal_request', 'abuse', 'other', 'child_safety'],
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
 * The child-safety evidence trail: a scanner match at ingest, or a person
 * reporting child sexual abuse material from a client.
 *
 * Separate from `report` on purpose, and narrower than it. Reports are
 * user-generated and routed to a moderation queue; a row here carries
 * statutory duties in the US (18 U.S.C. §2258A: report to NCMEC, then preserve
 * for 90 days) and must never appear in any host- or user-facing surface.
 *
 * `provider` says which of the two produced it — a scanner's name, or
 * `user_report`. Nothing else may write here. A nudity or explicit-content
 * classifier is a different check with different consequences, and putting its
 * hits in this table would dilute the one record a reviewer needs to be able
 * to trust months later.
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
 * Every time a photo's visibility changed, and who changed it.
 *
 * The trail existed before this table but only in pieces: a host's decision
 * lived on `report`, a scanner match on `safety_incident`, an uploader's own
 * deletion nowhere at all, and answering "why is this photo hidden" meant
 * checking three tables and inferring from timestamps. This is the one place
 * that answers it.
 *
 * Append-only. Nothing updates or deletes a row here, which is what separates
 * an audit log from a status column.
 *
 * **No foreign key to `photo`, deliberately.** The purge job hard-deletes photo
 * rows thirty days after they are tombstoned, and a cascade would take the
 * record of the removal with the thing removed — an audit log that disappears
 * along with its subject is not one. The ids are stored plainly and may point
 * at rows that no longer exist, which is the correct behaviour for a log.
 */
export const moderationActions = pgTable(
  'moderation_action',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Plain uuid, not a reference. See the note above. */
    photoId: uuid('photo_id').notNull(),
    eventId: uuid('event_id').notNull(),
    action: text('action', {
      enum: ['hidden', 'unhidden', 'quarantined', 'removed', 'purged'],
    }).notNull(),
    /**
     * Null when the system acted on a rule rather than a person deciding —
     * the 48-hour auto-hide, dedup, the purge job. `reason` names the rule in
     * those cases, so a null actor is never unexplained.
     *
     * No foreign key, for the same reason `photo_id` has none and
     * `safety_incident.uploader_actor_id` has none: this is evidence. An
     * `on delete set null` would erase who acted the moment that person
     * deleted their account, which is exactly when the record matters most,
     * and following an actor merge would rewrite who did something after the
     * fact. The id is frozen as it was; `actor.merged_into_id` still resolves
     * it to a person if anyone needs to.
     */
    actorId: uuid('actor_id'),
    /** Why, in a form a person reads: `auto_hide_48h`, `host_removed`, `csam_scanner`. */
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('moderation_action_photo_idx').on(t.photoId, t.createdAt),
    index('moderation_action_event_idx').on(t.eventId, t.createdAt),
  ],
);

/**
 * What an automated content classifier thought about a photo.
 *
 * A separate table from `safety_incident`, and the separation is the point.
 * A nudity or explicit-content classifier answers a different question with a
 * different consequence: it is a probabilistic opinion about ordinary adult
 * content, routed to a moderation queue a human works through. A safety
 * incident is a child-safety matter carrying statutory duties, and a record
 * that has to stay trustworthy under scrutiny months later. Mixing the two
 * would bury the second in the first, and no volume of "possible swimwear"
 * belongs in the evidence trail.
 *
 * A flag does not hide anything on its own. Hiding on a classifier's opinion
 * would take down beach photographs at a rate no small team can review, and
 * the classifier is here to decide what a human looks at first, not to decide
 * anything. The one automated path that hides without a human is child safety,
 * and it lives in `safety_incident`.
 */
export const moderationFlags = pgTable(
  'moderation_flag',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    photoId: uuid('photo_id')
      .notNull()
      .references(() => photos.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    /** Which classifier, so an old row says what judged it. */
    provider: text('provider').notNull(),
    /** The provider's own labels, joined. Not interpreted here. */
    labels: text('labels').notNull(),
    /** 0-100 where the provider gives one, so the column is comparable. */
    score: integer('score'),
    status: text('status', { enum: ['open', 'cleared', 'actioned'] })
      .notNull()
      .default('open'),
    createdAt: createdAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => actors.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('moderation_flag_open_idx').on(t.status, t.createdAt),
    index('moderation_flag_photo_idx').on(t.photoId),
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

/**
 * Somebody asking to be somebody else's friend.
 *
 * The same shape as the two other requests in this product — group and event —
 * and for the same reason: the asking and the answer are a conversation, and
 * the thing it grants lives somewhere else. A declined row stays, so "no" is
 * something the person answering says once.
 */
export const friendRequests = pgTable(
  'friend_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromActorId: uuid('from_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    toActorId: uuid('to_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['open', 'accepted', 'declined'] })
      .notNull()
      .default('open'),
    createdAt: createdAt(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    // One standing request per direction. Asking twice is the same ask, and a
    // list of people to answer should be a list of people.
    uniqueIndex('friend_request_pair_idx').on(t.fromActorId, t.toActorId),
    index('friend_request_inbox_idx').on(t.toActorId, t.status),
  ],
);

/**
 * Being friends, which is symmetric, stored as two rows.
 *
 * A single canonical row with the smaller id first would halve the storage and
 * double the cost of every read: "who are my friends" becomes an OR across two
 * columns and a CASE to work out which end is the other person. Two rows makes
 * that a plain lookup on `actor_id`, and the pair is written and removed
 * together in one transaction so they cannot disagree.
 */
export const friendships = pgTable(
  'friendship',
  {
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    friendActorId: uuid('friend_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.friendActorId] })],
);

/**
 * A host offering somebody a place in an event.
 *
 * Being invited used to *be* being a participant: the row went straight into
 * `event_participant` and there was nothing to accept. That was defensible
 * while only friends could be added — they had already agreed to something —
 * and stopped being defensible the moment a host could add anybody by handle,
 * because then one person's guest list writes itself into another person's
 * account.
 *
 * So an invitation is now an offer with an answer. Accepting is what creates
 * the participant row; declining leaves a row saying so, which is what stops
 * the same host asking again and again and what lets the invite disappear from
 * a list without vanishing from the record.
 *
 * One row per event and person. Being asked twice is the same ask.
 */
export const eventInvites = pgTable(
  'event_invite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    /** Who did the asking. Shown to the person deciding. */
    invitedByActorId: uuid('invited_by_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['open', 'accepted', 'declined'] })
      .notNull()
      .default('open'),
    createdAt: createdAt(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('event_invite_pair_idx').on(t.eventId, t.actorId),
    // "What am I being asked?" — the only read this table has from the side of
    // the person deciding.
    index('event_invite_inbox_idx').on(t.actorId, t.status),
  ],
);

/**
 * Talking about the photographs, where the photographs are.
 *
 * The conversation about an evening already happens — in the group chat the
 * link was pasted into, where it is unreachable to anybody who joined later
 * and gone entirely by next year. This is the same conversation kept beside
 * the thing it is about.
 *
 * Scoped to one event and nothing else. Not a group thread, not an inbox, not
 * a direct message: those are three more products, each with its own answer to
 * "who can see this", and the whole reason this one is tractable is that the
 * answer is already written down — `authorize(view)` reads, `contribute`
 * writes. A message is visible to exactly the people the photographs are.
 *
 * `photoId` is what makes a comment on a single photograph the same record as
 * a message in the thread. Two tables would mean two access rules, two
 * moderation paths and two places to look when somebody reports something; one
 * table with a nullable anchor means a photo comment appears in the thread
 * with its thumbnail, which is what the design asks for and also the honest
 * data model.
 *
 * Deleted rather than removed. A thread reads as a sequence, and a message
 * vanishing out of the middle of one rearranges what the messages around it
 * appear to be replying to — so the row stays, the body goes, and the gap says
 * so. Same argument as the tombstoned photo, for the same reason.
 */
export const eventMessages = pgTable(
  'event_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    /**
     * Never null. Anonymous messages are a different product: posting needs
     * `contribute`, which needs an account, so there is always somebody.
     */
    authorActorId: uuid('author_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    /** Null for a message to the whole thread; set for a comment on one photo. */
    photoId: uuid('photo_id').references(() => photos.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    /** Set on every edit. Its presence is what puts "edited" beside the time. */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    /** Tombstone. The row stays so the thread keeps its shape. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // The thread, in order. Every read of this table is "one event, oldest
    // first", including the one that renders a photo's comments.
    index('event_message_thread_idx').on(t.eventId, t.createdAt),
    index('event_message_photo_idx').on(t.photoId),
  ],
);

/**
 * Talking in a group, rather than about one evening.
 *
 * The comment at the head of `event_message` says this table is not coming:
 * "Not a group thread, not an inbox, not a direct message: those are three
 * more products, each with its own answer to 'who can see this'." That was the
 * right call at the time and the reasoning still holds — what changed is that
 * the Groups tab became the place every conversation lives, and a tab of rooms
 * you cannot speak in is a directory.
 *
 * So this is the one of the three that got built, and the objection is
 * answered rather than ignored: the access rule is `group_member`, full stop.
 * Not a capability, not a link, not `authorize()` — membership of the group is
 * both the right to read and the right to post, it is one join, and there is
 * no anonymous path to it the way an event has one through its link. That is
 * the whole reason this is tractable and the inbox still is not.
 *
 * Shaped after `event_message` down to the tombstone, because the client draws
 * both with the same component and a thread that behaves differently depending
 * on which room it is in is two threads to reason about. What is deliberately
 * missing is `photo_id`: a group owns no photographs of its own — they belong
 * to the events under it — so there is nothing here to anchor a comment to.
 *
 * Reactions are missing too, and that is a scope line rather than a decision:
 * `message_reaction` has a foreign key to `event_message`, so giving a group
 * message a reaction means either a second reaction table or a nullable pair,
 * and neither is worth doing before anybody has asked to react to one.
 */
export const groupMessages = pgTable(
  'group_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /** Never null, for the same reason an event message's author is not. */
    authorActorId: uuid('author_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // The thread, in order — the only read this table has.
    index('group_message_thread_idx').on(t.groupId, t.createdAt),
  ],
);

/*
 * How far somebody has read, in each kind of thread.
 *
 * Until now "unread" was a number held in the client for as long as a screen
 * was mounted: it meant "since you opened this album just now", it reset on
 * every launch, and no list could ask about a thread it was not already
 * showing. A tab whose subject is every conversation has to say which of them
 * are waiting for you, and that is a fact about a person, not about a session
 * — so it is written down.
 *
 * A timestamp rather than a count or a last-message id. A count goes wrong the
 * moment a message is deleted out of the middle of a thread; an id needs a
 * join back to the message to find out what it means and breaks if that
 * message is purged. "Everything before this instant has been seen" survives
 * both, and unread is then a `count(*) where created_at > read_at`, which is
 * one index away from free.
 *
 * Two tables rather than one with a nullable event and a nullable group. The
 * pair would need a CHECK to say exactly one is set, this schema expresses its
 * constraints in Drizzle rather than in hand-written SQL, and the two are read
 * in different places anyway — the events list asks one, the groups list asks
 * the other. `event_message.photo_id` is a nullable anchor and stays one
 * because there the two cases are the same act; here they are two rooms.
 */
export const eventThreadReads = pgTable(
  'event_thread_read',
  {
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    /** Everything posted at or before this has been seen. */
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.eventId] })],
);

export const groupThreadReads = pgTable(
  'group_thread_read',
  {
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.groupId] })],
);

/**
 * One person's reaction to one message.
 *
 * A row rather than a count, because the question the pill answers is "did
 * *you* react", and a counter cannot be un-clicked by the person who clicked
 * it. The primary key is the whole tuple, so reacting twice with the same
 * emoji is the same reaction rather than two.
 *
 * The emoji is stored as text rather than as an enum. An enum would be the
 * usual instinct here and it is wrong: the set is a design decision that will
 * change, and a migration per emoji is a migration nobody will want to write,
 * so the *client* offers a closed set and the column stores what was chosen.
 * Bounded by a length check rather than by a list — see the migration.
 */
export const messageReactions = pgTable(
  'message_reaction',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => eventMessages.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.actorId, t.emoji] })],
);

/**
 * Notifications somebody has dismissed — the Activity page's `···` → Hide.
 *
 * A row per hidden line, keyed by the string the feed builds for it. That key
 * is not a foreign key and cannot be one: the feed has no table of its own.
 * Every line on Activity is derived at read time from a reaction, a mention, a
 * participant row or an answered request, and the key is how one of those
 * derived lines is named — `reaction:<message>:<emoji>:<when>`, and so on.
 *
 * Which means the honest description of this table is "strings this person
 * does not want to see again". A hidden line whose source row is deleted takes
 * its meaning with it, and the key here becomes a small piece of litter that
 * matches nothing. That is the cost of a derived feed and it is a cheap one;
 * the alternative is a notification table written at six call sites, which is
 * the design `activity.ts` explains at length why the product does not have.
 *
 * No "unhide" anywhere. Somebody who hides a line has said they are finished
 * with it, and a second screen listing what you have dismissed is a feature
 * about the feature.
 */
export const hiddenActivity = pgTable(
  'hidden_activity',
  {
    actorId: uuid('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'cascade' }),
    /**
     * The feed's own id for the line. Bounded because it is composed from
     * ids, an emoji and a timestamp, and nothing should be able to write a
     * kilobyte of key here by asking the API to hide one.
     */
    itemKey: text('item_key').notNull(),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.actorId, t.itemKey] })],
);

// --- relations -------------------------------------------------------------

/**
 * The observations this product is allowed to make — design §18.
 *
 * A closed list, in the same spirit as the three notifications: the constraint
 * is what makes it safe to have at all. §18 names the numbers the first
 * release needs, and **most of them are already in the tables above** —
 * contributors per event, photos per contributor, time to the first
 * non-creator upload, group formation, what fraction of events carry a
 * creator-set window. Those are queries, not tracking, and adding a pipeline
 * to collect what Postgres already knows would move user data somewhere new
 * for no answer.
 *
 * What is left is the handful of facts nothing records, and each row here
 * exists because one §18 metric cannot be computed without it. Nothing is
 * sent anywhere: first-party, one table, no third-party SDK, and no profile —
 * which is also what keeps the app's privacy manifest honest, since it
 * declares no tracking and no tracking domains.
 *
 * If a kind is ever added, the question to answer first is which metric it
 * serves. An observation collected "in case it is useful later" is the thing
 * this list exists to prevent.
 */
export const observations = pgTable(
  'observation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', {
      enum: [
        /** Someone got in. `client` answers §18's install-conversion question. */
        'joined',
        /** An archive was minted. Nothing else records that anyone left with the photos. */
        'download',
        /** A suggestion was shown: `count` pre-selected out of `outOf` candidates. */
        'autoselect_shown',
        /** `count` of the `outOf` pre-selected survived to upload — precision. */
        'autoselect_confirmed',
        /** No window or no permission, so the system picker. The other half of precision. */
        'picker_used',
      ],
    }).notNull(),
    eventId: uuid('event_id').references(() => events.id, { onDelete: 'cascade' }),
    /**
     * Nullable, and pseudonymous when set. Needed for the two metrics that
     * are about people rather than events — return rate, and return rate
     * among heavy deselectors — which cannot be computed from anonymous rows.
     */
    actorId: uuid('actor_id').references(() => actors.id, { onDelete: 'set null' }),
    client: text('client', { enum: ['web', 'ios', 'android'] }).notNull(),
    /** Meaning depends on `kind`; read as "count out of outOf". */
    count: integer('count'),
    outOf: integer('out_of'),
    createdAt: createdAt(),
  },
  (t) => [index('observation_kind_idx').on(t.kind, t.createdAt)],
);

/**
 * Fixed-window request counters — design §7.8.
 *
 * The per-actor and per-event caps bound how much any one identity or any one
 * link can store. Neither bounds how fast an unattended script can ask, and
 * neither survives the attacker simply making more identities, so this counts
 * per source instead.
 *
 * **The bucket key holds no IP address.** It is an HMAC of one under the
 * server secret, so this table is useless to anyone who reads it and carries
 * no personal data to retain, explain or delete. Rows are dropped by the purge
 * job once their window has passed.
 */
export const rateLimits = pgTable('rate_limit', {
  /** `<name>:<hashed source>`. Opaque by construction — see above. */
  bucket: text('bucket').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true })
    .notNull()
    .defaultNow(),
  count: integer('count').notNull().default(0),
});

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
