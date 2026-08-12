#!/usr/bin/env tsx
/**
 * Deriver entrypoint.
 *
 * Three commands:
 *   probe   verify this container can actually do the job, and exit non-zero
 *           if it cannot
 *   once    drain the pending queue and stop
 *   watch   poll for pending photos forever
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

import {
  canDecode,
  canDecodeViaHeifConvert,
  canEncodeAvif,
  decodeCapabilities,
} from './derivatives';
import { HEVC_HEIC_SAMPLE } from './fixture';
import { objectStoreFromEnv } from './objects';
import {
  contentModeratorFromEnv,
  postureFromEnv,
  type ContentModerator,
} from './moderation';
import { type CsamScanner, scannerFromEnv } from './safety';
import { pendingPhotoIds, processPhoto } from './pipeline';

const run = promisify(execFile);
const POLL_INTERVAL_MS = Number(process.env.DERIVER_POLL_MS ?? 5000);

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle(postgres(url, { prepare: false }), { schema });
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

  const heicOk = viaSharp || viaLibheif;
  const width = Math.max(...results.map(([n]) => n.length));
  for (const [name, ok, note] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(width)}  ${note}`);
  }

  // A missing scanner is no longer fatal; an undeclared posture is. The
  // difference is between a deployment that has decided how content is
  // reviewed and one that has not thought about it.
  const fatal = !heicOk || !avifOk || !exiftoolVersion || !posture.ok;
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

  if (command !== 'once' && command !== 'watch') {
    console.error(`unknown command: ${command}`);
    console.error('usage: deriver <probe|once|watch>');
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
