/**
 * How Parea grows, and who stays — the hub's growth & retention tab.
 *
 * Week by week: who arrived (accounts and guests), which accounts closed,
 * and how many people were active; month by month, how many were active;
 * of each week's arrivals, how many joined an album and how many added
 * photos within their first seven days; and retention by signup week over
 * a longer stretch than the overview shows.
 *
 * Totals only. An account created and later closed is still counted as
 * created — `account_closure` keeps its creation date for exactly this, and
 * nothing that says whose it was.
 */

import { sql } from 'drizzle-orm';

import { retentionGrid } from './adminExperience';
import type { Db } from './db';

export const GROWTH_PERIODS = [90, 365] as const;
export type GrowthPeriod = (typeof GROWTH_PERIODS)[number];

/** A photo that arrived, as everywhere else in the admin numbers. */
const CONTRIBUTED = sql.raw(`(p."status" <> 'failed' and (p."status" <> 'pending' or p."bytes_at" is not null))`);

const rowsOf = (result: any) => (result.rows ?? result) as any[];

export async function growth(db: Db, days: GrowthPeriod) {
  const weeks = Math.round(days / 7);
  const weekSeries = sql`generate_series(
      date_trunc('week', now() at time zone 'utc') - make_interval(weeks => ${weeks - 1}),
      date_trunc('week', now() at time zone 'utc'),
      interval '1 week')`;

  const byWeek = rowsOf(
    await db.execute(sql`
      with w as (select ${weekSeries}::date as "week")
      select to_char(w."week", 'YYYY-MM-DD') as "week",
             (select count(*)::int from "account"
               where date_trunc('week', "created_at" at time zone 'utc')::date = w."week")
           + (select count(*)::int from "account_closure"
               where date_trunc('week', "account_created_at" at time zone 'utc')::date = w."week") as "accounts",
             (select count(*)::int from "actor"
               where "kind" = 'guest' and "merged_into_id" is null
                 and date_trunc('week', "created_at" at time zone 'utc')::date = w."week") as "guests",
             (select count(*)::int from "account_closure"
               where date_trunc('week', "closed_at" at time zone 'utc')::date = w."week") as "closed",
             (select count(*)::int from "actor"
               where "merged_into_id" is null
                 and "created_at" < (w."week" + 7)::timestamp at time zone 'utc') as "people",
             (select coalesce(sum("active"), 0)::int from "activity_week" a where a."week" = w."week") as "active"
        from w
       order by w."week"
    `),
  );

  const byMonth = rowsOf(
    await db.execute(sql`
      with m as (
        select generate_series(
                 date_trunc('month', now() at time zone 'utc') - interval '11 months',
                 date_trunc('month', now() at time zone 'utc'),
                 interval '1 month')::date as "month"
      )
      select to_char(m."month", 'YYYY-MM-DD') as "month", a."active"
        from m left join "activity_month" a on a."month" = m."month"
       order by m."month"
    `),
  );

  // Of the people who arrived each week, how many were in an album, and how
  // many added photos, within seven days of arriving. Weeks whose seven days
  // are not over yet are marked, so a young week is not read as a bad one.
  const activation = rowsOf(
    await db.execute(sql`
      with w as (select ${weekSeries}::date as "week"),
      arrived as (
        select a."id", a."created_at", date_trunc('week', a."created_at" at time zone 'utc')::date as "week"
          from "actor" a
         where a."merged_into_id" is null
           and a."created_at" >= (select min("week") from w)::timestamp at time zone 'utc'
      )
      select to_char(w."week", 'YYYY-MM-DD') as "week",
             count(ar."id")::int as "arrived",
             count(ar."id") filter (where exists (
               select 1 from "event_participant" ep
                where ep."actor_id" = ar."id" and ep."first_seen_at" < ar."created_at" + interval '7 days'
             ))::int as "inAlbum",
             count(ar."id") filter (where exists (
               select 1 from "photo" p
                where p."uploader_id" = ar."id" and ${CONTRIBUTED}
                  and p."uploaded_at" < ar."created_at" + interval '7 days'
             ))::int as "addedPhotos",
             (w."week" + 14)::timestamp at time zone 'utc' <= now() as "settled"
        from w left join arrived ar on ar."week" = w."week"
       group by w."week"
       order by w."week"
    `),
  );

  const [first] = rowsOf(
    await db.execute(sql`select to_char(min("day"), 'YYYY-MM-DD') as "day" from "activity_day"`),
  );
  const since: string | null = first?.day ?? null;

  return {
    days,
    recordingSince: since,
    weeks: byWeek.map((w) => ({
      week: w.week as string,
      accounts: Number(w.accounts),
      guests: Number(w.guests),
      closed: Number(w.closed),
      people: Number(w.people),
      // Weekly active before counting began is unknown, not zero.
      active: since && (w.week as string) >= mondayOf(since) ? Number(w.active) : null,
    })),
    months: byMonth.map((m) => ({ month: m.month as string, active: m.active === null ? null : Number(m.active) })),
    activation: activation.map((a) => ({
      week: a.week as string,
      arrived: Number(a.arrived),
      inAlbum: Number(a.inAlbum),
      addedPhotos: Number(a.addedPhotos),
      settled: Boolean(a.settled),
    })),
    retention: await retentionGrid(db, since, 12),
  };
}

function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export type Growth = Awaited<ReturnType<typeof growth>>;
