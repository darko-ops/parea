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
  decodeCapabilities,
} from './derivatives';
import { HEVC_HEIC_SAMPLE } from './fixture';
import { objectStoreFromEnv } from './objects';
import { pendingPhotoIds, processPhoto } from './pipeline';

const run = promisify(execFile);
const POLL_INTERVAL_MS = Number(process.env.DERIVER_POLL_MS ?? 5000);

function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return drizzle(postgres(url, { prepare: false }), { schema });
}

async function probe(): Promise<number> {
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

  const heicOk = viaSharp || viaLibheif;
  const width = Math.max(...results.map(([n]) => n.length));
  for (const [name, ok, note] of results) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(width)}  ${note}`);
  }

  const fatal = !heicOk || !exiftoolVersion;
  console.log(
    fatal
      ? '\nThis container cannot ingest photos. See services/deriver/README.md.'
      : '\nReady to ingest.',
  );
  return fatal ? 1 : 0;
}

async function drain(limit: number): Promise<number> {
  const database = db();
  const objects = objectStoreFromEnv();
  const ids = await pendingPhotoIds(database, limit);

  let handled = 0;
  for (const id of ids) {
    const outcome = await processPhoto({ db: database, objects }, id);
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

  if (command === 'probe') {
    process.exit(await probe());
  }

  if (command === 'once') {
    const handled = await drain(500);
    console.log(`${handled} photo(s) processed`);
    process.exit(0);
  }

  if (command === 'watch') {
    // Refuse to start rather than fail one photo at a time.
    if ((await probe()) !== 0) process.exit(1);
    console.log(`watching, every ${POLL_INTERVAL_MS}ms`);
    for (;;) {
      try {
        await drain(50);
      } catch (err) {
        console.error('drain failed:', err);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  console.error(`unknown command: ${command}`);
  console.error('usage: deriver <probe|once|watch>');
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
