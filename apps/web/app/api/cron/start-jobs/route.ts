/**
 * What starts the hourly clean-up: Vercel's scheduler, through Fly's API.
 *
 * The clean-up is one stopped machine on Fly (`parea-jobs`) that runs
 * `services/deriver/src/jobs.ts` and stops again. It used to be started by
 * Fly's own `schedule: hourly`, and on 27 October that skipped three hours in
 * a row without a word: no boot, no log line, one "crash" event with exit code
 * 0 a quarter of a second after "starting". The job had nothing to report
 * because it never ran, and the heartbeat noticed three hours later.
 *
 * Started from here instead, a start Fly refuses is an answer this route gets
 * and says: an error in Sentry within the hour, rather than silence until the
 * heartbeat's three hours are up. The heartbeat stays as the net under both.
 *
 * At :00 with the other crons, so the database is woken once an hour for all
 * of them rather than again at :09 for this one — see vercel.json.
 *
 * A machine still running is left alone: Fly would refuse the start, and a run
 * that has taken an hour is the heartbeat's business, not a reason to page.
 *
 * `FLY_JOBS_TOKEN` is a deploy token scoped to `parea-jobs` alone
 * (`fly tokens create deploy -a parea-jobs`), so this can start, stop and
 * reconfigure that one app's machines and nothing else on the account.
 */

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

import { cronGuard } from '@/cron';

export const runtime = 'nodejs';

const FLY_JOBS_APP = 'parea-jobs';
/** `polished-cloud-4659`, the one scheduled machine — see fly.jobs.toml. */
const FLY_JOBS_MACHINE = '80e903db077048';

const MACHINE_URL = `https://api.machines.dev/v1/apps/${FLY_JOBS_APP}/machines/${FLY_JOBS_MACHINE}`;

/** States in which the machine is already doing, or about to do, the run. */
const BUSY = new Set(['started', 'starting', 'replacing', 'updating']);

/**
 * The header Fly expects for this token.
 *
 * `fly tokens create` prints a macaroon that begins `FlyV1 `, and that is the
 * whole of the header value; an older personal token is a plain bearer.
 */
function authorization(token: string): string {
  return token.startsWith('FlyV1 ') ? token : `Bearer ${token}`;
}

async function refused(headline: string, detail: string) {
  Sentry.captureMessage(headline, { level: 'error', tags: { kind: 'jobs_start' }, extra: { detail } });
  await Sentry.flush(2000).catch(() => false);
  console.error(`start-jobs: ${headline}: ${detail}`);
}

export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;

  const token = process.env.FLY_JOBS_TOKEN;
  if (!token) {
    await refused('The hourly clean-up was not started', 'FLY_JOBS_TOKEN is not set');
    return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 });
  }
  const headers = { authorization: authorization(token) };

  try {
    const machine = await fetch(MACHINE_URL, { headers, cache: 'no-store' });
    if (!machine.ok) {
      const body = (await machine.text()).slice(0, 300);
      await refused('The hourly clean-up was not started', `reading the machine: ${machine.status} ${body}`);
      return NextResponse.json({ ok: false, status: machine.status }, { status: 502 });
    }
    const { state } = (await machine.json()) as { state?: string };
    if (state && BUSY.has(state)) {
      return NextResponse.json({ ok: true, started: false, state });
    }

    const start = await fetch(`${MACHINE_URL}/start`, { method: 'POST', headers, cache: 'no-store' });
    if (!start.ok) {
      const body = (await start.text()).slice(0, 300);
      await refused('The hourly clean-up was not started', `starting it: ${start.status} ${body}`);
      return NextResponse.json({ ok: false, status: start.status }, { status: 502 });
    }
    return NextResponse.json({ ok: true, started: true, previous: state ?? null });
  } catch (err) {
    // Fly's API did not answer at all.
    const detail = err instanceof Error ? err.message : String(err);
    await refused('The hourly clean-up was not started', `Fly's API did not answer: ${detail}`);
    return NextResponse.json({ ok: false, error: 'unreachable' }, { status: 502 });
  }
}
