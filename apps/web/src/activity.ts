/**
 * Everything that has happened to you, in one list.
 *
 * Derived, not stored. The obvious design is a `notification` table written at
 * every site that produces one — and it is the wrong one here, because there
 * are six such sites and each would be a second write beside the first, able
 * to fail on its own, and able to disagree with the thing it describes. A
 * notification saying somebody reacted to a message that has since been
 * deleted is a row nothing will ever correct.
 *
 * Every one of these facts is already a row with a timestamp on it: a
 * reaction, a message containing your handle, a participant row, an answered
 * access request. Reading them is a handful of bounded queries and the answer
 * cannot be stale, because there is nothing to keep in step. It is the same
 * approach `invitesWaiting` already takes for the badge.
 *
 * This file is only half the page. What is still being asked — invitations,
 * friend requests, people wanting into an album you run — is `requests.ts`,
 * and the two are kept apart on purpose: one is read, the other is answered.
 *
 * The cost is real and worth naming: there is no per-item read state.
 * `actor.invites_seen_at` marks the boundary — everything after it is new —
 * which is one timestamp for the whole list rather than a flag per line.
 *
 * Hiding is the exception, and it is deliberately not read state. A line
 * somebody has dismissed is named in `hidden_activity` by the key this file
 * composes for it, and filtered out below. That key is the only handle a
 * derived feed can offer: there is no row to mark, because the line is not a
 * row — it is four tables read at once.
 */

import { schema } from '@parea/core';
import { and, desc, eq, ne, isNull, isNotNull, sql } from 'drizzle-orm';

import { avatarUrl } from './accounts';
import type { Db } from './db';
import { imageSrc } from './images';

/*
 * A friend request appears here answered, never open.
 *
 * An open one is not something that has happened, it is something being asked,
 * and it lives in the bubble at the top of the page where it can be answered.
 * Leaving it in both places put the same request on the screen twice — dealt
 * with in one and still sitting in the other, which reads as the answer not
 * having taken.
 *
 * The mistake that made was leaving the asker with nothing at all: their
 * question left the other person's queue and joined no list of their own, so
 * being said yes to looked exactly like never being answered. `friend_accepted`
 * is that missing half.
 */
export type ActivityKind =
  | 'reaction'
  | 'mention'
  | 'let_in'
  | 'photos_added'
  | 'request_answered'
  | 'friend_accepted'
  | 'joined_yours';

export type ActivityItem = {
  /** Stable across polls: the source row's id, prefixed by kind. */
  id: string;
  kind: ActivityKind;
  /** ISO. */
  at: string;
  /** Who did it. Display name, else handle, else "Someone". */
  who: string;
  /** What they did, as one line. */
  what: string;
  /** Where it happened, if there is somewhere to go. */
  href: string | null;
  /**
   * The picture on the row: a person's, or the album's newest photograph.
   *
   * Which one depends on what the line is about, and that is the whole rule —
   * "Wren reacted to something you wrote" is about Wren, and "Barcelona is
   * yours to look at now" is about Barcelona. A row whose picture is not the
   * thing its sentence names is worse than a row with no picture, which is
   * what null draws.
   */
  image: string | null;
  /**
   * The photographs the line is about. Empty on every kind but `photos_added`.
   *
   * "Maya added 12 photos to Naxos, September" is a sentence about pictures
   * that shows you none of them, on a page inside a product whose subject is
   * photographs. Three of them is not decoration: it is the difference between
   * a notification you have to open to evaluate and one you can act on — the
   * ones from the beach are worth opening now, the twelve of the car park are
   * not.
   *
   * Deliberately only this kind. A reaction has no photographs to show and a
   * friendship has none either; giving every row an optional strip would make
   * the list scan as two lists, one with pictures and one without.
   */
  images: string[];
};

/**
 * How much of the past to show. A list, not an archive.
 *
 * The same number in two places on purpose: each of the four queries takes at
 * most this many, and the merged list is cut to this many again. Which means a
 * feed dominated by one kind — two hundred reactions on a busy thread — can
 * come back with fifty of that kind and nothing else, and that is the right
 * answer for a page somebody scans rather than reads.
 *
 * The one visible cost is that hiding is applied after the queries: dismissing
 * fifty reactions does not pull fifty older lines up behind them until the
 * next page load has fewer to fetch. Fixing that means either an unbounded
 * read or a `not in (...)` list built from every key somebody has ever hidden,
 * and neither is worth it for a list nobody reaches the end of.
 */
const LIMIT = 50;

/**
 * The album's newest photograph, for the square on rows that are about albums.
 *
 * A subselect rather than a join for the usual reason: joining the photo table
 * multiplies the rows the query is counting. Null for an album nobody has
 * added to yet, which draws a letter instead — the same fallback the cards use
 * when there is nothing to show.
 */
const COVER = sql<{ storageKey: string; hash: string | null } | null>`(
  select json_build_object(
    'storageKey', p.storage_key,
    'hash', encode(p.content_hash, 'hex')
  )
  from "photo" p
  where p.event_id = ${schema.events.id}
    and p.status = 'ready' and p.deleted_at is null
  order by p.uploaded_at desc
  limit 1
)`;

/**
 * Three of the photographs a `photos_added` line is counting.
 *
 * An aggregate over the rows already being grouped rather than a second query
 * or a subselect: the group *is* "these photographs, by this person, in this
 * album, on this day", so the strip has to come from the same rows as the
 * count or the two can disagree about what they describe.
 *
 * Sliced in SQL rather than in TypeScript. `json_agg` of the whole group would
 * carry every photograph of a two-hundred-picture burst across the wire to
 * draw three of them — fifty such rows is a megabyte of JSON for 150 thumbnails.
 *
 * Wrapped in `to_json` so both drivers agree what comes back. A bare
 * `json[]` arrives parsed under one and as an array of strings under the
 * other; one json value is one shape everywhere.
 */
const STRIP = sql<{ storageKey: string; hash: string | null }[]>`coalesce(
  to_json((array_agg(
    json_build_object(
      'storageKey', ${schema.photos.storageKey},
      'hash', encode(${schema.photos.contentHash}, 'hex')
    )
    order by ${schema.photos.uploadedAt} desc
  ))[1:3]),
  '[]'::json
)`;

const NAME = sql<string>`coalesce(
  nullif(btrim(${schema.actors.displayName}), ''),
  '@' || ${schema.actors.handle},
  'Someone'
)`;

export async function activityFor(
  db: Db,
  actorId: string | null,
): Promise<ActivityItem[]> {
  if (!actorId) return [];

  const [me] = await db
    .select({ handle: schema.actors.handle })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId));

  /*
   * What this person has dismissed, fetched alongside the rest.
   *
   * Filtered here rather than in each of the four queries: they select from
   * four different tables and the key is composed after the fact, so there is
   * nothing for SQL to join against. The set is small — one row per line
   * somebody has hidden — and the alternative is four `not exists` clauses
   * built from string concatenation in four places.
   */
  const [hidden, reactions, mentions, letIn, added, answered, befriended, arrivals] =
    await Promise.all([
    db
      .select({ key: schema.hiddenActivity.itemKey })
      .from(schema.hiddenActivity)
      .where(eq(schema.hiddenActivity.actorId, actorId)),
    /*
     * Somebody reacted to something you wrote.
     *
     * Joined through the message so a reaction on a deleted one disappears
     * with it — which is the property a stored notification could not have.
     */
    db
      .select({
        id: schema.messageReactions.messageId,
        emoji: schema.messageReactions.emoji,
        at: schema.messageReactions.createdAt,
        who: NAME,
        avatarKey: schema.actors.avatarKey,
        eventId: schema.eventMessages.eventId,
      })
      .from(schema.messageReactions)
      .innerJoin(
        schema.eventMessages,
        eq(schema.eventMessages.id, schema.messageReactions.messageId),
      )
      .innerJoin(schema.actors, eq(schema.actors.id, schema.messageReactions.actorId))
      .where(
        and(
          eq(schema.eventMessages.authorActorId, actorId),
          isNull(schema.eventMessages.deletedAt),
          // Your own reaction to your own message is not news.
          ne(schema.messageReactions.actorId, actorId),
        ),
      )
      .orderBy(desc(schema.messageReactions.createdAt))
      .limit(LIMIT),

    /*
     * Somebody wrote your handle in a thread.
     *
     * Matched on the text rather than on a mentions table, because the mention
     * *is* the text — the composer inserts `@name` and nothing else records it.
     * Only in events you are in, which the join enforces: a message elsewhere
     * containing your handle is not addressed to you and is not yours to read.
     */
    me?.handle
      ? db
          .select({
            id: schema.eventMessages.id,
            at: schema.eventMessages.createdAt,
            who: NAME,
            avatarKey: schema.actors.avatarKey,
            eventId: schema.eventMessages.eventId,
            body: schema.eventMessages.body,
          })
          .from(schema.eventMessages)
          .innerJoin(
            schema.eventParticipants,
            and(
              eq(schema.eventParticipants.eventId, schema.eventMessages.eventId),
              eq(schema.eventParticipants.actorId, actorId),
            ),
          )
          .innerJoin(schema.actors, eq(schema.actors.id, schema.eventMessages.authorActorId))
          .where(
            and(
              ne(schema.eventMessages.authorActorId, actorId),
              isNull(schema.eventMessages.deletedAt),
              sql`${schema.eventMessages.body} ilike ${'%@' + me.handle + '%'}`,
            ),
          )
          .orderBy(desc(schema.eventMessages.createdAt))
          .limit(LIMIT)
      : Promise.resolve([]),

    // You were let into somebody else's album.
    db
      .select({
        id: schema.eventParticipants.eventId,
        at: schema.eventParticipants.firstSeenAt,
        name: schema.events.name,
        eventId: schema.events.id,
        capEpoch: schema.events.capEpoch,
        cover: COVER,
      })
      .from(schema.eventParticipants)
      .innerJoin(schema.events, eq(schema.events.id, schema.eventParticipants.eventId))
      .where(
        and(
          eq(schema.eventParticipants.actorId, actorId),
          ne(schema.events.createdBy, actorId),
          isNull(schema.events.deletedAt),
        ),
      )
      .orderBy(desc(schema.eventParticipants.firstSeenAt))
      .limit(LIMIT),

    /*
     * Somebody added photographs to an album you are in.
     *
     * The line people actually want from a page like this, and the one that
     * was missing: an album is a thing that fills up after the evening, and
     * nothing told you it had. Grouped by album, person and day, because
     * fifteen photographs arriving together is one event — fifteen rows saying
     * "Sarah added a photo" is a page nobody reads twice.
     *
     * Bounded to a month. Older than that and the album is finished; the
     * bound also keeps this query from widening as somebody uses the product.
     */
    db
      .select({
        eventId: schema.events.id,
        eventName: schema.events.name,
        capEpoch: schema.events.capEpoch,
        uploaderId: schema.actors.id,
        who: NAME,
        avatarKey: schema.actors.avatarKey,
        n: sql<number>`count(*)::int`,
        at: sql<Date>`max(${schema.photos.uploadedAt})`,
        day: sql<string>`to_char(max(${schema.photos.uploadedAt}), 'YYYY-MM-DD')`,
        strip: STRIP,
      })
      .from(schema.photos)
      .innerJoin(schema.events, eq(schema.events.id, schema.photos.eventId))
      .innerJoin(schema.actors, eq(schema.actors.id, schema.photos.uploaderId))
      .innerJoin(
        schema.eventParticipants,
        and(
          eq(schema.eventParticipants.eventId, schema.photos.eventId),
          eq(schema.eventParticipants.actorId, actorId),
        ),
      )
      .where(
        and(
          eq(schema.photos.status, 'ready'),
          isNull(schema.photos.deletedAt),
          isNull(schema.events.deletedAt),
          // Your own photographs are not news to you.
          ne(schema.photos.uploaderId, actorId),
          sql`${schema.photos.uploadedAt} > now() - interval '30 days'`,
        ),
      )
      .groupBy(
        schema.events.id,
        schema.events.name,
        schema.events.capEpoch,
        schema.actors.id,
        schema.actors.displayName,
        schema.actors.handle,
        schema.actors.avatarKey,
        sql`to_char(${schema.photos.uploadedAt}, 'YYYY-MM-DD')`,
      )
      .orderBy(desc(sql`max(${schema.photos.uploadedAt})`))
      .limit(LIMIT),

    /*
     * A host said yes to something you asked for.
     *
     * Only yes. A no is already on this page, in the panel above: `askedToJoin`
     * keeps a declined request permanently and shows it as "Not this time",
     * deliberately, because a request that vanished would read as one that was
     * never sent. A line down here saying the same album is still private is
     * the second copy of that fact, three inches lower.
     *
     * Which leaves the two halves of the page with one job each: the panel
     * holds what has not opened, and this list holds what has.
     */
    db
      .select({
        id: schema.eventAccessRequests.id,
        at: schema.eventAccessRequests.resolvedAt,
        name: schema.events.name,
        eventId: schema.events.id,
        capEpoch: schema.events.capEpoch,
        cover: COVER,
      })
      .from(schema.eventAccessRequests)
      .innerJoin(schema.events, eq(schema.events.id, schema.eventAccessRequests.eventId))
      .where(
        and(
          eq(schema.eventAccessRequests.actorId, actorId),
          eq(schema.eventAccessRequests.status, 'approved'),
          isNotNull(schema.eventAccessRequests.resolvedAt),
          isNull(schema.events.deletedAt),
        ),
      )
      .orderBy(desc(schema.eventAccessRequests.resolvedAt))
      .limit(LIMIT),

    /*
     * Somebody said yes to being friends.
     *
     * The line this page was missing, and the way it went missing is worth
     * recording: a friend request is *asked* in the bubble at the top, and
     * answering it makes the row disappear from the asker's queue — which
     * looked, from the asker's side, exactly like nothing having happened. The
     * question left one list and joined no other.
     *
     * Only the asker's side. Whoever pressed Accept was there when it
     * happened; telling them what they have just done is the product
     * confirming its own button.
     */
    db
      .select({
        id: schema.friendRequests.id,
        at: schema.friendRequests.resolvedAt,
        who: NAME,
        handle: schema.actors.handle,
        avatarKey: schema.actors.avatarKey,
      })
      .from(schema.friendRequests)
      .innerJoin(schema.actors, eq(schema.actors.id, schema.friendRequests.toActorId))
      .where(
        and(
          eq(schema.friendRequests.fromActorId, actorId),
          eq(schema.friendRequests.status, 'accepted'),
          isNotNull(schema.friendRequests.resolvedAt),
        ),
      )
      .orderBy(desc(schema.friendRequests.resolvedAt))
      .limit(LIMIT),

    /*
     * Somebody arrived in an album you made.
     *
     * The other half of `let_in`, which has always told you when *you* were
     * let into somebody else's. A host invites four people and hears nothing
     * back until photographs start appearing — and if none do, never learns
     * whether anybody opened it.
     *
     * Everybody who arrives, however they arrived: an invitation accepted, a
     * request approved, or a link opened. The three are one fact from the
     * host's side — somebody is in — and `event_participant` is where that
     * fact lives whichever door it came through.
     *
     * Not yourself, and not albums somebody else made.
     */
    db
      .select({
        id: schema.eventParticipants.eventId,
        actorId: schema.eventParticipants.actorId,
        at: schema.eventParticipants.firstSeenAt,
        who: NAME,
        avatarKey: schema.actors.avatarKey,
        name: schema.events.name,
        eventId: schema.events.id,
      })
      .from(schema.eventParticipants)
      .innerJoin(schema.events, eq(schema.events.id, schema.eventParticipants.eventId))
      .innerJoin(schema.actors, eq(schema.actors.id, schema.eventParticipants.actorId))
      .where(
        and(
          eq(schema.events.createdBy, actorId),
          ne(schema.eventParticipants.actorId, actorId),
          isNull(schema.events.deletedAt),
          /*
           * Not the ones you let in yourself.
           *
           * Approving a request writes the participant row, so without this a
           * host who pressed "Let in" is told a second later that the person
           * they just let in has joined — the product confirming its own
           * button. An invitation accepted is the opposite: you asked, and
           * this is them answering.
           */
          sql`not exists (
            select 1 from "event_access_request" r
            where r.event_id = ${schema.eventParticipants.eventId}
              and r.actor_id = ${schema.eventParticipants.actorId}
              and r.status = 'approved'
          )`,
        ),
      )
      .orderBy(desc(schema.eventParticipants.firstSeenAt))
      .limit(LIMIT),
  ]);

  /*
   * Albums an approved request already speaks for.
   *
   * Built before the lines are worded, because it decides whether one of them
   * exists at all.
   */
  const approvedEvents = new Set(answered.map((a) => a.eventId));

  /*
   * The picture, resolved once per row.
   *
   * Two different signatures for two different kinds of image: an avatar is
   * presigned against private storage for an hour, a photograph is signed
   * against its album's `cap_epoch` so rotating the album's link stops it
   * resolving. Both are addresses handed to the browser; neither is a byte
   * this process ever touches.
   */
  const cover = (row: {
    eventId: string;
    capEpoch: number;
    cover: { storageKey: string; hash: string | null } | null;
  }) =>
    row.cover
      ? imageSrc(
          {
            eventId: row.eventId,
            storageKey: row.cover.storageKey,
            contentHash: row.cover.hash ? Buffer.from(row.cover.hash, 'hex') : null,
          },
          'thumb',
          row.capEpoch,
        )
      : Promise.resolve(null);

  /*
   * `images` is on every line and empty on all but one.
   *
   * An optional field would have been the smaller diff and the worse type: a
   * consumer that forgot the `?? []` would render `undefined.map` on whichever
   * kind it had not thought about, which is the kind nobody was testing. An
   * always-present array makes "this line has no photographs to show" a value
   * rather than an absence.
   */
  const items: ActivityItem[] = await Promise.all([
    ...reactions.map(async (r) => ({
      id: `reaction:${r.id}:${r.emoji}:${r.at.toISOString()}`,
      kind: 'reaction' as const,
      at: r.at.toISOString(),
      who: r.who,
      // A no-break space after the emoji. Several of these are wide glyphs
      // that sit hard against the next word, and "🔥to" reads as a typo.
      what: `reacted ${r.emoji}\u00a0 to something you wrote`,
      href: `/event/${r.eventId}`,
      image: await avatarUrl(r.avatarKey),
      images: [],
    })),
    ...mentions.map(async (m) => ({
      id: `mention:${m.id}`,
      kind: 'mention' as const,
      at: m.at.toISOString(),
      who: m.who,
      // The message itself, trimmed. A mention with no context is a
      // notification that can only be answered by opening it.
      what: `mentioned you: “${m.body.slice(0, 90)}${m.body.length > 90 ? '…' : ''}”`,
      href: `/event/${m.eventId}`,
      image: await avatarUrl(m.avatarKey),
      images: [],
    })),
    ...letIn
      /*
       * You were let into somebody's album.
       *
       * Skipped when an approved request already says so. Being approved
       * writes the participant row, so one act produced two lines — "Ultra let
       * you in" directly under "Ultra is yours to look at now" — which reads
       * as the product telling you twice because it is not sure you heard.
       */
      .filter((l) => !approvedEvents.has(l.eventId))
      .map(async (l) => ({
        id: `letin:${l.id}`,
        kind: 'let_in' as const,
        at: l.at.toISOString(),
        who: 'You',
        what: `joined ${l.name}`,
        href: `/event/${l.eventId}`,
        image: await cover(l),
        images: [],
      })),
    ...added.map(async (row) => ({
      // The day is in the key so tomorrow's photographs are a new line rather
      // than yesterday's line quietly growing a bigger number.
      id: `photos:${row.eventId}:${row.uploaderId}:${row.day}`,
      kind: 'photos_added' as const,
      at: new Date(row.at).toISOString(),
      who: row.who,
      what: `added ${row.n} ${row.n === 1 ? 'photo' : 'photos'} to ${row.eventName}`,
      href: `/event/${row.eventId}`,
      image: await avatarUrl(row.avatarKey),
      // The photographs themselves, signed the way every photograph is: against
      // the album's `cap_epoch`, so rotating its link stops these resolving
      // along with everything else that album ever handed out.
      images: await Promise.all(
        row.strip.map((one) =>
          imageSrc(
            {
              eventId: row.eventId,
              storageKey: one.storageKey,
              contentHash: one.hash ? Buffer.from(one.hash, 'hex') : null,
            },
            'thumb',
            row.capEpoch,
          ),
        ),
      ),
    })),
    ...befriended.map(async (f) => ({
      id: `friend:${f.id}`,
      kind: 'friend_accepted' as const,
      at: f.at!.toISOString(),
      who: 'You',
      // Said as the state it left behind rather than as the act — "Wren
      // accepted your friend request" is a receipt, and this is the thing
      // somebody actually wanted to know.
      what: `and ${f.who} are friends now`,
      // Their page, which is what somebody does next with this: look.
      href: f.handle ? `/u/${encodeURIComponent(f.handle)}` : '/friends',
      image: await avatarUrl(f.avatarKey),
      images: [],
    })),
    ...arrivals.map(async (a) => ({
      id: `arrived:${a.eventId}:${a.actorId}`,
      kind: 'joined_yours' as const,
      at: a.at.toISOString(),
      who: a.who,
      what: `joined ${a.name}`,
      href: `/event/${a.eventId}`,
      image: await avatarUrl(a.avatarKey),
      images: [],
    })),
    ...answered.map(async (a) => ({
      id: `answered:${a.id}`,
      kind: 'request_answered' as const,
      at: a.at!.toISOString(),
      // Addressed to the person reading it, not reported about them: "You can
      // see Barcelona now" rather than "Barcelona: access granted".
      who: 'You',
      what: `can see ${a.name} now`,
      href: `/event/${a.eventId}`,
      image: await cover(a),
      images: [],
    })),
  ]);

  // Newest first, and bounded again after the merge — four queries of fifty is
  // two hundred rows, and nobody scrolls that.
  const dismissed = new Set(hidden.map((row) => row.key));
  return items
    .filter((item) => !dismissed.has(item.id))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, LIMIT);
}
