/**
 * Moments: one photograph somebody put in front of their people.
 *
 * A roll is everyone's pictures of one evening. A moment is the other shape —
 * one person, one picture, no evening — and Home draws them as one stream:
 * every moment from everybody you are connected to, in one strip, rather than
 * a square per person to open one at a time. Somebody's own moments are on
 * their page.
 *
 * ## Who sees one
 *
 * The people who would already see this person's face in the product: their
 * friends, anybody they are in a roll with, and anybody they share a group
 * with. Nothing wider. A moment has no link to share and no page a stranger
 * can land on, and a block hides it in both directions the way a block hides
 * everything else.
 *
 * ## In what order
 *
 * Chronological, and meant to feel it: what your people are sharing now is
 * the point, and an order that decides what matters is the thing this is not.
 * `orderStream` is the whole rule, and it has three parts.
 *
 * - **Fresh and unseen first.** Anything from the last `FRESH_HOURS` you have
 *   not opened, newest first — with a small lift for the people you are
 *   closest to. The lift is minutes, capped at `BOOST_CAP_MINUTES`, so it only
 *   ever settles which of two moments posted close together comes first. It
 *   can never put something old above something posted a few minutes ago.
 * - **Then fresh and seen.** Opening a moment lets it fall behind the ones
 *   you have not. Your own count as seen: you do not need to be shown them.
 * - **Then everything older**, newest first, until `MOMENT_DAYS`.
 *
 * Reactions play no part, and never should: ranking by them is how a stream
 * of your people becomes a popularity contest.
 */

import { schema } from '@parea/core';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { avatarUrl } from './accounts';
import { type Db, getDb } from './db';
import { getStorage } from './storage';

/** How long a moment stays in the stream. */
export const MOMENT_DAYS = 30;

/** What counts as fresh: the window where unseen comes first. */
export const FRESH_HOURS = 24;

/**
 * The lift closeness buys, in minutes of apparent recency.
 *
 * Small on purpose. Each is a reason this person is one of yours; together
 * they are capped, so a friend you share a roll and a group with is lifted
 * past moments posted within ten minutes of theirs and no further.
 */
export const BOOST_MINUTES = { friend: 4, roll: 3, group: 3 } as const;
export const BOOST_CAP_MINUTES = 10;

/** How many moments the stream holds. */
export const STREAM_LIMIT = 120;

/** The largest original accepted. A generous phone photograph. */
export const MOMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Where an original waits between the phone's PUT and `/api/moments` reading
 * it. Per actor, so the key a client hands back can be checked as theirs by
 * its prefix alone.
 */
export function incomingPrefix(actorId: string): string {
  return `moments/incoming/${actorId}/`;
}

export type StreamMoment = {
  id: string;
  key: string;
  thumbKey: string | null;
  width: number;
  height: number;
  createdAt: Date;
  /** Opened by this viewer — or theirs, which counts the same. */
  seen: boolean;
  mine: boolean;
  author: {
    actorId: string;
    handle: string | null;
    name: string;
    avatarKey: string | null;
  };
  /** Why this person is one of the viewer's, for the lift. */
  close: { friend: boolean; roll: boolean; group: boolean };
};

/**
 * The stream in order. Pure, so the rule is testable without a database and
 * readable in one place.
 */
export function orderStream<T extends Pick<StreamMoment, 'createdAt' | 'seen' | 'close'>>(
  moments: T[],
  now: Date,
): T[] {
  const fresh = now.getTime() - FRESH_HOURS * 3_600_000;
  const lifted = (m: T) => {
    const minutes = Math.min(
      BOOST_CAP_MINUTES,
      (m.close.friend ? BOOST_MINUTES.friend : 0) +
        (m.close.roll ? BOOST_MINUTES.roll : 0) +
        (m.close.group ? BOOST_MINUTES.group : 0),
    );
    return m.createdAt.getTime() + minutes * 60_000;
  };
  const newest = (a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime();

  const unseen = moments.filter((m) => m.createdAt.getTime() > fresh && !m.seen);
  const seen = moments.filter((m) => m.createdAt.getTime() > fresh && m.seen);
  const older = moments.filter((m) => m.createdAt.getTime() <= fresh);

  return [
    ...unseen.sort((a, b) => lifted(b) - lifted(a)),
    ...seen.sort(newest),
    ...older.sort(newest),
  ];
}

/**
 * Every moment this viewer may see, in stream order — or, given `by`, only
 * that person's, newest first, which is what their page shows.
 */
export async function momentStream(
  db: Db,
  viewer: string | null,
  options: {
    by?: string;
    now?: Date;
    /**
     * Openings after this are not counted as seen. The web steps through the
     * stream one page at a time and marks each as it goes; without this the
     * order would shift under somebody on every step, as each moment they had
     * just opened fell behind the rest.
     */
    seenBefore?: Date;
  } = {},
): Promise<StreamMoment[]> {
  if (!viewer) return [];
  const now = options.now ?? new Date();
  const cutoff = options.seenBefore ?? now;

  /*
   * Who the viewer is connected to, and how: one row per person with the
   * three reasons as flags. The audience is their union; the flags are the
   * lift. The viewer is in it too, so their own moments are in their stream.
   */
  const rows = await db.execute(sql`
    with links as (
      select f.friend_actor_id as id, 'friend' as why
        from "friendship" f where f.actor_id = ${viewer}
      union all
      select theirs.actor_id, 'roll'
        from "event_participant" mine
        join "event" e on e.id = mine.event_id and e.deleted_at is null
        join "event_participant" theirs on theirs.event_id = e.id
       where mine.actor_id = ${viewer}
      union all
      select theirs.actor_id, 'group'
        from "group_member" mine
        join "group_member" theirs on theirs.group_id = mine.group_id
       where mine.actor_id = ${viewer}
      union all
      select ${viewer}::uuid, 'self'
    ),
    audience as (
      select id,
             bool_or(why = 'friend') as friend,
             bool_or(why = 'roll') as roll,
             bool_or(why = 'group') as grp
        from links group by id
    )
    select m.id, m.key, m.thumb_key as "thumbKey", m.width, m.height,
           m.created_at as "createdAt",
           (m.actor_id = ${viewer} or v.moment_id is not null) as seen,
           m.actor_id as "actorId",
           a.handle,
           coalesce(nullif(btrim(a.display_name), ''), '@' || a.handle, 'Someone') as name,
           a.avatar_key as "avatarKey",
           au.friend, au.roll, au.grp as "group"
      from "moment" m
      join audience au on au.id = m.actor_id
      join "actor" a on a.id = m.actor_id and a.merged_into_id is null
      left join "moment_view" v on v.moment_id = m.id and v.actor_id = ${viewer}
                                and v.viewed_at <= ${cutoff.toISOString()}
     where m.deleted_at is null
       and m.created_at > now() - make_interval(days => ${MOMENT_DAYS})
       ${options.by ? sql`and m.actor_id = ${options.by}` : sql``}
       and not exists (
         select 1 from "block" b
          where (b.blocker_actor_id = ${viewer} and b.blocked_actor_id = m.actor_id)
             or (b.blocker_actor_id = m.actor_id and b.blocked_actor_id = ${viewer})
       )
     order by m.created_at desc
     limit ${STREAM_LIMIT}
  `);

  // PGlite answers `{rows}` and postgres.js answers an array.
  const list = (Array.isArray(rows) ? rows : (rows as { rows: unknown[] }).rows) as {
    id: string;
    key: string;
    thumbKey: string | null;
    width: number;
    height: number;
    createdAt: Date | string;
    seen: boolean;
    actorId: string;
    handle: string | null;
    name: string;
    avatarKey: string | null;
    friend: boolean;
    roll: boolean;
    group: boolean;
  }[];

  const moments: StreamMoment[] = list.map((row) => ({
    id: row.id,
    key: row.key,
    thumbKey: row.thumbKey,
    width: Number(row.width),
    height: Number(row.height),
    createdAt: new Date(row.createdAt),
    seen: Boolean(row.seen),
    mine: row.actorId === viewer,
    author: {
      actorId: row.actorId,
      handle: row.handle,
      name: row.name,
      avatarKey: row.avatarKey,
    },
    close: { friend: Boolean(row.friend), roll: Boolean(row.roll), group: Boolean(row.group) },
  }));

  // One person's page is simply their moments, newest first.
  return options.by ? moments : orderStream(moments, now);
}

/** That the viewer has opened one. Idempotent; the first opening is kept. */
export async function markSeen(db: Db, viewer: string, momentId: string): Promise<void> {
  await db
    .insert(schema.momentViews)
    .values({ actorId: viewer, momentId })
    .onConflictDoNothing();
}

/** Takes one back. Only its author can; anybody else gets `null`. */
export async function removeMoment(
  db: Db,
  actorId: string,
  momentId: string,
): Promise<{ key: string; thumbKey: string | null } | null> {
  const [row] = await db
    .update(schema.moments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(schema.moments.id, momentId),
        eq(schema.moments.actorId, actorId),
        isNull(schema.moments.deletedAt),
      ),
    )
    .returning({ key: schema.moments.key, thumbKey: schema.moments.thumbKey });
  return row ?? null;
}

/** One moment as it crosses to a client. The storage keys never do. */
export type WireMoment = {
  id: string;
  /** The full rendition, 2048 on the long edge. */
  src: string;
  /** The strip's copy. The full one, for a moment from before there was one. */
  thumb: string;
  width: number;
  height: number;
  createdAt: string;
  seen: boolean;
  mine: boolean;
  author: {
    actorId: string;
    handle: string | null;
    name: string;
    avatar: string | null;
  };
};

export type MomentsResponse = {
  moments: WireMoment[];
  /**
   * When this order was worked out. A client stepping through the stream a
   * page at a time sends it back as `seenBefore`, so the order holds still.
   */
  at: string;
};

/**
 * The stream, presigned. A moment whose picture failed to sign is left out
 * rather than sent as a square with nothing in it.
 */
export async function momentsResponse(
  actorId: string | null,
  options: { by?: string; seenBefore?: Date } = {},
): Promise<MomentsResponse> {
  const stream = await momentStream(getDb(), actorId, options);
  const storage = getStorage();
  // One signature per face rather than one per moment: a person with twelve
  // moments in the stream is one avatar.
  const avatars = new Map<string, Promise<string | null>>();
  const avatar = (key: string | null) => {
    if (!key) return Promise.resolve(null);
    if (!avatars.has(key)) avatars.set(key, avatarUrl(key));
    return avatars.get(key)!;
  };

  const out = await Promise.all(
    stream.map(async (m): Promise<WireMoment | null> => {
      const [src, thumb, face] = await Promise.all([
        storage.presignGet(m.key, 3600).catch(() => null),
        m.thumbKey ? storage.presignGet(m.thumbKey, 3600).catch(() => null) : null,
        avatar(m.author.avatarKey),
      ]);
      if (!src) return null;
      return {
        id: m.id,
        src,
        thumb: thumb ?? src,
        width: m.width,
        height: m.height,
        createdAt: m.createdAt.toISOString(),
        seen: m.seen,
        mine: m.mine,
        author: {
          actorId: m.author.actorId,
          handle: m.author.handle,
          name: m.author.name,
          avatar: face,
        },
      };
    }),
  );
  return {
    moments: out.filter((m) => m !== null),
    at: (options.seenBefore ?? new Date()).toISOString(),
  };
}
