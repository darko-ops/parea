/**
 * The loop — whether a roll brings people in, and whether they bring the next
 * roll. The hub's Invite loop page.
 *
 * Four questions, asked of the rolls made in the period, by the month each roll
 * was made:
 *
 * 1. **New people per active roll.** An active roll has a photo in it. A new
 *    person is somebody whose first roll on Parea was this one — the roll
 *    brought them. Everybody who joined is counted beside it.
 * 2. **Invitees who view, and who contribute.** An invitee is anybody but the
 *    roll's creator who was asked in by name or came in by its link, once per
 *    roll. Viewing is being in it: the participant row is written the first
 *    time somebody gets in. Contributing is a photo of theirs in it.
 * 3. **Invitees who make a roll of their own within 30 days** of first
 *    joining one — counted once per person, from their first join in the
 *    period, and only once those 30 days are over.
 * 4. **Friend groups that come back.** Two readings: a group (the product's
 *    own) whose second roll was made in the period; and a circle — a roll of
 *    three or more people, at least three of whom got together again in a
 *    later roll.
 *
 * A group's members reach its rolls without a participant row unless they add
 * to them, so in a group's roll only the people who came in by name or added a
 * photo count as invitees. Totals only, like every admin number.
 */

import { sql } from 'drizzle-orm';

import type { Db } from './db';

export const LOOP_PERIODS = [90, 365] as const;
export type LoopPeriod = (typeof LOOP_PERIODS)[number];

/** A photo that arrived, as everywhere else in the admin numbers. */
const CONTRIBUTED = sql.raw(`(p."status" <> 'failed' and (p."status" <> 'pending' or p."bytes_at" is not null))`);

const rowsOf = (result: any) => (result.rows ?? result) as any[];

export async function loop(db: Db, days: LoopPeriod) {
  const since = sql`now() - make_interval(days => ${days})`;

  /*
   * One CTE chain, one row per month a roll was made in.
   *
   * `rolls` is the period's rolls; `invitees` every (roll, person) asked in or
   * come in, the creator aside; `firsts` each person's first roll ever, which
   * is what makes them new to a roll rather than merely in it.
   */
  const months = rowsOf(
    await db.execute(sql`
      with rolls as (
        select e."id", e."created_by", e."created_at",
               date_trunc('month', e."created_at" at time zone 'utc')::date as "month",
               exists (select 1 from "photo" p where p."event_id" = e."id" and ${CONTRIBUTED}) as "active"
          from "event" e
         where e."created_at" >= ${since} and e."deleted_at" is null
      ),
      firsts as (
        select distinct on (ep."actor_id") ep."actor_id", ep."event_id"
          from "event_participant" ep
         order by ep."actor_id", ep."first_seen_at", ep."event_id"
      ),
      invitees as (
        select r."id" as "roll", r."month", x."actor_id"
          from rolls r
          join (
            select ep."event_id", ep."actor_id" from "event_participant" ep
            union
            select i."event_id", i."actor_id" from "event_invite" i
          ) x on x."event_id" = r."id"
         where x."actor_id" <> r."created_by"
      ),
      marked as (
        select v."roll", v."month", v."actor_id",
               ep."first_seen_at" as "joined",
               ep."actor_id" is not null as "viewed",
               exists (
                 select 1 from "photo" p
                  where p."event_id" = v."roll" and p."uploader_id" = v."actor_id" and ${CONTRIBUTED}
               ) as "contributed",
               exists (select 1 from firsts f where f."actor_id" = v."actor_id" and f."event_id" = v."roll") as "new"
          from invitees v
          left join "event_participant" ep on ep."event_id" = v."roll" and ep."actor_id" = v."actor_id"
      ),
      /*
       * Each person once, at their first join in the period: whether they made
       * a roll of their own within 30 days of it, and whether those 30 days
       * are over. A deleted roll still counts — making it is the act.
       */
      onward as (
        select distinct on (m."actor_id") m."actor_id", m."month", m."joined", m."contributed",
               m."joined" <= now() - interval '30 days' as "settled",
               exists (
                 select 1 from "event" e2
                  where e2."created_by" = m."actor_id"
                    and e2."created_at" > m."joined"
                    and e2."created_at" <= m."joined" + interval '30 days'
               ) as "created"
          from marked m
         where m."viewed"
         order by m."actor_id", m."joined"
      ),
      by_roll as (
        select r."month",
               count(*)::int as "rolls",
               count(*) filter (where r."active")::int as "activeRolls"
          from rolls r group by r."month"
      ),
      by_invitee as (
        select m."month",
               count(*)::int as "invitees",
               count(*) filter (where m."viewed")::int as "viewed",
               count(*) filter (where m."contributed")::int as "contributed",
               count(*) filter (where m."viewed" and r."active")::int as "joinedActive",
               count(*) filter (where m."new" and r."active")::int as "newActive"
          from marked m join rolls r on r."id" = m."roll"
         group by m."month"
      ),
      by_onward as (
        select o."month",
               count(*) filter (where o."settled")::int as "settled",
               count(*) filter (where o."settled" and o."created")::int as "created",
               count(*) filter (where o."settled" and o."contributed")::int as "settledContributors",
               count(*) filter (where o."settled" and o."contributed" and o."created")::int as "createdContributors"
          from onward o group by o."month"
      )
      select to_char(b."month", 'YYYY-MM-DD') as "month", b."rolls", b."activeRolls",
             coalesce(i."invitees", 0) as "invitees", coalesce(i."viewed", 0) as "viewed",
             coalesce(i."contributed", 0) as "contributed",
             coalesce(i."joinedActive", 0) as "joinedActive", coalesce(i."newActive", 0) as "newActive",
             coalesce(o."settled", 0) as "settled", coalesce(o."created", 0) as "created",
             coalesce(o."settledContributors", 0) as "settledContributors",
             coalesce(o."createdContributors", 0) as "createdContributors"
        from by_roll b
        left join by_invitee i on i."month" = b."month"
        left join by_onward o on o."month" = b."month"
       order by b."month"
    `),
  );

  /*
   * Friend groups that come back.
   *
   * Groups: the product's own, with a roll made in the period that was not
   * their first. Circles: the period's rolls of three or more people — its
   * creator and whoever is in it — at least three of whom are together again
   * in a roll made after it. A chain of rolls among the same friends counts
   * each roll whose circle came back, which is what "came back" means here.
   */
  const [groups] = rowsOf(
    await db.execute(sql`
      with g as (
        select e."group_id",
               count(*) filter (where e."created_at" >= ${since})::int as "inPeriod",
               min(e."created_at") as "first"
          from "event" e
         where e."group_id" is not null and e."deleted_at" is null
         group by e."group_id"
      )
      select count(*) filter (where g."inPeriod" > 0)::int as "withRolls",
             count(*) filter (where exists (
               select 1 from "event" e
                where e."group_id" = g."group_id" and e."deleted_at" is null
                  and e."created_at" >= ${since} and e."created_at" > g."first"
             ))::int as "repeating"
        from g
    `),
  );

  const [circles] = rowsOf(
    await db.execute(sql`
      with people as (
        select e."id" as "roll", e."created_at", e."created_by" as "actor_id" from "event" e where e."deleted_at" is null
        union
        select ep."event_id", e."created_at", ep."actor_id"
          from "event_participant" ep join "event" e on e."id" = ep."event_id"
         where e."deleted_at" is null
      ),
      sized as (
        select "roll", min("created_at") as "created_at", count(*) as "n"
          from people group by "roll"
      ),
      eligible as (
        select s."roll", s."created_at" from sized s where s."n" >= 3 and s."created_at" >= ${since}
      )
      select count(*)::int as "eligible",
             count(*) filter (where exists (
               select 1
                 from people a
                 join people b on b."actor_id" = a."actor_id" and b."created_at" > a."created_at"
                where a."roll" = el."roll"
                group by b."roll"
               having count(*) >= 3
             ))::int as "repeating"
        from eligible el
    `),
  );

  const n = (v: unknown) => Number(v ?? 0);
  return {
    days,
    months: months.map((m) => ({
      month: m.month as string,
      rolls: n(m.rolls),
      activeRolls: n(m.activeRolls),
      /** Everybody who joined an active roll, and of them, the ones it brought to Parea. */
      joinedActive: n(m.joinedActive),
      newActive: n(m.newActive),
      invitees: n(m.invitees),
      viewed: n(m.viewed),
      contributed: n(m.contributed),
      /** People whose 30 days after first joining are over, and who made a roll in them. */
      settled: n(m.settled),
      created: n(m.created),
      settledContributors: n(m.settledContributors),
      createdContributors: n(m.createdContributors),
    })),
    groups: { withRolls: n(groups?.withRolls), repeating: n(groups?.repeating) },
    circles: { eligible: n(circles?.eligible), repeating: n(circles?.repeating) },
  };
}

export type Loop = Awaited<ReturnType<typeof loop>>;
