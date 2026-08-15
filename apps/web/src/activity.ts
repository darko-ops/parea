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
 * No `friend_request` here any more.
 *
 * An open request is not something that has happened, it is something being
 * asked, and it now lives in the bubble at the top of the page where it can be
 * answered. Leaving it in both places put the same request on the screen twice
 * — answered in one of them and still sitting in the other, which reads as the
 * answer not having taken.
 */
export type ActivityKind = 'reaction' | 'mention' | 'let_in' | 'request_answered';

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
  const [hidden, reactions, mentions, letIn, answered] = await Promise.all([
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

    // A host answered something you asked for.
    db
      .select({
        id: schema.eventAccessRequests.id,
        at: schema.eventAccessRequests.resolvedAt,
        status: schema.eventAccessRequests.status,
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
          ne(schema.eventAccessRequests.status, 'open'),
          isNotNull(schema.eventAccessRequests.resolvedAt),
          isNull(schema.events.deletedAt),
        ),
      )
      .orderBy(desc(schema.eventAccessRequests.resolvedAt))
      .limit(LIMIT),
  ]);

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
    })),
    ...letIn.map(async (l) => ({
      id: `letin:${l.id}`,
      kind: 'let_in' as const,
      at: l.at.toISOString(),
      who: l.name,
      what: 'is yours to look at now',
      href: `/event/${l.eventId}`,
      image: await cover(l),
    })),
    ...answered.map(async (a) => ({
      id: `answered:${a.id}`,
      kind: 'request_answered' as const,
      at: a.at!.toISOString(),
      who: a.name,
      what: a.status === 'approved' ? 'let you in' : 'was not opened to you',
      href: a.status === 'approved' ? `/event/${a.eventId}` : null,
      image: await cover(a),
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
