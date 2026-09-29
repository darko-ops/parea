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
 * `orderStream` is the whole rule, and it has two parts.
 *
 * - **Unseen first.** Anything you have not opened, newest first — with a
 *   small lift for the people you are closest to. The lift is minutes, capped
 *   at `BOOST_CAP_MINUTES`, so it only ever settles which of two moments
 *   posted close together comes first. It can never put something old above
 *   something posted a few minutes ago.
 * - **Then seen.** Opening a moment lets it fall behind the ones you have
 *   not. Your own count as seen: you do not need to be shown them.
 *
 * ## How long
 *
 * `MOMENT_HOURS`: a day. A moment is what your people are sharing now, and
 * after a day it is not now. It stops being shown to anybody — Home, the
 * viewer, the person's page, and a link straight to it — at that point.
 *
 * Reactions play no part, and never should: ranking by them is how a stream
 * of your people becomes a popularity contest.
 */

import { MOMENT_HOURS, schema } from '@parea/core';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { avatarUrl } from './accounts';
import { type Db, getDb } from './db';
import { addMember, directChatWith } from './groups';
import { getStorage } from './storage';

/** How long a moment is shown for. Shared with the deriver's clean-up. */
export { MOMENT_HOURS };

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
): T[] {
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

  const unseen = moments.filter((m) => !m.seen);
  const seen = moments.filter((m) => m.seen);

  return [...unseen.sort((a, b) => lifted(b) - lifted(a)), ...seen.sort(newest)];
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
    /** Just this one — for checking a viewer may see it before acting on it. */
    id?: string;
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
  const cutoff = options.seenBefore ?? new Date();

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
       and m.created_at > now() - make_interval(hours => ${MOMENT_HOURS})
       ${options.by ? sql`and m.actor_id = ${options.by}` : sql``}
       ${options.id ? sql`and m.id = ${options.id}` : sql``}
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
  return options.by ? moments : orderStream(moments);
}

/** Whether this viewer may see — and so react to and comment on — a moment. */
export async function canSeeMoment(db: Db, viewer: string, momentId: string): Promise<boolean> {
  return (await momentStream(db, viewer, { id: momentId })).length > 0;
}

/** The longest comment. A sentence or three, not an essay under a picture. */
export const COMMENT_MAX = 1000;

/** Adds a comment. The caller has checked the viewer may see the moment. */
export async function commentOnMoment(
  db: Db,
  actorId: string,
  momentId: string,
  body: string,
): Promise<string> {
  const [row] = await db
    .insert(schema.momentComments)
    .values({ momentId, actorId, body })
    .returning({ id: schema.momentComments.id });
  return row!.id;
}

/** Takes back one of your own comments. Anybody else's answers `false`. */
export async function removeMomentComment(
  db: Db,
  actorId: string,
  commentId: string,
): Promise<boolean> {
  const gone = await db
    .delete(schema.momentComments)
    .where(and(eq(schema.momentComments.id, commentId), eq(schema.momentComments.actorId, actorId)))
    .returning({ id: schema.momentComments.id });
  return gone.length > 0;
}

/** Puts a reaction on, or takes it off if it was there. Returns which. */
export async function toggleMomentReaction(
  db: Db,
  actorId: string,
  momentId: string,
  emoji: string,
): Promise<'added' | 'removed'> {
  const gone = await db
    .delete(schema.momentReactions)
    .where(
      and(
        eq(schema.momentReactions.momentId, momentId),
        eq(schema.momentReactions.actorId, actorId),
        eq(schema.momentReactions.emoji, emoji),
      ),
    )
    .returning({ emoji: schema.momentReactions.emoji });
  if (gone.length > 0) return 'removed';
  await db
    .insert(schema.momentReactions)
    .values({ momentId, actorId, emoji })
    .onConflictDoNothing();
  return 'added';
}

/** Who shared a moment, for telling them somebody answered it. */
export async function authorOf(db: Db, momentId: string): Promise<string | null> {
  const [row] = await db
    .select({ actorId: schema.moments.actorId })
    .from(schema.moments)
    .where(eq(schema.moments.id, momentId))
    .limit(1);
  return row?.actorId ?? null;
}

/**
 * An answer to a moment, as a message in the two people's own chat.
 *
 * Replying to somebody's picture is saying something to *them*, so a comment
 * on a moment or a reaction to it lands in the one-to-one chat between the
 * person answering and the person who shared it — made on the spot if the
 * two have never talked — rather than as a line on a notifications page. The
 * message carries the moment, which the chat draws beside it while it lives.
 *
 * Returns the chat and who it is with, for the push; null when there is no
 * one to tell — the author answering their own moment.
 */
export async function replyInChat(
  db: Db,
  fromActorId: string,
  momentId: string,
  answer: { body: string; emoji?: string },
): Promise<{ groupId: string; toActorId: string } | null> {
  const author = await authorOf(db, momentId);
  if (!author || author === fromActorId) return null;

  let chat = await directChatWith(db, fromActorId, author);
  if (!chat) {
    const [made] = await db
      .insert(schema.groups)
      .values({ name: null, slug: null, findable: false })
      .returning();
    await addMember(db, made!.id, fromActorId, 'admin');
    await addMember(db, made!.id, author);
    chat = made!;
  }

  await db.insert(schema.groupMessages).values({
    groupId: chat.id,
    authorActorId: fromActorId,
    body: answer.body,
    momentId,
    momentEmoji: answer.emoji ?? null,
  });
  return { groupId: chat.id, toActorId: author };
}

/** A reaction as a client draws it: who, and with what. Newest first. */
export type MomentReaction = { emoji: string; name: string; mine: boolean };

/**
 * A comment as a client draws it — the same shape as a roll thread's
 * message, so the phone's comment sheet draws it with the row it already has.
 */
export type MomentComment = {
  id: string;
  body: string;
  createdAt: string;
  edited: false;
  deleted: false;
  author: { key: string; name: string; mine: boolean; avatarUrl: string | null };
  photoId: null;
  reactions: [];
};

/** Everything said and left on these moments, keyed by moment. */
async function talkFor(
  db: Db,
  viewer: string,
  momentIds: string[],
  avatar: (key: string | null) => Promise<string | null>,
): Promise<{
  reactions: Map<string, MomentReaction[]>;
  comments: Map<string, MomentComment[]>;
}> {
  const reactions = new Map<string, MomentReaction[]>();
  const comments = new Map<string, MomentComment[]>();
  if (momentIds.length === 0) return { reactions, comments };

  const name = sql<string>`coalesce(${schema.actors.handle}, nullif(btrim(${schema.actors.displayName}), ''), 'Someone')`;
  const [reactionRows, commentRows] = await Promise.all([
    db
      .select({
        momentId: schema.momentReactions.momentId,
        emoji: schema.momentReactions.emoji,
        actorId: schema.momentReactions.actorId,
        name,
      })
      .from(schema.momentReactions)
      .innerJoin(schema.actors, eq(schema.actors.id, schema.momentReactions.actorId))
      .where(inArray(schema.momentReactions.momentId, momentIds))
      .orderBy(desc(schema.momentReactions.createdAt)),
    db
      .select({
        id: schema.momentComments.id,
        momentId: schema.momentComments.momentId,
        body: schema.momentComments.body,
        createdAt: schema.momentComments.createdAt,
        actorId: schema.momentComments.actorId,
        name,
        avatarKey: schema.actors.avatarKey,
      })
      .from(schema.momentComments)
      .innerJoin(schema.actors, eq(schema.actors.id, schema.momentComments.actorId))
      .where(inArray(schema.momentComments.momentId, momentIds))
      .orderBy(asc(schema.momentComments.createdAt)),
  ]);

  for (const row of reactionRows) {
    const list = reactions.get(row.momentId) ?? [];
    list.push({ emoji: row.emoji, name: row.name, mine: row.actorId === viewer });
    reactions.set(row.momentId, list);
  }
  for (const row of commentRows) {
    const list = comments.get(row.momentId) ?? [];
    list.push({
      id: row.id,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      edited: false,
      deleted: false,
      author: {
        key: row.actorId,
        name: row.name,
        mine: row.actorId === viewer,
        avatarUrl: await avatar(row.avatarKey),
      },
      photoId: null,
      reactions: [],
    });
    comments.set(row.momentId, list);
  }
  return { reactions, comments };
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
  /** Who reacted, and with what. Newest first. */
  reactions: MomentReaction[];
  /** What has been said under it. Oldest first, as a conversation reads. */
  comments: MomentComment[];
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

  const talk = actorId
    ? await talkFor(getDb(), actorId, stream.map((m) => m.id), avatar)
    : { reactions: new Map(), comments: new Map() };

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
        reactions: talk.reactions.get(m.id) ?? [],
        comments: talk.comments.get(m.id) ?? [],
      };
    }),
  );
  return {
    moments: out.filter((m) => m !== null),
    at: (options.seenBefore ?? new Date()).toISOString(),
  };
}
