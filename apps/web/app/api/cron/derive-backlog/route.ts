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
 *
 * ## And the photographs that failed
 *
 * A queue that moves can still be failing every photograph in it: the deriver
 * marks a photo it cannot decode or strip `failed`, which is terminal, and
 * goes on to the next. Behind a HEIC decoder that broke, every iPhone upload
 * failed for weeks and the only record was a line in Fly's logs. So the same
 * run asks which photographs failed since the last time it said so
 * (`photo.failed_at`, written by the deriver with the reason), and says how
 * many and why — through Sentry and `OPS_ALERT_EMAIL`, at most hourly, each
 * alert covering everything since the one before. Recorded as
 * `derive_failures`.
 */

import * as Sentry from '@sentry/nextjs';
import { mailerFromEnv, schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { cronGuard } from '@/cron';
import { getDb } from '@/db';
import { deriveBacklog, deriveFailures } from '@/deriveBacklog';

export const runtime = 'nodejs';

const NAME = 'derive_backlog';
/** How long the oldest photograph may wait before it is a problem. */
const BACKLOG_AFTER_MS = 5 * 60 * 1000;
const REALERT_AFTER_MS = 60 * 60 * 1000;
const FAILURES = 'derive_failures';
/** How far back the very first run looks, before there is an alert to count from. */
const FIRST_LOOK_MS = 24 * 60 * 60 * 1000;

/**
 * Says which photographs failed since the last alert, if any did and the last
 * alert is more than an hour old. Failures inside that hour are not lost: the
 * next alert counts from the last one, so it carries them.
 */
async function alarmOnFailures(db: ReturnType<typeof getDb>, now: Date): Promise<{ failed: number; alerted: boolean }> {
  const [run] = await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.name, FAILURES)).limit(1);
  const since = run?.lastAlertedAt ?? new Date(now.getTime() - FIRST_LOOK_MS);
  const { failed, byKind, latest } = await deriveFailures(db, since);

  if (failed === 0) {
    await db
      .insert(schema.jobRuns)
      .values({ name: FAILURES, lastSucceededAt: now })
      .onConflictDoUpdate({ target: schema.jobRuns.name, set: { lastSucceededAt: now } });
    return { failed, alerted: false };
  }

  const headline = `${failed} photo${failed === 1 ? '' : 's'} failed to process`;
  const kinds = byKind.map((k) => `${k.kind} ×${k.count}`).join(', ');
  const alertedRecently =
    run?.lastAlertedAt && now.getTime() - run.lastAlertedAt.getTime() < REALERT_AFTER_MS;

  if (!alertedRecently) {
    const detail = [
      `${headline} since ${since.toISOString()}: ${kinds}.`,
      '',
      'The latest:',
      ...latest.map((p) => `  ${p.failedAt.toISOString()}  ${p.id}  ${p.reason}`),
      '',
      'Failed is terminal: nothing retries these. The full line for each is in',
      '`flyctl logs -a parea-deriver` (search for the photo id). Once the cause',
      'is fixed, setting a row back to `pending` and resending it — see',
      '/api/cron/requeue-stranded — derives it again.',
    ].join('\n');

    Sentry.captureMessage(headline, {
      level: 'error',
      tags: { kind: 'derive_failures' },
      extra: { failed, byKind, latest },
    });
    await Sentry.flush(2000).catch(() => false);

    const to = process.env.OPS_ALERT_EMAIL;
    if (to) {
      await mailerFromEnv()
        .send({ to, subject: `Parea: ${headline} (${kinds})`, text: detail })
        .catch((err) => console.error('derive failures: alert email failed', err));
    }
    console.error(`derive failures: ${headline}: ${kinds}`);
  }

  const error = `${headline}: ${kinds}`;
  await db
    .insert(schema.jobRuns)
    .values({ name: FAILURES, lastFailedAt: now, lastError: error, ...(alertedRecently ? {} : { lastAlertedAt: now }) })
    .onConflictDoUpdate({
      target: schema.jobRuns.name,
      set: { lastFailedAt: now, lastError: error, ...(alertedRecently ? {} : { lastAlertedAt: now }) },
    });
  return { failed, alerted: !alertedRecently };
}

export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;

  const db = getDb();
  const now = new Date();

  const failures = await alarmOnFailures(db, now);

  const { waiting: count, oldestWaitedMs: waitedMs } = await deriveBacklog(db, now);
  const backed = waitedMs > BACKLOG_AFTER_MS;

  const [run] = await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.name, NAME)).limit(1);

  if (!backed) {
    await db
      .insert(schema.jobRuns)
      .values({ name: NAME, lastSucceededAt: now, lastAlertedAt: null })
      .onConflictDoUpdate({ target: schema.jobRuns.name, set: { lastSucceededAt: now, lastAlertedAt: null } });
    return NextResponse.json({ ok: true, waiting: count, oldestWaitedSeconds: Math.round(waitedMs / 1000), failures });
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

  return NextResponse.json({ ok: false, waiting: count, oldestWaitedSeconds: Math.round(waitedMs / 1000), alerted: !alertedRecently, failures });
}
