/**
 * The numbers from design §18.
 *
 * The concept's own test is *does anyone other than the creator upload?*, and
 * until this existed there was no way to answer it. §18 says to wire these in
 * the first release, so this is that — but note what it mostly is: **queries
 * over tables the product already fills.** Contributors per event, photos per
 * contributor, time to the first non-creator upload, group formation, whether
 * creators set a window — every one is a fact the schema already holds.
 * Collecting them again through a tracking pipeline would move user data
 * somewhere new and answer nothing extra.
 *
 * Only the five things nothing records go through `observation`; see the
 * comment on that table for why the list is closed.
 *
 * Read-only, and run from the CLI rather than served. There is no admin
 * authentication in this product, and inventing one so a dashboard can exist
 * is a larger security surface than these numbers are worth.
 */

import { schema } from '@parea/core';
import { and, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';

type Db = any;

export type Metric = {
  name: string;
  value: string;
  /** What a bad number would mean. Printed, because a number alone is not a signal. */
  reads?: string;
};

/** PGlite returns `{rows}`; postgres-js returns the array. */
function first<T>(result: unknown): T | undefined {
  const rows = (result as { rows?: T[] }).rows ?? (result as T[]);
  return Array.isArray(rows) ? rows[0] : undefined;
}

/**
 * The headline: how many events got a photo from someone other than whoever
 * made it.
 *
 * §18 calls one contributor "the failure case", and it is the product
 * hypothesis in a single number — the concept's argument is that people would
 * share if asking were not a favour. An event with one contributor is someone
 * talking to themselves.
 */
async function contribution(db: Db): Promise<Metric[]> {
  const row = first<{ events: number; shared: number; contributors: string | null }>(
    await db.execute(sql`
      with per_event as (
        select e.id,
               count(distinct p.uploader_id) filter (
                 where p.status = 'ready' and p.deleted_at is null
               ) as contributors,
               count(distinct p.uploader_id) filter (
                 where p.status = 'ready' and p.deleted_at is null
                   and p.uploader_id <> e.created_by
               ) as others
        from "event" e
        left join "photo" p on p.event_id = e.id
        where e.deleted_at is null
        group by e.id
      )
      select count(*)::int as events,
             count(*) filter (where others > 0)::int as shared,
             avg(contributors) as contributors
      from per_event
    `),
  );

  const events = Number(row?.events ?? 0);
  const shared = Number(row?.shared ?? 0);
  return [
    {
      name: 'events with a second contributor',
      value: events === 0 ? 'no events yet' : `${shared}/${events} (${pct(shared, events)})`,
      reads: 'the product hypothesis. One contributor is someone talking to themselves.',
    },
    {
      name: 'mean contributors per event',
      value: row?.contributors ? Number(row.contributors).toFixed(1) : '0',
      reads: 'two is a favour returned; six is the thing working.',
    },
  ];
}

/**
 * How long an event sits before someone other than its creator adds anything.
 *
 * The concept's friction is social rather than technical, so this is the shape
 * of the hesitation: a long tail means the link landed and nobody moved.
 */
async function timeToSecondContributor(db: Db): Promise<Metric[]> {
  const row = first<{ median: string | null; answered: number }>(
    await db.execute(sql`
      with first_other as (
        select e.id, min(p.uploaded_at) - e.created_at as delay
        from "event" e
        join "photo" p
          on p.event_id = e.id
         and p.uploader_id <> e.created_by
         and p.deleted_at is null
        where e.deleted_at is null
        group by e.id, e.created_at
      )
      select percentile_cont(0.5) within group (order by extract(epoch from delay)) as median,
             count(*)::int as answered
      from first_other
    `),
  );

  if (!Number(row?.answered ?? 0)) {
    return [{ name: 'time to a second contributor', value: 'nothing to measure yet' }];
  }
  return [
    {
      name: 'time to a second contributor (median)',
      value: humanDuration(Number(row!.median)),
      reads: 'hours is healthy; days means the link landed and nobody moved.',
    },
  ];
}

/** One heavy shooter, or several light ones? §18 wants to know which. */
async function distribution(db: Db): Promise<Metric[]> {
  const row = first<{ median: string | null; p90: string | null }>(
    await db.execute(sql`
      with per_contributor as (
        select count(*)::int as photos
        from "photo"
        where status = 'ready' and deleted_at is null
        group by event_id, uploader_id
      )
      select percentile_cont(0.5) within group (order by photos) as median,
             percentile_cont(0.9) within group (order by photos) as p90
      from per_contributor
    `),
  );

  return [
    {
      name: 'photos per contributor (median / p90)',
      value: row?.median
        ? `${Math.round(Number(row.median))} / ${Math.round(Number(row.p90))}`
        : 'nobody yet',
      reads: 'a wide gap is the 200-photo shooter the native client exists for.',
    },
  ];
}

/**
 * Did anyone actually leave with the photos?
 *
 * The one core metric that needs an observation: minting an archive leaves no
 * trace in the data model, and an event nobody downloads has delivered
 * nothing, however many photos went into it.
 */
async function downloads(db: Db): Promise<Metric[]> {
  const [events] = await db
    .select({ n: count() })
    .from(schema.events)
    .where(isNull(schema.events.deletedAt));
  const row = first<{ events: number }>(
    await db.execute(
      sql`select count(distinct event_id)::int as events from "observation" where kind = 'download'`,
    ),
  );

  const total = Number(events?.n ?? 0);
  const downloaded = Number(row?.events ?? 0);
  return [
    {
      name: 'events downloaded at least once',
      value: total === 0 ? 'no events yet' : `${downloaded}/${total} (${pct(downloaded, total)})`,
      reads: 'the terminal action. Photos nobody takes home were not delivered.',
    },
  ];
}

/** Do the same people come back? The thing groups are a bet on. */
async function returning(db: Db): Promise<Metric[]> {
  const row = first<{ repeat: number; people: number; groups: number }>(
    await db.execute(sql`
      with events_per_actor as (
        select uploader_id, count(distinct event_id)::int as events
        from "photo" where deleted_at is null group by uploader_id
      )
      select count(*) filter (where events > 1)::int as repeat,
             count(*)::int as people,
             (select count(*)::int from "groups" where deleted_at is null) as groups
      from events_per_actor
    `),
  );
  const [events] = await db
    .select({ n: count() })
    .from(schema.events)
    .where(isNull(schema.events.deletedAt));

  const people = Number(row?.people ?? 0);
  return [
    {
      name: 'contributors who came back',
      value: people === 0 ? 'nobody yet' : `${row!.repeat}/${people} (${pct(Number(row!.repeat), people)})`,
      reads: 'one-offs mean the product is a tool rather than a habit.',
    },
    {
      name: 'groups formed',
      value: `${row?.groups ?? 0} from ${events?.n ?? 0} events`,
      reads: 'decides whether the monetisation model exists at all.',
    },
  ];
}

/**
 * What fraction of events carry a window their creator set.
 *
 * §17's open question, and a constant zero until both create screens asked for
 * one — every event before that inferred its window from uploads, which helps
 * contributor five and not contributor one.
 */
async function windows(db: Db): Promise<Metric[]> {
  const [all] = await db
    .select({ n: count() })
    .from(schema.events)
    .where(isNull(schema.events.deletedAt));
  const [set] = await db
    .select({ n: count() })
    .from(schema.events)
    .where(and(isNull(schema.events.deletedAt), isNotNull(schema.events.startsAt)));

  return [
    {
      name: 'events with a creator-set window',
      value: Number(all?.n ?? 0) === 0 ? 'no events yet' : pct(Number(set?.n ?? 0), Number(all!.n)),
      reads: 'without one, contributor #1 gets the system picker — §7.3.',
    },
  ];
}

/** Which client people arrive on — §18's install-conversion question. */
async function clients(db: Db): Promise<Metric[]> {
  const rows = await db
    .select({ client: schema.observations.client, n: count() })
    .from(schema.observations)
    .where(eq(schema.observations.kind, 'joined'))
    .groupBy(schema.observations.client);

  const total = rows.reduce((sum: number, r: { n: number }) => sum + Number(r.n), 0);
  return [
    {
      name: 'joins by client',
      value:
        total === 0
          ? 'nobody yet'
          : rows
              .map((r: { client: string; n: number }) => `${r.client} ${pct(Number(r.n), total)}`)
              .join(', '),
      reads: 'a healthy web share means the install wall is cheaper than feared.',
    },
  ];
}

/**
 * The two numbers that judge the native bet — §18's own framing.
 *
 * Precision is what fraction of a suggestion survives to upload. The companion
 * is what became of the people it served worst: a suggestion someone had to
 * untick thirty times is *worse than no suggestion*, because it cost them the
 * time and spent the photo-library permission in the same moment, and neither
 * is recoverable. If those people do not come back, low precision is not a
 * tuning problem.
 */
async function autoSelect(db: Db): Promise<Metric[]> {
  const [shown] = await db
    .select({ n: count() })
    .from(schema.observations)
    .where(eq(schema.observations.kind, 'autoselect_shown'));
  const [picker] = await db
    .select({ n: count() })
    .from(schema.observations)
    .where(eq(schema.observations.kind, 'picker_used'));
  const [confirmed] = await db
    .select({
      kept: sql<string>`coalesce(sum("count"), 0)`,
      offered: sql<string>`coalesce(sum("out_of"), 0)`,
    })
    .from(schema.observations)
    .where(eq(schema.observations.kind, 'autoselect_confirmed'));

  const offered = Number(confirmed?.offered ?? 0);
  const metrics: Metric[] = [
    {
      name: 'suggestions shown / picker fallbacks',
      value: `${Number(shown?.n ?? 0)} / ${Number(picker?.n ?? 0)}`,
      reads: 'mostly fallbacks means the window or the geotags are not there.',
    },
    {
      name: 'auto-select precision',
      value: offered === 0 ? 'nothing confirmed yet' : pct(Number(confirmed!.kept), offered),
      reads: 'low means people are unticking, and the suggestion is costing them time.',
    },
  ];

  const heavy = first<{ came_back: number; total: number }>(
    await db.execute(sql`
      with deselectors as (
        select distinct actor_id
        from "observation"
        where kind = 'autoselect_confirmed'
          and actor_id is not null
          and out_of > 0
          and "count"::float / out_of < 0.5
      )
      select count(*) filter (
               where (
                 select count(distinct event_id) from "photo"
                 where uploader_id = d.actor_id and deleted_at is null
               ) > 1
             )::int as came_back,
             count(*)::int as total
      from deselectors d
    `),
  );

  const total = Number(heavy?.total ?? 0);
  metrics.push({
    name: 'heavy deselectors who came back',
    value: total === 0 ? 'none yet' : `${heavy!.came_back}/${total} (${pct(Number(heavy!.came_back), total)})`,
    reads: 'compare against the overall return rate. Below it, the suggestion is doing harm.',
  });

  return metrics;
}

export async function report(db: Db): Promise<Metric[]> {
  return [
    ...(await contribution(db)),
    ...(await timeToSecondContributor(db)),
    ...(await distribution(db)),
    ...(await downloads(db)),
    ...(await returning(db)),
    ...(await windows(db)),
    ...(await clients(db)),
    ...(await autoSelect(db)),
  ];
}

/** Plain text, no colour: this is read in `fly logs` as often as in a terminal. */
export function formatReport(metrics: Metric[]): string {
  const width = Math.max(...metrics.map((m) => m.name.length));
  return metrics
    .map((m) => {
      const line = `${m.name.padEnd(width)}  ${m.value}`;
      return m.reads ? `${line}\n${' '.repeat(width + 2)}${m.reads}` : line;
    })
    .join('\n');
}

function pct(part: number, whole: number): string {
  return whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`;
}

function humanDuration(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}
