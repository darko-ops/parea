/**
 * How people respond to what is in Parea — reactions, comments and
 * favourites — for the hub.
 *
 * The same rule as `./adminExperience`: totals and shares across everybody.
 * An actor id is joined on inside the SQL and never leaves it, and nothing
 * comes back that is about one person or one roll.
 *
 * "In the period" means the reaction, comment, favourite or download was made
 * in the last `days` days. Comments per roll is the one exception, because a
 * roll's conversation runs on after the evening: it is counted over the rolls
 * *made* in the period, every comment they have had since.
 *
 * Whether a download was the person's favourites is recorded only from the
 * day `observation.scope` arrived (migration 0062), and camera-roll saves in
 * the app only from the release that reports them; `scopeSince` says when, so
 * the hub can say how far back the split goes.
 */

import { sql } from 'drizzle-orm';

import type { Db } from './db';

export const ENGAGEMENT_PERIODS = [7, 30, 90, 365] as const;
export type EngagementPeriod = (typeof ENGAGEMENT_PERIODS)[number];

/** How many weeks the trend covers. */
const WEEKS = 12;

const rowsOf = (result: any) => (result.rows ?? result) as any[];
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const orNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Live photographs: what anybody could have reacted to. */
const LIVE_PHOTO = sql.raw(`p."deleted_at" is null and p."status" = 'ready'`);

export type Scope = 'all' | 'favourites' | 'selection' | 'one' | 'unknown';

export async function engagement(db: Db, days: EngagementPeriod) {
  const since = sql`now() - make_interval(days => ${days})`;

  // ---------------------------------------------------------------------------
  // Reactions, on photographs and on moments; on messages as well, for scale.

  const [reactions] = rowsOf(
    await db.execute(sql`
      with pr as (
        select r."actor_id", r."photo_id", r."emoji" from "photo_reaction" r where r."created_at" > ${since}
      ), mr as (
        select r."actor_id", r."moment_id", r."emoji" from "moment_reaction" r where r."created_at" > ${since}
      ), shot as (
        select p."id", p."uploader_id" from "photo" p
         where ${LIVE_PHOTO} and coalesce(p."bytes_at", p."uploaded_at") > ${since}
      ), shared as (
        select m."id", m."actor_id" from "moment" m where m."deleted_at" is null and m."created_at" > ${since}
      )
      select
        (select count(*) from pr) as "photoReactions",
        (select count(distinct "actor_id") from pr) as "photoReactors",
        (select count(distinct "photo_id") from pr) as "photosReactedTo",
        (select count(*) from shot) as "photosAdded",
        (select count(*) from shot s where exists (
          select 1 from "photo_reaction" r where r."photo_id" = s."id" and r."actor_id" <> s."uploader_id"
        )) as "photosAddedWithReaction",
        (select count(*) from mr) as "momentReactions",
        (select count(distinct "actor_id") from mr) as "momentReactors",
        (select count(distinct "moment_id") from mr) as "momentsReactedTo",
        (select count(*) from shared) as "momentsShared",
        (select count(*) from shared s where exists (
          select 1 from "moment_reaction" r where r."moment_id" = s."id" and r."actor_id" <> s."actor_id"
        )) as "momentsSharedWithReaction",
        (select count(distinct a) from (select "actor_id" as a from pr union select "actor_id" from mr) u) as "reactors",
        (select count(*) from "message_reaction" r where r."created_at" > ${since})
          + (select count(*) from "group_message_reaction" r where r."created_at" > ${since}) as "messageReactions"
    `),
  );

  const emoji = rowsOf(
    await db.execute(sql`
      select "emoji", count(*) as "n" from (
        select "emoji" from "photo_reaction" where "created_at" > ${since}
        union all
        select "emoji" from "moment_reaction" where "created_at" > ${since}
      ) e group by "emoji" order by count(*) desc, "emoji" limit 6
    `),
  ).map((r) => ({ emoji: String(r.emoji), n: n(r.n) }));

  // ---------------------------------------------------------------------------
  // Comments: under photographs, in a roll's thread, and under moments.

  const [comments] = rowsOf(
    await db.execute(sql`
      with pc as (
        select m."author_actor_id" as "actor_id", m."photo_id" from "event_message" m
         where m."photo_id" is not null and m."deleted_at" is null and m."created_at" > ${since}
      ), rm as (
        select m."author_actor_id" as "actor_id" from "event_message" m
         where m."photo_id" is null and m."deleted_at" is null and m."created_at" > ${since}
      ), mc as (
        select c."actor_id" from "moment_comment" c
          join "moment" mo on mo."id" = c."moment_id" and mo."deleted_at" is null
         where c."created_at" > ${since}
      )
      select
        (select count(*) from pc) as "photoComments",
        (select count(distinct "actor_id") from pc) as "photoCommenters",
        (select count(distinct "photo_id") from pc) as "photosCommented",
        (select count(*) from rm) as "rollMessages",
        (select count(distinct "actor_id") from rm) as "rollMessagers",
        (select count(*) from mc) as "momentComments",
        (select count(distinct "actor_id") from mc) as "momentCommenters",
        (select count(distinct a) from (
          select "actor_id" as a from pc union select "actor_id" from rm union select "actor_id" from mc
        ) u) as "commenters",
        (select count(*) from "group_message" g where g."deleted_at" is null and g."created_at" > ${since}) as "groupMessages"
    `),
  );

  /** Per roll: the rolls made in the period, and everything said in them since. */
  const [perRoll] = rowsOf(
    await db.execute(sql`
      with rolls as (
        select e."id",
          (select count(*) from "event_message" m
            where m."event_id" = e."id" and m."photo_id" is not null and m."deleted_at" is null) as "photo",
          (select count(*) from "event_message" m
            where m."event_id" = e."id" and m."photo_id" is null and m."deleted_at" is null) as "thread",
          (select count(distinct m."author_actor_id") from "event_message" m
            where m."event_id" = e."id" and m."deleted_at" is null) as "voices"
          from "event" e
         where e."deleted_at" is null and e."created_at" > ${since}
      ), t as (select "photo" + "thread" as "total", "photo", "voices" from rolls)
      select
        count(*) as "rolls",
        count(*) filter (where "total" > 0) as "withAny",
        count(*) filter (where "photo" > 0) as "withPhotoComments",
        coalesce(sum("total"), 0) as "total",
        coalesce(sum("photo"), 0) as "photo",
        percentile_cont(0.5) within group (order by "total") filter (where "total" > 0) as "medianWhenAny",
        percentile_cont(0.5) within group (order by "voices") filter (where "total" > 0) as "medianVoicesWhenAny",
        count(*) filter (where "total" = 0) as "none",
        count(*) filter (where "total" between 1 and 4) as "few",
        count(*) filter (where "total" between 5 and 19) as "some",
        count(*) filter (where "total" >= 20) as "many",
        max("total") as "most"
      from t
    `),
  );

  // ---------------------------------------------------------------------------
  // Favourites, and whether they are what people take away.

  const [favourites] = rowsOf(
    await db.execute(sql`
      with f as (
        select f."actor_id", f."photo_id" from "photo_favourite" f where f."created_at" > ${since}
      ), per as (
        select "actor_id", count(*) as "n" from f group by "actor_id"
      ), took as (
        select distinct o."actor_id" from "observation" o
         where o."kind" in ('download', 'device_save') and o."scope" = 'favourites'
           and o."created_at" > ${since} and o."actor_id" is not null
      )
      select
        (select count(*) from f) as "added",
        (select count(distinct "actor_id") from f) as "people",
        (select count(distinct "photo_id") from f) as "photos",
        (select percentile_cont(0.5) within group (order by "n") from per) as "medianPerPerson",
        (select count(distinct "actor_id") from "photo_favourite") as "everPeople",
        (select count(*) from "photo_favourite") as "everTotal",
        (select count(*) from per where "actor_id" in (select "actor_id" from took)) as "favouritersWhoTook",
        (select count(*) from took) as "peopleWhoTook"
    `),
  );

  const delivery = rowsOf(
    await db.execute(sql`
      select o."kind", coalesce(o."scope", 'unknown') as "scope",
             count(*) as "times", count(distinct o."actor_id") as "people", coalesce(sum(o."count"), 0) as "photos"
        from "observation" o
       where o."kind" in ('download', 'device_save') and o."created_at" > ${since}
       group by 1, 2
    `),
  );
  const SCOPES: Scope[] = ['all', 'favourites', 'selection', 'one', 'unknown'];
  const byScope = (kind: 'download' | 'device_save') =>
    Object.fromEntries(
      SCOPES.map((s) => {
        const r = delivery.find((d) => d.kind === kind && d.scope === s);
        return [s, { times: n(r?.times), people: n(r?.people), photos: n(r?.photos) }];
      }),
    ) as Record<Scope, { times: number; people: number; photos: number }>;

  const [scopeSince] = rowsOf(
    await db.execute(sql`
      select min(o."created_at") as "at" from "observation" o
       where o."kind" in ('download', 'device_save') and o."scope" is not null
    `),
  );

  // ---------------------------------------------------------------------------
  // The weekly trend, so a period's totals have a shape.

  const weeks = rowsOf(
    await db.execute(sql`
      with w as (
        select generate_series(
          date_trunc('week', now() at time zone 'utc') - make_interval(weeks => ${WEEKS - 1}),
          date_trunc('week', now() at time zone 'utc'),
          interval '1 week'
        ) as "start"
      )
      select to_char(w."start", 'YYYY-MM-DD') as "week",
        (select count(*) from "photo_reaction" r where (r."created_at" at time zone 'utc') >= w."start" and (r."created_at" at time zone 'utc') < w."start" + interval '1 week')
          + (select count(*) from "moment_reaction" r where (r."created_at" at time zone 'utc') >= w."start" and (r."created_at" at time zone 'utc') < w."start" + interval '1 week') as "reactions",
        (select count(*) from "event_message" m where m."deleted_at" is null and (m."created_at" at time zone 'utc') >= w."start" and (m."created_at" at time zone 'utc') < w."start" + interval '1 week')
          + (select count(*) from "moment_comment" c where (c."created_at" at time zone 'utc') >= w."start" and (c."created_at" at time zone 'utc') < w."start" + interval '1 week') as "comments",
        (select count(*) from "photo_favourite" f where (f."created_at" at time zone 'utc') >= w."start" and (f."created_at" at time zone 'utc') < w."start" + interval '1 week') as "favourites"
      from w order by w."start"
    `),
  ).map((r) => ({ week: String(r.week), reactions: n(r.reactions), comments: n(r.comments), favourites: n(r.favourites) }));

  return {
    days,
    reactions: {
      photos: {
        reactions: n(reactions.photoReactions),
        people: n(reactions.photoReactors),
        reactedTo: n(reactions.photosReactedTo),
        added: n(reactions.photosAdded),
        addedWithReaction: n(reactions.photosAddedWithReaction),
      },
      moments: {
        reactions: n(reactions.momentReactions),
        people: n(reactions.momentReactors),
        reactedTo: n(reactions.momentsReactedTo),
        shared: n(reactions.momentsShared),
        sharedWithReaction: n(reactions.momentsSharedWithReaction),
      },
      people: n(reactions.reactors),
      messages: n(reactions.messageReactions),
      emoji,
    },
    comments: {
      photos: { comments: n(comments.photoComments), people: n(comments.photoCommenters), commentedOn: n(comments.photosCommented) },
      threads: { messages: n(comments.rollMessages), people: n(comments.rollMessagers) },
      moments: { comments: n(comments.momentComments), people: n(comments.momentCommenters) },
      people: n(comments.commenters),
      groupMessages: n(comments.groupMessages),
    },
    perRoll: {
      rolls: n(perRoll.rolls),
      withAny: n(perRoll.withAny),
      withPhotoComments: n(perRoll.withPhotoComments),
      total: n(perRoll.total),
      photoComments: n(perRoll.photo),
      medianWhenAny: orNull(perRoll.medianWhenAny),
      medianVoicesWhenAny: orNull(perRoll.medianVoicesWhenAny),
      most: orNull(perRoll.most),
      buckets: { none: n(perRoll.none), few: n(perRoll.few), some: n(perRoll.some), many: n(perRoll.many) },
    },
    favourites: {
      added: n(favourites.added),
      people: n(favourites.people),
      photos: n(favourites.photos),
      medianPerPerson: orNull(favourites.medianPerPerson),
      ever: { people: n(favourites.everPeople), total: n(favourites.everTotal) },
      favouritersWhoTook: n(favourites.favouritersWhoTook),
      peopleWhoTook: n(favourites.peopleWhoTook),
    },
    delivery: {
      downloads: byScope('download'),
      deviceSaves: byScope('device_save'),
      scopeSince: scopeSince?.at ? new Date(scopeSince.at).toISOString() : null,
    },
    weeks,
  };
}

export type Engagement = Awaited<ReturnType<typeof engagement>>;
