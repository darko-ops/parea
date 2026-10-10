/**
 * The watcher for the hourly clean-up — a dead man's switch.
 *
 * The clean-up runs on Fly and once failed silently for a week: pointed at a
 * database that refused every connection, it exited with an error each hour
 * and nothing anywhere noticed. Removal requests would not have auto-hidden,
 * moments would not have expired and deleted photos would not have been
 * purged — each a promise on the privacy page.
 *
 * So the job stamps `job_run` when a full run succeeds, and this — on Vercel's
 * cron, different infrastructure that cannot go down with the job — raises an
 * alert when that stamp is too old. It alerts on silence rather than on a
 * reported failure, because the likeliest failure (no database) is one the job
 * cannot report.
 *
 * Where the alert goes: Sentry, always, which emails whoever owns the project
 * about a new issue; and `OPS_ALERT_EMAIL`, if set. Once per outage, repeated
 * every twelve hours while it lasts, and reset when a run succeeds again.
 *
 * The daily off-site backup is watched the same way, from its own `job_run`
 * row (`backup`, written by the hourly job's backup step): no success for 26
 * hours — the copy is due at 23 and tried every hour after — is an alert.
 * Watched once the row exists, which the first run of the new job writes even
 * when the backup is not configured, so a missing configuration is told too.
 */

import * as Sentry from '@sentry/nextjs';
import { mailerFromEnv, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { cronGuard } from '@/cron';
import { getDb } from '@/db';

export const runtime = 'nodejs';

/** One alert per outage, repeated this often while it lasts. */
const REALERT_AFTER_MS = 12 * 60 * 60 * 1000;

type Watched = {
  name: string;
  /** No success for this long is an outage. */
  staleAfterMs: number;
  /** What it is, in a sentence's subject: "The hourly clean-up". */
  title: string;
  /** Where to look, for the alert's body. */
  where: string[];
  /** Watched only once its row exists. */
  onceStarted?: boolean;
};

const JOBS: Watched[] = [
  {
    name: 'hourly',
    // A run is hourly; three missed in a row is an outage, not a slow run.
    staleAfterMs: 3 * 60 * 60 * 1000,
    title: 'The hourly clean-up',
    where: [
      'It runs on Fly as the scheduled machine parea-jobs-hourly. Check its',
      'logs with `flyctl logs -a parea-jobs`, and its secrets against',
      'parea-deriver with `flyctl secrets list`.',
    ],
  },
  {
    name: 'backup',
    staleAfterMs: 26 * 60 * 60 * 1000,
    title: 'The off-site database backup',
    where: [
      'It is a step of the hourly job on parea-jobs (`src/backup.ts`):',
      '`flyctl logs -a parea-jobs` shows a `backup:` line each run. The',
      'last error above usually says which: pg_dump, age, the BACKUP_R2_*',
      'key, or a missing secret. docs/backup-restore.md has the setup.',
    ],
    onceStarted: true,
  },
];

async function watch(db: ReturnType<typeof getDb>, now: Date, job: Watched) {
  const [run] = await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.name, job.name)).limit(1);
  if (!run && job.onceStarted) return { ok: true, lastSucceededAt: null, watched: false };

  const last = run?.lastSucceededAt ?? null;
  const stale = !last || now.getTime() - last.getTime() > job.staleAfterMs;

  if (!stale) {
    // Healthy. Forget any alert, so the next outage is told at once.
    if (run?.lastAlertedAt) {
      await db.update(schema.jobRuns).set({ lastAlertedAt: null }).where(eq(schema.jobRuns.name, job.name));
    }
    return { ok: true, lastSucceededAt: last!.toISOString() };
  }

  const alertedRecently =
    run?.lastAlertedAt && now.getTime() - run.lastAlertedAt.getTime() < REALERT_AFTER_MS;
  if (!alertedRecently) {
    const hours = last ? Math.floor((now.getTime() - last.getTime()) / 3_600_000) : null;
    const headline = last
      ? `${job.title} has not succeeded for ${hours} hours`
      : `${job.title} has never recorded a successful run`;
    const detail = [
      headline + '.',
      '',
      `last success:  ${last?.toISOString() ?? 'never'}`,
      `last failure:  ${run?.lastFailedAt?.toISOString() ?? 'none recorded'}`,
      `last error:    ${run?.lastError ?? '(none recorded — the job may not be reaching the database at all)'}`,
      '',
      ...job.where,
    ].join('\n');

    Sentry.captureMessage(headline, {
      level: 'error',
      tags: { kind: job.name === 'hourly' ? 'jobs_heartbeat' : `${job.name}_heartbeat` },
      extra: {
        lastSucceededAt: last?.toISOString() ?? null,
        lastFailedAt: run?.lastFailedAt?.toISOString() ?? null,
        lastError: run?.lastError ?? null,
      },
    });
    await Sentry.flush(2000).catch(() => false);

    const to = process.env.OPS_ALERT_EMAIL;
    if (to) {
      await mailerFromEnv()
        .send({ to, subject: `Parea: ${headline.toLowerCase()}`, text: detail })
        .catch((err) => console.error('jobs heartbeat: alert email failed', err));
    }
    console.error(`jobs heartbeat: ${headline}`);

    await db
      .insert(schema.jobRuns)
      .values({ name: job.name, lastAlertedAt: now })
      .onConflictDoUpdate({ target: schema.jobRuns.name, set: { lastAlertedAt: now } });
  }

  return { ok: false, lastSucceededAt: last?.toISOString() ?? null, alerted: !alertedRecently };
}

export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;

  const db = getDb();
  const now = new Date();
  const [hourly, backup] = [await watch(db, now, JOBS[0]!), await watch(db, now, JOBS[1]!)];
  return NextResponse.json({ ...hourly, ok: hourly.ok && backup.ok, backup });
}
