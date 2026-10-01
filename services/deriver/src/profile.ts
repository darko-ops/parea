/**
 * Where the time goes in processing one photo — measured, not guessed.
 *
 * A photo takes about ten seconds end to end in production, and the deriver
 * takes one at a time, so that number is the wait between somebody adding a
 * batch and seeing it. This re-runs every step `processPhoto` takes, against
 * photographs that are already processed, timing each one: the download, the
 * metadata strip and its two checks, the hash, the reads, every size and
 * format, and the uploads.
 *
 * It changes nothing. It never touches the photo's row or its objects; the
 * uploads it times go to `tmp/profile/` and are deleted straight after.
 */

import { schema } from '@parea/core';
import { formatsFor, type ImageKind } from '@parea/urls';
import { desc, eq, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildDerivatives, DERIVATIVES, readDimensions } from './derivatives';
import { stripAndVerify } from './metadata';
import type { ObjectStore } from './objects';

export type Timings = Record<string, number>;

async function timed<T>(timings: Timings, step: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    timings[step] = (timings[step] ?? 0) + (performance.now() - start);
  }
}

/** Every step of processing one stored photo, timed, with nothing kept. */
export async function profilePhoto(
  { db, objects }: { db: any; objects: ObjectStore },
  photoId: string,
): Promise<{ timings: Timings; bytes: number; pixels: number | null }> {
  const t: Timings = {};
  const total = performance.now();

  const rows: { storageKey: string; mime: string | null }[] = await timed(t, 'db_read', () =>
    db.select().from(schema.photos).where(eq(schema.photos.id, photoId)).limit(1),
  );
  const photo = rows[0]!;
  const original = await timed(t, 'download', () => objects.get(photo.storageKey));
  if (!original) throw new Error(`no object for ${photoId}`);

  const dir = await mkdtemp(join(tmpdir(), 'profile-'));
  const scratch: string[] = [];
  try {
    const working = join(dir, 'original');
    await timed(t, 'write_temp', () => writeFile(working, original));
    await timed(t, 'strip_and_verify', () => stripAndVerify(working));
    const stripped = await timed(t, 'read_back', () => readFile(working));
    await timed(t, 'sha256', async () => createHash('sha256').update(stripped).digest());
    await timed(t, 'db_dedupe_query', () =>
      db.execute(sql`select id from "photo" where content_hash = ${Buffer.alloc(32)} limit 1`),
    );
    const dims = await timed(t, 'read_dimensions', () => readDimensions(stripped));

    // As processing now does it: the original uploading while the sizes are
    // made. `derive_all` alone is timed separately below for comparison.
    const base = `tmp/profile/${randomUUID()}`;
    const [, all] = await timed(t, 'derive+upload_original', () =>
      Promise.all([
        (async () => {
          scratch.push(`${base}/original`);
          await objects.put(`${base}/original`, stripped, photo.mime ?? 'image/jpeg');
        })(),
        buildDerivatives(stripped),
      ]),
    );

    // Each size on its own, to see which ones the total is made of. These
    // re-decode per size, so they add up to more than `derive_all`, which
    // shares one decode between them.
    await timed(t, 'derive_all_alone', () => buildDerivatives(stripped));
    for (const spec of DERIVATIVES) {
      await timed(t, `size_${spec.kind}(${formatsFor(spec.kind as ImageKind).join('+')})`, () =>
        buildDerivatives(stripped, [spec.kind]),
      );
    }

    await timed(t, 'upload_sizes_parallel', () =>
      Promise.all(
        all.map((d, i) => {
          const key = `${base}/${i}`;
          scratch.push(key);
          return objects.put(key, d.bytes, d.mime);
        }),
      ),
    );
    await timed(t, 'db_roundtrip', () => db.execute(sql`select 1`));

    // Without the comparison-only steps, so `total` is what processing costs.
    t.total =
      performance.now() -
      total -
      Object.entries(t)
        .filter(([k]) => k.startsWith('size_') || k === 'derive_all_alone')
        .reduce((sum, [, ms]) => sum + ms, 0);
    const pixels = dims.width && dims.height ? dims.width * dims.height : null;
    return { timings: t, bytes: original.length, pixels };
  } finally {
    await Promise.all(scratch.map((key) => objects.delete(key).catch(() => {})));
    await rm(dir, { recursive: true, force: true });
  }
}

/** The most recently processed photos, for `profile`. */
export async function recentReadyPhotos(db: any, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(eq(schema.photos.status, 'ready'))
    .orderBy(desc(schema.photos.uploadedAt))
    .limit(limit);
  return rows.map((r: { id: string }) => r.id);
}

/** A table of averages across runs, slowest step first. */
export function summarise(runs: Timings[]): string {
  const steps = new Map<string, number[]>();
  for (const run of runs) {
    for (const [step, ms] of Object.entries(run)) {
      const list = steps.get(step) ?? [];
      list.push(ms);
      steps.set(step, list);
    }
  }
  const total = steps.get('total') ?? [0];
  const avgTotal = total.reduce((a, b) => a + b, 0) / total.length;
  return [...steps.entries()]
    .map(([step, list]) => [step, list.reduce((a, b) => a + b, 0) / list.length] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([step, ms]) => {
      const share = step === 'total' || step.startsWith('size_') || step === 'derive_all_alone' ? '' : `${Math.round((ms / avgTotal) * 100)}%`;
      return `${step.padEnd(34)} ${Math.round(ms).toString().padStart(6)} ms  ${share}`;
    })
    .join('\n');
}
