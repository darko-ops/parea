/**
 * The alarm on the photo queue — run every fifteen minutes by Vercel's cron.
 *
 * Fifteen rather than five because each run wakes the database, and at five
 * the database never got to sleep: Neon suspends after five idle minutes, so a
 * check that often kept it awake all month for nothing.
 *
 * The deriver works through photographs in the order they arrive, a few at a
 * time. When more arrive than it can keep up with, nothing fails: photographs
 * simply sit at "Processing" for longer and longer, and the first anybody hears
 * of it is a guest saying their pictures never showed up. This asks the one
 * question that catches that early — how long has the oldest photograph been
 * waiting? — and says so when the answer is more than five minutes.
 *
 * Said through Sentry and, when `OPS_ALERT_EMAIL` is set, by email, the same
 * as the jobs heartbeat; once, and then again at most hourly while it lasts,
 * so a long backlog is one alert an hour rather than one every fifteen minutes.
 *
 * Recorded in `job_run` as `derive_backlog`, so the admin page lists it beside
 * the hourly clean-up: succeeded when the queue was healthy, failed with the
 * reason when it was not.
 */

import * as Sentry from '@sentry/nextjs';
import { mailerFromEnv, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { cronGuard } from '@/cron';
import { getDb } from '@/db';
import { deriveBacklog } from '@/deriveBacklog';

export const runtime = 'nodejs';

const NAME = 'derive_backlog';
/** How long the oldest photograph may wait before it is a problem. */
const BACKLOG_AFTER_MS = 5 * 60 * 1000;
const REALERT_AFTER_MS = 60 * 60 * 1000;

export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;

  const db = getDb();
  const now = new Date();

  const { waiting: count, oldestWaitedMs: waitedMs } = await deriveBacklog(db, now);
  const backed = waitedMs > BACKLOG_AFTER_MS;

  const [run] = await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.name, NAME)).limit(1);

  if (!backed) {
    await db
      .insert(schema.jobRuns)
      .values({ name: NAME, lastSucceededAt: now, lastAlertedAt: null })
      .onConflictDoUpdate({ target: schema.jobRuns.name, set: { lastSucceededAt: now, lastAlertedAt: null } });
    return NextResponse.json({ ok: true, waiting: count, oldestWaitedSeconds: Math.round(waitedMs / 1000) });
  }

  const minutes = Math.floor(waitedMs / 60_000);
  const headline = `${count} photo${count === 1 ? '' : 's'} waiting to process, the oldest for ${minutes} minutes`;
  const alertedRecently =
    run?.lastAlertedAt && now.getTime() - run.lastAlertedAt.getTime() < REALERT_AFTER_MS;

  if (!alertedRecently) {
    const detail = [
      headline + '.',
      '',
      'The deriver (Fly app parea-deriver) is not keeping up, or is not',
      'receiving deliveries. Check `flyctl logs -a parea-deriver` and',
      '`flyctl status -a parea-deriver`. If it is working flat out, the next',
      'step is more cores (fly.toml [[vm]] cpus, DERIVER_CONCURRENCY and',
      'DERIVE_PARALLELISM together) or more machines — see docs/deploy.md.',
    ].join('\n');

    Sentry.captureMessage(headline, {
      level: 'error',
      tags: { kind: 'derive_backlog' },
      extra: { waiting: count, oldestWaitedSeconds: Math.round(waitedMs / 1000) },
    });
    await Sentry.flush(2000).catch(() => false);

    const to = process.env.OPS_ALERT_EMAIL;
    if (to) {
      await mailerFromEnv()
        .send({ to, subject: `Parea: ${headline}`, text: detail })
        .catch((err) => console.error('derive backlog: alert email failed', err));
    }
    console.error(`derive backlog: ${headline}`);
  }

  await db
    .insert(schema.jobRuns)
    .values({ name: NAME, lastFailedAt: now, lastError: headline, ...(alertedRecently ? {} : { lastAlertedAt: now }) })
    .onConflictDoUpdate({
      target: schema.jobRuns.name,
      set: { lastFailedAt: now, lastError: headline, ...(alertedRecently ? {} : { lastAlertedAt: now }) },
    });

  return NextResponse.json({ ok: false, waiting: count, oldestWaitedSeconds: Math.round(waitedMs / 1000), alerted: !alertedRecently });
}
