#!/usr/bin/env tsx
/**
 * Deriver entrypoint.
 *
 * Four commands:
 *   probe   verify this container can actually do the job, and exit non-zero
 *           if it cannot
 *   once    drain the pending queue and stop
 *   watch   poll for pending photos forever
 *   serve   listen for deliveries and derive what they name, which is the
 *           same work without the asking — see `serve.ts`
 *   backfill <kind>
 *           encode one derivative size for photographs that predate it, and
 *           stop. Needed once per size added after the product had events in
 *           it — `card` is the first. Safe to run repeatedly and safe to stop
 *           part-way: it selects on the absence of the row it writes.
 *
 * `watch` polls Postgres rather than consuming a Cloudflare Queue. The design
 * (§7.5) has R2 event notifications driving a queue, which is better: it
 * reacts immediately and does not scan. Polling is a deliberate placeholder —
 * it needs no Cloudflare account, so ingest works in development and the
 * queue becomes a change to how work arrives rather than a change to the
 * pipeline.
 */

import { schema } from '@parea/core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import postgres from 'postgres';

import { createJobServer, JOB_PATH, receiverFromEnv } from './http';
import { createHandler, DEFAULT_CONCURRENCY } from './serve';
import {
  canDecode,
  canDecodeViaHeifConvert,
  canEncodeAvif,
  decodeCapabilities,
  DERIVATIVES,
  type DerivativeKind,
} from './derivatives';
import { HEVC_HEIC_SAMPLE } from './fixture';
import { objectStoreFromEnv } from './objects';
import {
  contentModeratorFromEnv,
  postureFromEnv,
  type ContentModerator,
} from './moderation';
import { type CsamScanner, scannerFromEnv } from './safety';
import {
  backfillDerivative,
  pendingPhotoIds,
  photosMissingDerivative,
  processPhoto,
} from './pipeline';

const run = promisify(execFile);
const POLL_INTERVAL_MS = Number(process.env.DERIVER_POLL_MS ?? 5000);

/**
 * The production database endpoint. See `apps/web/src/db.ts`, which carries
 * the same constant and the same warning for the same reason.
 *
 * This process is the one that caused the incident: it polls every five
 * seconds and holds its connection between polls, so pointed at production it
 * is a permanent connection. Neon only suspends a compute once nothing is
 * connected, which turns an idle laptop into continuous billed uptime — eight
 * days of it drained the month's 100 CU-hours and took sign-in down.
 *
 * Deliberately not shared with the web app through a package. A copied
 * constant is a thing that can drift; an import here would make a worker that
 * runs in its own container depend on the Next.js app to start.
 */
const PRODUCTION_DB_HOST = 'ep-flat-heart-ax915wla';

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  // Warned, not refused: deriving against production is a real thing to need
  // on purpose. What must not happen is doing it without noticing.
  if (url.includes(PRODUCTION_DB_HOST) && !process.env.DERIVER_ALLOW_PRODUCTION) {
    console.warn(
      `\n  *** The deriver is polling the PRODUCTION database (${PRODUCTION_DB_HOST}) every ` +
        `${POLL_INTERVAL_MS}ms.\n` +
        '  *** It holds the connection between polls, so Neon will never suspend and the\n' +
        '  *** project\'s compute quota drains for as long as this runs. Point DATABASE_URL\n' +
        '  *** at the development project, or set DERIVER_ALLOW_PRODUCTION=1 to say you meant it.\n',
    );
  }
  return drizzle(postgres(url, { prepare: false }), { schema });
}

/**
 * Whether the object store answers, without letting its absence throw.
 *
 * `objectStoreFromEnv` refuses to build a local store in production, which is
 * the right behaviour everywhere except inside a check whose whole job is to
 * report rather than crash — an unconfigured production deployment should read
 * `FAIL storage` alongside everything else, not vanish in a stack trace before
 * the table is printed.
 */
async function storeReachable(): Promise<{ ok: boolean; detail: string }> {
  try {
    return await objectStoreFromEnv().reachable();
  } catch (err) {
    return {
      ok: false,
      detail: `FAILED — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function probe(
  scanner: CsamScanner | null,
  moderator: ContentModerator | null,
): Promise<number> {
  const results: [string, boolean, string][] = [];

  let exiftoolVersion = '';
  try {
    exiftoolVersion = (await run('exiftool', ['-ver'])).stdout.trim();
    results.push(['exiftool', true, exiftoolVersion]);
  } catch {
    results.push(['exiftool', false, 'not found — metadata cannot be stripped']);
  }

  const formats = await decodeCapabilities();
  for (const [name, ok] of Object.entries(formats)) {
    results.push([`sharp:${name}`, ok, ok ? 'reported' : 'unsupported']);
  }

  // The one that matters. Every iPhone photo is HEVC-coded HEIC, and sharp's
  // prebuilt libvips parses the HEIF container without being able to decode
  // it — `metadata()` happily reports `heif, 4032x3024` and then rasterising
  // fails. So this decodes real HEVC bytes rather than asking sharp's opinion.
  const viaSharp = await canDecode(HEVC_HEIC_SAMPLE);
  results.push([
    'decode:hevc/sharp',
    viaSharp,
    viaSharp ? 'decoded directly' : 'no HEVC decoder — fallback required',
  ]);

  // The expected working path on a stock sharp build.
  const viaLibheif = viaSharp || (await canDecodeViaHeifConvert(HEVC_HEIC_SAMPLE));
  results.push([
    'decode:hevc/libheif',
    viaLibheif,
    viaLibheif
      ? 'heif-convert available'
      : 'FAILED — apt install libheif-examples libheif-plugin-libde265',
  ]);

  // Same failure shape as HEVC, in the other direction: libvips aliases avif
  // onto its heif support, so `sharp.format` says yes for a build with no AV1
  // encoder. Every thumbnail would fail at ingest, so encode real pixels.
  const avifOk = await canEncodeAvif();
  results.push([
    'encode:avif',
    avifOk,
    avifOk ? 'encoded' : 'FAILED — no AV1 encoder; every derivative will fail',
  ]);

  // Two separate slots, and neither substitutes for the other. Hash matching
  // finds catalogued child sexual abuse material; a classifier gives an
  // opinion about explicit content. A deployment may legitimately have one,
  // both or neither — what it may not have is no stated position.
  results.push([
    'csam-scanner',
    scanner !== null,
    scanner ? scanner.name : 'absent — no hash matching (see posture below)',
  ]);
  results.push([
    'content-moderator',
    moderator !== null,
    moderator ? moderator.name : 'absent — nothing is classified automatically',
  ]);

  const posture = postureFromEnv();
  results.push(['moderation', posture.ok, posture.detail]);

  /*
   * Storage, which this probe did not check for far too long.
   *
   * Every other line here verifies that the container can *process* a
   * photograph. None of them verified it could reach the one place every
   * photograph comes from and goes to — so a deployment whose R2 credentials
   * were wrong passed this probe, printed "Ready to ingest", answered its Fly
   * health check, and failed on the first upload with the row left `pending`
   * and nobody told.
   *
   * That is not hypothetical: both secrets were once set to a three-byte
   * ellipsis pasted out of an example, and nothing in the stack said a word.
   * The health check in `fly.toml` is liveness-only on purpose — a readiness
   * check that opened a connection would be the poll loop this service was
   * rebuilt to avoid — so boot is the right place, and this is the file that
   * already argues a deriver which starts is one that can do the job.
   *
   * Fatal in production only, for the same reason the safety alerts are: the
   * image build runs this probe with no deployment environment, where the
   * store is a local directory and the answer means nothing.
   */
  const storage = await storeReachable();
  const storageRequired = process.env.NODE_ENV === 'production';
  results.push([
    'storage',
    storage.ok || !storageRequired,
    storageRequired || storage.ok
      ? storage.detail
      : `${storage.detail} (not required outside production)`,
  ]);

  // Checked here rather than discovered at the incident. Something can always
  // quarantine — a child-safety report does it with no scanner configured at
  // all — and a quarantine nobody is told about is the runbook's own
  // definition of no scanning at all. Fatal in production only, because the
  // image build runs this probe with no deployment environment.
  const alertsGoSomewhere = Boolean(
    process.env.SAFETY_ALERT_WEBHOOK || process.env.SAFETY_ALERT_EMAIL,
  );
  const alertsRequired = process.env.NODE_ENV === 'production';
  results.push([
    'safety-alerts',
    alertsGoSomewhere || !alertsRequired,
    alertsGoSomewhere
      ? [
          process.env.SAFETY_ALERT_WEBHOOK && 'webhook',
          process.env.SAFETY_ALERT_EMAIL && 'email',
        ]
          .filter(Boolean)
          .join(' + ')
      : alertsRequired
        ? 'FAILED — nothing receives a quarantine alert; set SAFETY_ALERT_EMAIL or SAFETY_ALERT_WEBHOOK'
        : 'unset (not required outside production)',
  ]);

  const heicOk = viaSharp || viaLibheif;
  const width = Math.max(...results.map(([n]) => n.length));
  for (const [name, ok, note] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(width)}  ${note}`);
  }

  // A missing scanner is no longer fatal; an undeclared posture is. The
  // difference is between a deployment that has decided how content is
  // reviewed and one that has not thought about it.
  const fatal =
    !heicOk ||
    !avifOk ||
    !exiftoolVersion ||
    !posture.ok ||
    (alertsRequired && !alertsGoSomewhere) ||
    (storageRequired && !storage.ok);
  console.log(
    fatal
      ? '\nThis container cannot ingest photos. See services/deriver/README.md.'
      : '\nReady to ingest.',
  );
  return fatal ? 1 : 0;
}

/** Everything a drain needs, built once by the caller. */
type Ingest = Parameters<typeof processPhoto>[0];

async function drain(limit: number, ingest: Ingest): Promise<number> {
  const ids = await pendingPhotoIds(ingest.db, limit);

  let handled = 0;
  for (const id of ids) {
    const outcome = await processPhoto(ingest, id);
    handled++;
    if (outcome.status === 'failed') {
      console.error(`fail  ${id}  ${outcome.reason}`);
    } else {
      console.log(`${outcome.status.padEnd(5)} ${id}`);
    }
  }
  return handled;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'once';

  // Built once per process and threaded through, rather than rebuilt where
  // they are used. `drain` constructed all three itself, and under `watch`
  // that meant new ones every poll:
  //
  //   - `db()` returns a *new* postgres.js client with its own pool, and
  //     nothing ever closed it. One leaked connection every five seconds,
  //     until Neon answered "remaining connection slots are reserved for
  //     roles with the SUPERUSER attribute" and ingest stopped entirely.
  //     Observed in production about fifteen minutes after the first deploy.
  //   - the scanner announced itself from its constructor, so the unscanned
  //     banner printed every five seconds instead of once at boot —
  //     roughly 120,000 lines a day, and a warning that scrolls past
  //     continuously is one nobody reads.
  //
  // Both reviewers come first because `probe` needs them and nothing else,
  // and the Dockerfile runs `probe` at build time with no database or R2 in
  // the environment. Building the rest eagerly here would fail that build.
  const scanner = scannerFromEnv();
  const moderator = contentModeratorFromEnv();

  if (command === 'probe') {
    process.exit(await probe(scanner, moderator));
  }

  if (
    command !== 'once' &&
    command !== 'watch' &&
    command !== 'serve' &&
    command !== 'backfill'
  ) {
    console.error(`unknown command: ${command}`);
    console.error('usage: deriver <probe|once|watch|backfill <kind>>');
    process.exit(2);
  }

  const ingest = (): Ingest => ({
    db: db(),
    objects: objectStoreFromEnv(),
    scanner,
    moderator,
  });

  if (command === 'once') {
    const handled = await drain(500, ingest());
    console.log(`${handled} photo(s) processed`);
    process.exit(0);
  }

  /*
   * Work arriving rather than being looked for.
   *
   * `watch` asks the database every five seconds whether anything is pending,
   * and the asking is the cost: an open connection is a compute that never
   * suspends, which is how forty days of an idle worker exhausted a month of
   * Neon and took sign-in with it. This listens instead, and between
   * deliveries the process does nothing and the machine can stop.
   */
  if (command === 'serve') {
    const receiver = receiverFromEnv();
    if (!receiver) {
      // Refusing to start rather than listening unauthenticated. This endpoint
      // does real work on request; an unsigned one is somebody else deciding
      // what this machine spends its time on.
      console.error(
        'QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY are required to serve',
      );
      process.exit(2);
    }

    const publicUrl = process.env.DERIVER_PUBLIC_URL;
    if (!publicUrl) {
      // QStash signs the destination into the token, so verification compares
      // against the URL the sender used. Behind Fly's proxy that cannot be
      // rebuilt from the request, and guessing it wrong rejects every real
      // delivery — better to say so at boot than once an hour in the logs.
      console.error('DERIVER_PUBLIC_URL is required to serve (it is signed into every delivery)');
      process.exit(2);
    }

    const concurrency = Number(process.env.DERIVER_CONCURRENCY ?? DEFAULT_CONCURRENCY);
    const port = Number(process.env.PORT ?? 8080);
    const server = createJobServer({
      handle: createHandler(ingest(), { concurrency }),
      receiver,
      publicUrl,
    });

    /*
     * Finish what is in flight before going.
     *
     * Fly sends SIGTERM when it stops a machine, and a delivery is only
     * answered once its photo is derived — so closing the listener and letting
     * open requests drain is what turns a stop into "that one finished" rather
     * than "that one is retried in twelve seconds". `close` stops accepting
     * and waits.
     */
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.on(signal, () => {
        console.log(`${signal}: no longer accepting, finishing what is in flight`);
        server.close(() => process.exit(0));
      });
    }

    server.listen(port, () => {
      console.log(`serving ${JOB_PATH} on :${port}, ${concurrency} at a time`);
    });
    return;
  }

  if (command === 'backfill') {
    const kind = process.argv[3] as DerivativeKind | undefined;
    if (!kind || !DERIVATIVES.some((d) => d.kind === kind)) {
      console.error(`usage: deriver backfill <${DERIVATIVES.map((d) => d.kind).join('|')}>`);
      process.exit(2);
    }

    const deps = ingest();
    let done = 0;
    let failed = 0;
    /*
     * In batches, because the selection is "photographs without this row" and
     * each pass writes exactly those rows — so the same query run again
     * returns what is left. Stopping half way is a smaller backfill, never a
     * broken one.
     */
    for (;;) {
      const ids = await photosMissingDerivative(deps.db, kind, 50);
      if (ids.length === 0) break;
      for (const id of ids) {
        const result = await backfillDerivative(deps, id, kind);
        if (result === 'done') done += 1;
        else if (result === 'failed') failed += 1;
      }
      console.log(`${done} encoded, ${failed} failed`);
    }
    console.log(`backfill of ${kind} finished: ${done} encoded, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }

  // Refuse to start rather than fail one photo at a time.
  if ((await probe(scanner, moderator)) !== 0) process.exit(1);
  const deps = ingest();
  console.log(`watching, every ${POLL_INTERVAL_MS}ms`);
  for (;;) {
    try {
      await drain(50, deps);
    } catch (err) {
      console.error('drain failed:', err);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
