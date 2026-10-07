/**
 * The safety net under the photo queue — run hourly by Vercel's cron.
 *
 * A photograph is handed to the deriver by one QStash message, sent when its
 * upload is confirmed. If that message is refused (the queue over its quota),
 * lost, or retried out while the deriver was down, the photo is left confirmed
 * and waiting with nothing coming for it: the hourly sweep leaves confirmed
 * uploads alone on purpose, and the backlog alarm stops counting after six
 * hours. This finds those photographs and sends each one again, so any of
 * those failures costs a delay rather than a photo.
 *
 * A resend is harmless if the first message was only slow: the deriver turns
 * away a photo it is already working on, and returns early on one already
 * ready. Recorded in `job_run` as `requeue_stranded`.
 */

import { schema } from '@parea/core';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { strandedPhotos } from '@/deriveBacklog';
import { publishDerive } from '@/queue';

export const runtime = 'nodejs';

const NAME = 'requeue_stranded';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const db = getDb();
  const now = new Date();
  const ids = await strandedPhotos(db, now);

  // One resend key per run, so a photo stranded for several hours is sent
  // once an hour rather than dropped as a duplicate of the last resend.
  const run = now.toISOString().slice(0, 13);
  let sent = 0;
  let refused = 0;
  let lastError: string | null = null;
  for (const id of ids) {
    try {
      if ((await publishDerive(id, run)) === 'published') sent += 1;
    } catch (err) {
      refused += 1;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (sent > 0 || refused > 0) {
    console.warn(`requeue stranded: ${sent} resent, ${refused} refused of ${ids.length}`);
  }

  const outcome =
    refused > 0
      ? { lastFailedAt: now, lastError: `${refused} of ${ids.length} could not be resent: ${lastError}` }
      : { lastSucceededAt: now };
  await db
    .insert(schema.jobRuns)
    .values({ name: NAME, ...outcome })
    .onConflictDoUpdate({ target: schema.jobRuns.name, set: outcome });

  return NextResponse.json({ ok: refused === 0, stranded: ids.length, sent, refused });
}
