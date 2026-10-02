/**
 * Whether Parea is working for the people using it — design §18, for the hub.
 *
 * §18 named the numbers that judge the product and said most of them are a
 * query, not tracking. These are those queries. Everything here is a count or
 * a share across everybody: an actor id is joined on inside the SQL and never
 * leaves it, and nothing comes back that is about one person — charter rule 4,
 * no number measures a person, holds in the admin API too.
 *
 * "Contributed" means bytes arrived: a row whose upload was started and never
 * completed is an upload that did not happen, and a `failed` one is a photo
 * that never appeared. A photo later removed or quarantined still counts — the
 * person did add it.
 *
 * Small numbers are honest here rather than hidden. Before launch most of
 * these are a handful, and the hub says how many each share is out of.
 */

import { sql } from 'drizzle-orm';

import type { Db } from './db';

/** How far back the hub may ask about, in days. */
export const EXPERIENCE_PERIODS = [7, 30, 90, 365] as const;
export type ExperiencePeriod = (typeof EXPERIENCE_PERIODS)[number];

/** Who kept less than half of what they were offered, out of at least this many. */
const HEAVY_DESELECT_MIN_OFFERED = 4;
/** How many signup weeks the retention grid shows, and how many weeks after. */
const RETENTION_WEEKS = 8;
/** Bytes landed this long ago and still `pending`: the deriver is not draining. */
const STUCK_AFTER_MINUTES = 15;

const CONTRIBUTED = sql.raw(`(p."status" <> 'failed' and (p."status" <> 'pending' or p."bytes_at" is not null))`);

/** `YYYY-MM-DD` arithmetic in UTC, for the retention grid's week labels. */
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}

const rowsOf = (result: any) => (result.rows ?? result) as any[];
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function experience(db: Db, days: ExperiencePeriod) {
  const since = sql`now() - make_interval(days => ${days})`;

  // ---------------------------------------------------------------------------
  // The loop: does anybody other than the creator add photos?

  const [loop] = rowsOf(
    await db.execute(sql`
      with ev as (
        select e."id", e."created_at", e."created_by", e."starts_at", e."group_id"
          from "event" e
         where e."deleted_at" is null and e."created_at" > ${since}
      ),
      up as (
        select p."event_id", p."uploader_id", count(*)::int as "n", min(p."uploaded_at") as "first_at"
          from "photo" p join ev on ev."id" = p."event_id"
         where ${CONTRIBUTED}
         group by p."event_id", p."uploader_id"
      ),
      per as (
        select ev."id", ev."created_at", ev."starts_at", ev."group_id",
               count(up."uploader_id")::int as "contributors",
               coalesce(sum(up."n"), 0)::int as "photos",
               coalesce(max(up."n"), 0)::int as "top",
               min(up."first_at") filter (where up."uploader_id" <> ev."created_by") as "first_other_at"
          from ev left join up on up."event_id" = ev."id"
         group by ev."id", ev."created_at", ev."starts_at", ev."group_id"
      )
      select
        count(*)::int as "events",
        count(*) filter (where "contributors" = 0)::int as "none",
        count(*) filter (where "contributors" = 1)::int as "one",
        count(*) filter (where "contributors" between 2 and 3)::int as "few",
        count(*) filter (where "contributors" >= 4)::int as "many",
        count(*) filter (where "first_other_at" is not null)::int as "otherUploaded",
        percentile_cont(0.5) within group (order by extract(epoch from "first_other_at" - "created_at") / 3600)
          filter (where "first_other_at" is not null) as "medianHoursToOther",
        (select percentile_cont(0.5) within group (order by "n") from up) as "medianPhotosPerContributor",
        (select count(*)::int from up) as "contributions",
        percentile_cont(0.5) within group (order by "top"::float / "photos")
          filter (where "contributors" >= 2) as "medianTopShare",
        count(*) filter (where "photos" > 0)::int as "withPhotos",
        count(*) filter (where "photos" > 0 and exists (
          select 1 from "observation" o where o."kind" = 'download' and o."event_id" = per."id"
        ))::int as "downloaded",
        count(*) filter (where "starts_at" is not null)::int as "withWindow",
        count(*) filter (where "group_id" is not null)::int as "inGroup",
        count(*) filter (where exists (
          select 1
            from "event_participant" x
            join "event_participant" y on y."actor_id" = x."actor_id" and y."event_id" <> x."event_id"
            join "event" e2 on e2."id" = y."event_id" and e2."deleted_at" is null
           where x."event_id" = per."id"
           group by y."event_id"
          having count(*) >= 2
        ))::int as "sharedPeople"
      from per
    `),
  );

  const [people] = rowsOf(
    await db.execute(sql`
      select count(*)::int as "inAny", count(*) filter (where "n" >= 2)::int as "inTwo"
        from (
          select ep."actor_id", count(*) as "n"
            from "event_participant" ep
            join "event" e on e."id" = ep."event_id" and e."deleted_at" is null
            join "actor" a on a."id" = ep."actor_id" and a."merged_into_id" is null
           group by ep."actor_id"
        ) t
    `),
  );

  const [groups] = rowsOf(
    await db.execute(sql`
      with g as (
        select gr."id", (select count(*) from "group_member" m where m."group_id" = gr."id") as "members"
          from "groups" gr
         where gr."deleted_at" is null and gr."created_at" > ${since}
      )
      select count(*)::int as "created", count(*) filter (where "members" >= 2)::int as "withOthers" from g
    `),
  );

  // Twelve weeks, whatever the period: the trend is the point, not the window.
  const weeks = rowsOf(
    await db.execute(sql`
      with wk as (
        select generate_series(
                 date_trunc('week', now() at time zone 'utc') - interval '11 weeks',
                 date_trunc('week', now() at time zone 'utc'),
                 interval '1 week') as "w"
      ),
      per as (
        select date_trunc('week', e."created_at" at time zone 'utc') as "w",
               (select count(distinct p."uploader_id") from "photo" p
                 where p."event_id" = e."id" and ${CONTRIBUTED}) as "contributors"
          from "event" e
         where e."deleted_at" is null
           and e."created_at" > date_trunc('week', now() at time zone 'utc') - interval '11 weeks'
      )
      select to_char(wk."w", 'YYYY-MM-DD') as "week",
             count(per."w")::int as "events",
             count(per."w") filter (where per."contributors" >= 2)::int as "shared"
        from wk left join per on per."w" = wk."w"
       group by wk."w"
       order by wk."w"
    `),
  );

  // ---------------------------------------------------------------------------
  // The app: which client people arrive on, and whether suggestions are kept.

  const joins = rowsOf(
    await db.execute(sql`
      with j as (
        select distinct on (o."event_id", o."actor_id") o."event_id", o."actor_id", o."client"
          from "observation" o
         where o."kind" = 'joined' and o."actor_id" is not null and o."event_id" is not null
           and o."created_at" > ${since}
         order by o."event_id", o."actor_id", o."created_at"
      )
      select j."client",
             count(*)::int as "joined",
             count(*) filter (where exists (
               select 1 from "photo" p
                where p."event_id" = j."event_id" and p."uploader_id" = j."actor_id" and ${CONTRIBUTED}
             ))::int as "contributed"
        from j
       group by j."client"
    `),
  );

  const downloads = rowsOf(
    await db.execute(sql`
      select o."client", count(*)::int as "n"
        from "observation" o
       where o."kind" = 'download' and o."created_at" > ${since}
       group by o."client"
    `),
  );

  const [suggest] = rowsOf(
    await db.execute(sql`
      select
        count(*) filter (where "kind" = 'autoselect_shown')::int as "shown",
        count(*) filter (where "kind" = 'picker_used')::int as "picker",
        coalesce(sum("count") filter (where "kind" = 'autoselect_confirmed'), 0)::int as "kept",
        coalesce(sum("out_of") filter (where "kind" = 'autoselect_confirmed'), 0)::int as "offered",
        count(*) filter (where "kind" = 'autoselect_confirmed')::int as "confirmed",
        percentile_cont(0.5) within group (order by "out_of" - "count")
          filter (where "kind" = 'autoselect_confirmed' and "out_of" >= "count") as "medianUnticked"
        from "observation"
       where "created_at" > ${since} and "kind" in ('autoselect_shown', 'autoselect_confirmed', 'picker_used')
    `),
  );

  // Each person's first confirmed suggestion in the period, and whether they
  // were in another album after it. Recent ones have had less time to come
  // back; that is the same for both halves, so the comparison still holds.
  const deselect = rowsOf(
    await db.execute(sql`
      with c as (
        select distinct on (o."actor_id") o."actor_id", o."event_id", o."created_at",
               (o."out_of" >= ${HEAVY_DESELECT_MIN_OFFERED} and o."count" * 2 < o."out_of") as "heavy"
          from "observation" o
         where o."kind" = 'autoselect_confirmed' and o."actor_id" is not null and o."out_of" > 0
           and o."created_at" > ${since}
         order by o."actor_id", o."created_at"
      )
      select c."heavy",
             count(*)::int as "people",
             count(*) filter (where exists (
               select 1 from "event_participant" ep
                where ep."actor_id" = c."actor_id"
                  and ep."event_id" is distinct from c."event_id"
                  and ep."first_seen_at" > c."created_at"
             ))::int as "returned"
        from c
       group by c."heavy"
    `),
  );

  const [firstContributor] = rowsOf(
    await db.execute(sql`
      with f as (
        select distinct on (p."event_id") p."event_id", p."uploader_id"
          from "photo" p
          join "event" e on e."id" = p."event_id" and e."deleted_at" is null and e."created_at" > ${since}
         where ${CONTRIBUTED}
         order by p."event_id", p."uploaded_at", p."added_seq"
      ),
      g as (
        select
          exists (select 1 from "observation" o where o."kind" = 'autoselect_shown'
                   and o."event_id" = f."event_id" and o."actor_id" = f."uploader_id") as "suggested",
          exists (select 1 from "observation" o where o."kind" = 'picker_used'
                   and o."event_id" = f."event_id" and o."actor_id" = f."uploader_id") as "picked"
          from f
      )
      select count(*)::int as "events",
             count(*) filter (where "suggested")::int as "suggested",
             count(*) filter (where not "suggested" and "picked")::int as "picker"
        from g
    `),
  );

  // ---------------------------------------------------------------------------
  // Activity over time, and retention by the week people arrived. Both start
  // when `activity_day` did: there is no history to rebuild before it.

  const span = Math.max(days, 28);
  const activity = rowsOf(
    await db.execute(sql`
      select to_char(d, 'YYYY-MM-DD') as "day",
             coalesce(sum(a."active") filter (where a."kind" = 'user'), 0)::int as "accounts",
             coalesce(sum(a."active") filter (where a."kind" = 'guest'), 0)::int as "guests"
        from generate_series(
               (now() at time zone 'utc')::date - ${span - 1}::int,
               (now() at time zone 'utc')::date,
               interval '1 day') d
        left join "activity_day" a on a."day" = d::date
       group by d
       order by d
    `),
  );
  const [firstDay] = rowsOf(
    await db.execute(sql`select to_char(min("day"), 'YYYY-MM-DD') as "day" from "activity_day"`),
  );

  // Weekly active: every cohort's count for a week is everybody active that week, once.
  const weekly = rowsOf(
    await db.execute(sql`
      select to_char(w, 'YYYY-MM-DD') as "week", coalesce(sum(a."active"), 0)::int as "active"
        from generate_series(
               date_trunc('week', now() at time zone 'utc') - interval '11 weeks',
               date_trunc('week', now() at time zone 'utc'),
               interval '1 week') w
        left join "activity_week" a on a."week" = w::date
       group by w
       order by w
    `),
  );
  const retention = await retentionGrid(db, firstDay?.day ?? null);

  // ---------------------------------------------------------------------------
  // The door: arrivals, who got in, and who was turned away and why.

  const doorRows = rowsOf(
    await db.execute(sql`
      select "client",
             count(*) filter (where "kind" = 'link_opened')::int as "opened",
             count(*) filter (where "kind" = 'joined')::int as "joined",
             count(*) filter (where "kind" = 'join_refused')::int as "refused"
        from "observation"
       where "created_at" > ${since} and "kind" in ('link_opened', 'joined', 'join_refused')
       group by "client"
    `),
  );
  const refusals = rowsOf(
    await db.execute(sql`
      select coalesce("reason", 'unknown') as "reason", count(*)::int as "n"
        from "observation"
       where "created_at" > ${since} and "kind" = 'join_refused'
       group by 1
       order by 2 desc
    `),
  );
  const [doorSince] = rowsOf(
    await db.execute(sql`select min("created_at") as "at" from "observation" where "kind" = 'link_opened'`),
  );

  // ---------------------------------------------------------------------------
  // Reliability: photos that did not appear, jobs that did not run, doors left shut.

  const [photos] = rowsOf(
    await db.execute(sql`
      select
        count(*) filter (where p."status" = 'pending' and p."bytes_at" is not null)::int as "processing",
        count(*) filter (where p."status" = 'pending' and p."bytes_at" is not null
                           and p."bytes_at" < now() - make_interval(mins => ${STUCK_AFTER_MINUTES}))::int as "stuck",
        min(p."bytes_at") filter (where p."status" = 'pending' and p."bytes_at" is not null) as "oldestProcessing",
        count(*) filter (where p."uploaded_at" > ${since} and ${CONTRIBUTED})::int as "arrived",
        count(*) filter (where p."uploaded_at" > ${since} and p."status" = 'failed')::int as "failed",
        count(*) filter (where p."uploaded_at" > ${since} and p."status" = 'pending' and p."bytes_at" is null
                           and p."uploaded_at" < now() - interval '1 day')::int as "abandoned"
        from "photo" p
       where p."deleted_at" is null
    `),
  );

  const jobs = rowsOf(
    await db.execute(sql`
      select "name", "last_succeeded_at" as "lastSucceededAt", "last_failed_at" as "lastFailedAt",
             "last_error" as "lastError"
        from "job_run"
       order by "name"
    `),
  );

  const waiting = rowsOf(
    await db.execute(sql`
      select 'album_access' as "kind", count(*)::int as "open", min("created_at") as "oldest",
             count(*) filter (where "created_at" < now() - interval '7 days')::int as "overAWeek"
        from "event_access_request" where "status" = 'open'
      union all
      select 'album_host', count(*)::int, min("created_at"),
             count(*) filter (where "created_at" < now() - interval '7 days')::int
        from "event_host_request" where "status" = 'open'
      union all
      select 'group_join', count(*)::int, min("created_at"),
             count(*) filter (where "created_at" < now() - interval '7 days')::int
        from "group_join_request" where "status" = 'open'
    `),
  );

  const byClient = (rows: any[], key: string) =>
    Object.fromEntries(['web', 'ios', 'android'].map((c) => [c, Number(rows.find((r) => r.client === c)?.[key] ?? 0)]));
  const half = (heavy: boolean) => {
    const r = deselect.find((d) => d.heavy === heavy);
    return { people: Number(r?.people ?? 0), returned: Number(r?.returned ?? 0) };
  };

  return {
    days,
    loop: {
      events: loop.events,
      contributors: { none: loop.none, one: loop.one, few: loop.few, many: loop.many },
      otherUploaded: loop.otherUploaded,
      medianHoursToOther: num(loop.medianHoursToOther),
      contributions: loop.contributions,
      medianPhotosPerContributor: num(loop.medianPhotosPerContributor),
      medianTopShare: num(loop.medianTopShare),
      withPhotos: loop.withPhotos,
      downloaded: loop.downloaded,
      withWindow: loop.withWindow,
      inGroup: loop.inGroup,
      sharedPeople: loop.sharedPeople,
      people: { inAny: people.inAny, inTwo: people.inTwo },
      groups: { created: groups.created, withOthers: groups.withOthers },
      weeks: weeks.map((w) => ({ week: w.week as string, events: w.events as number, shared: w.shared as number })),
    },
    app: {
      joined: byClient(joins, 'joined'),
      contributed: byClient(joins, 'contributed'),
      downloads: byClient(downloads, 'n'),
      suggestions: {
        shown: suggest.shown,
        picker: suggest.picker,
        confirmed: suggest.confirmed,
        kept: suggest.kept,
        offered: suggest.offered,
        medianUnticked: num(suggest.medianUnticked),
      },
      deselectors: { heavy: half(true), others: half(false) },
      firstContributor: {
        events: firstContributor.events,
        suggested: firstContributor.suggested,
        picker: firstContributor.picker,
      },
    },
    activity: {
      recordingSince: (firstDay?.day as string | null) ?? null,
      days: activity.map((d) => ({ day: d.day as string, accounts: Number(d.accounts), guests: Number(d.guests) })),
      weeks: weekly.map((w) => ({ week: w.week as string, active: Number(w.active) })),
      retention,
    },
    doors: {
      recordingSince: doorSince?.at ? new Date(doorSince.at).toISOString() : null,
      byClient: Object.fromEntries(
        ['web', 'ios', 'android'].map((c) => {
          const r = doorRows.find((x) => x.client === c);
          return [c, { opened: Number(r?.opened ?? 0), joined: Number(r?.joined ?? 0), refused: Number(r?.refused ?? 0) }];
        }),
      ) as Record<'web' | 'ios' | 'android', { opened: number; joined: number; refused: number }>,
      refusals: refusals.map((r) => ({ reason: r.reason as string, n: Number(r.n) })),
    },
    reliability: {
      photos: {
        processing: photos.processing,
        stuck: photos.stuck,
        oldestProcessing: photos.oldestProcessing ? new Date(photos.oldestProcessing).toISOString() : null,
        arrived: photos.arrived,
        failed: photos.failed,
        abandoned: photos.abandoned,
      },
      jobs: jobs.map((j) => ({
        name: j.name as string,
        lastSucceededAt: j.lastSucceededAt ? new Date(j.lastSucceededAt).toISOString() : null,
        lastFailedAt: j.lastFailedAt ? new Date(j.lastFailedAt).toISOString() : null,
        lastError: (j.lastError as string | null) ?? null,
      })),
      waiting: waiting.map((w) => ({
        kind: w.kind as 'album_access' | 'album_host' | 'group_join',
        open: Number(w.open),
        oldest: w.oldest ? new Date(w.oldest).toISOString() : null,
        overAWeek: Number(w.overAWeek),
      })),
    },
  };
}

export type Experience = Awaited<ReturnType<typeof experience>>;

/**
 * Retention by signup week: the last `weeks` weeks people arrived in, and for
 * each, how many were active k weeks later. `null` where a week is still
 * ahead or came before counting began — unknown, which is not the same as
 * nobody. Shared by the Experience page and the overview.
 */
export async function retentionGrid(db: Db, recordingSince: string | null, weeks: number = RETENTION_WEEKS) {
  const cohorts = rowsOf(
    await db.execute(sql`
      with c as (
        select generate_series(
                 date_trunc('week', now() at time zone 'utc') - interval '${sql.raw(String(weeks - 1))} weeks',
                 date_trunc('week', now() at time zone 'utc'),
                 interval '1 week')::date as "cohort"
      )
      select to_char(c."cohort", 'YYYY-MM-DD') as "cohort",
             (select count(*)::int from "actor" a
               where a."merged_into_id" is null
                 and date_trunc('week', a."created_at" at time zone 'utc')::date = c."cohort") as "size",
             coalesce((select json_agg(json_build_object('k', (w."week" - c."cohort") / 7, 'n', w."active"))
                         from "activity_week" w where w."cohort" = c."cohort"), '[]'::json) as "cells"
        from c
       order by c."cohort"
    `),
  );
  const thisWeek = cohorts.length ? cohorts[cohorts.length - 1].cohort : null;
  const recordedFromWeek = recordingSince ? mondayOf(recordingSince) : null;
  return cohorts.map((c) => {
    const found = new Map<number, number>(
      (typeof c.cells === 'string' ? JSON.parse(c.cells) : c.cells).map((x: { k: number; n: number }) => [Number(x.k), Number(x.n)]),
    );
    return {
      cohort: c.cohort as string,
      size: Number(c.size),
      // null where the week has not happened yet, or happened before counting began.
      weeks: Array.from({ length: weeks }, (_, k) => {
        const week = addDays(c.cohort, 7 * k);
        if (!thisWeek || week > thisWeek) return null;
        if (!recordedFromWeek || week < recordedFromWeek) return null;
        return found.get(k) ?? 0;
      }),
    };
  });

}
