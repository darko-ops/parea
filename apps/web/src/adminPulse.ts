/**
 * Parea at a glance — the hub's overview tab.
 *
 * How many people were here, against the same stretch before it; how many
 * come on a given day out of the month's (DAU/MAU); how many of each week's
 * arrivals came back; and what people did today, against the same hours a
 * week ago. Totals only, like everything the hub reads: an actor id never
 * leaves a query here, and nothing is about one person.
 *
 * Activity starts when `activity_day` did; days before it come back as null
 * rather than zero, because a zero there would be a claim about a day nobody
 * counted.
 */

import { sql } from 'drizzle-orm';

import { retentionGrid } from './adminExperience';
import type { Db } from './db';

export const PULSE_PERIODS = [7, 90, 365] as const;
export type PulsePeriod = (typeof PULSE_PERIODS)[number];

const rowsOf = (result: any) => (result.rows ?? result) as any[];

/** What people did, counted the same way for today and for a week ago. */
const ENGAGEMENT = [
  { key: 'photos', table: '"photo"', at: '"uploaded_at"', where: `("status" <> 'failed' and ("status" <> 'pending' or "bytes_at" is not null))` },
  { key: 'moments', table: '"moment"', at: '"created_at"', where: 'true' },
  { key: 'comments', table: '"moment_comment"', at: '"created_at"', where: 'true' },
  { key: 'messages', table: '"event_message"', at: '"created_at"', where: 'true' },
  { key: 'groupMessages', table: '"group_message"', at: '"created_at"', where: 'true' },
  { key: 'photoReactions', table: '"photo_reaction"', at: '"created_at"', where: 'true' },
  { key: 'momentReactions', table: '"moment_reaction"', at: '"created_at"', where: 'true' },
  { key: 'messageReactions', table: '"message_reaction"', at: '"created_at"', where: 'true' },
  { key: 'groupMessageReactions', table: '"group_message_reaction"', at: '"created_at"', where: 'true' },
] as const;

export async function pulse(db: Db, days: PulsePeriod) {
  const [first] = rowsOf(
    await db.execute(sql`select to_char(min("day"), 'YYYY-MM-DD') as "day" from "activity_day"`),
  );
  const since: string | null = first?.day ?? null;

  // This period and the one before it, in one pass, oldest first.
  const series = rowsOf(
    await db.execute(sql`
      select to_char(d, 'YYYY-MM-DD') as "day",
             coalesce(sum(a."active") filter (where a."kind" = 'user'), 0)::int as "accounts",
             coalesce(sum(a."active") filter (where a."kind" = 'guest'), 0)::int as "guests"
        from generate_series(
               (now() at time zone 'utc')::date - ${2 * days - 1}::int,
               (now() at time zone 'utc')::date,
               interval '1 day') d
        left join "activity_day" a on a."day" = d::date
       group by d
       order by d
    `),
  ).map((d) => {
    const counted = since !== null && (d.day as string) >= since;
    return {
      day: d.day as string,
      accounts: counted ? Number(d.accounts) : null,
      guests: counted ? Number(d.guests) : null,
    };
  });

  const [totals] = rowsOf(
    await db.execute(sql`
      select
        (select coalesce(sum("active"), 0)::int from "activity_week"
          where "week" = date_trunc('week', now() at time zone 'utc')::date) as "week",
        (select coalesce(max("active"), 0)::int from "activity_month"
          where "month" = date_trunc('month', now() at time zone 'utc')::date) as "month",
        (select to_char(min("month"), 'YYYY-MM-DD') from "activity_month") as "monthsSince"
    `),
  );

  // Today so far, against the same hours of the same weekday a week ago.
  const counts = sql.join(
    ENGAGEMENT.map(
      (e) => sql.raw(`
        (select count(*)::int from ${e.table}
          where ${e.where}
            and ${e.at} >= date_trunc('day', now() at time zone 'utc') at time zone 'utc') as "${e.key}Today",
        (select count(*)::int from ${e.table}
          where ${e.where}
            and ${e.at} >= (date_trunc('day', now() at time zone 'utc') - interval '7 days') at time zone 'utc'
            and ${e.at} < now() - interval '7 days') as "${e.key}LastWeek"`),
    ),
    sql`,`,
  );
  const [engaged] = rowsOf(await db.execute(sql`select ${counts}`));
  const pair = (key: string) => ({ today: Number(engaged[`${key}Today`]), lastWeek: Number(engaged[`${key}LastWeek`]) });
  const add = (...keys: string[]) =>
    keys.map(pair).reduce((a, b) => ({ today: a.today + b.today, lastWeek: a.lastWeek + b.lastWeek }));

  const incidents = rowsOf(
    await db.execute(sql`
      select to_char(("created_at" at time zone 'utc')::date, 'YYYY-MM-DD') as "day", count(*)::int as "n"
        from "safety_incident"
       where "created_at" > now() - make_interval(days => ${days})
       group by 1
       order by 1
    `),
  );

  return {
    days,
    recordingSince: since,
    current: series.slice(days),
    previous: series.slice(0, days),
    week: Number(totals.week),
    month: Number(totals.month),
    monthsSince: (totals.monthsSince as string | null) ?? null,
    retention: await retentionGrid(db, since),
    engagement: {
      photos: pair('photos'),
      moments: pair('moments'),
      comments: pair('comments'),
      messages: add('messages', 'groupMessages'),
      reactions: add('photoReactions', 'momentReactions', 'messageReactions', 'groupMessageReactions'),
    },
    incidentDays: incidents.map((i) => ({ day: i.day as string, n: Number(i.n) })),
  };
}

export type Pulse = Awaited<ReturnType<typeof pulse>>;
