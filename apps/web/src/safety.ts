/**
 * Child-safety hash matching for the images the web app stores itself.
 *
 * Roll photographs go through the deriver, which scans before anything is
 * addressable. Four other kinds of image never went near it: a moment, a
 * group's picture, a profile picture and a roll's cover are each re-encoded
 * here and written straight to storage, and none of them was checked against
 * anything. A moment is on everybody's Home. This is the same check, asked of
 * the same provider through the same client (`@parea/core`'s scanner), before
 * any of them is stored.
 *
 * Three rules, the deriver's own:
 *
 * - **No provider, no check — and that is said, not hidden.** `scannerFromEnv`
 *   is null when nothing is configured, and this passes. The deployment's
 *   declared posture and the privacy page both say whether hash matching is
 *   running. Adding the provider's keys to this deployment is all it takes for
 *   every route below to start scanning.
 * - **An outage is not a clean result.** A provider that cannot be reached
 *   refuses the upload (503, try again) rather than letting it through.
 * - **A match decides nothing but this: the image is not stored where anyone
 *   can see it.** The original bytes are kept under `preserved/`, a safety
 *   incident is written, and a person is woken. The uploader gets the same
 *   refusal as for any image that could not be accepted — nothing that says
 *   why, which is the runbook's rule for the roll pipeline too.
 */

import { createHash, randomUUID } from 'node:crypto';

import { alertResponder, scannerFromEnv, ScanUnavailable, schema } from '@parea/core';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { getStorage } from '@/storage';

/** Where an image was going. Stored on the incident as `subject`. */
export type ScreenedSubject =
  | { kind: 'moment' }
  | { kind: 'group_photo'; groupId: string }
  | { kind: 'avatar' }
  | { kind: 'cover'; eventId: string };

/**
 * Checks an image before it is stored. `null` means go ahead; a response means
 * return it and store nothing.
 *
 * `bytes` should be what the uploader sent, before any re-encoding: that is
 * what a provider matches best, and it is what has to be preserved.
 */
export async function screenUpload(
  bytes: Buffer,
  mime: string,
  subject: ScreenedSubject,
  uploaderActorId: string,
): Promise<NextResponse | null> {
  const scanner = scannerFromEnv();
  if (!scanner) return null;

  const contentHash = createHash('sha256').update(bytes).digest();

  let verdict;
  try {
    verdict = await scanner.scan({ bytes, contentHash, mime });
  } catch (err) {
    if (err instanceof ScanUnavailable) {
      console.error(`safety: scan unavailable for a ${subject.kind}:`, err.message);
      return NextResponse.json({ error: 'scan_unavailable' }, { status: 503 });
    }
    throw err;
  }
  if (!verdict.match) return null;

  // Kept under a key nothing ever presigns or serves, so the only copy that
  // matters cannot be overwritten or fetched by the person who sent it.
  const storageKey = `preserved/${subject.kind}/${randomUUID()}`;
  await getStorage().putSmall(storageKey, bytes, mime);

  const subjectId =
    subject.kind === 'group_photo'
      ? subject.groupId
      : subject.kind === 'cover'
        ? subject.eventId
        : null;
  const eventId = subject.kind === 'cover' ? subject.eventId : null;

  const [incident] = await getDb()
    .insert(schema.safetyIncidents)
    .values({
      photoId: null,
      subject: subject.kind,
      subjectId,
      eventId,
      uploaderActorId,
      provider: scanner.name,
      classification: verdict.classification,
      providerReference: verdict.providerReference ?? null,
      storageKey,
      contentHash,
      // Open-ended until someone files: the purge job skips a null hold.
      preservationEndsAt: null,
    })
    .returning({ id: schema.safetyIncidents.id });

  await alertResponder({
    incidentId: incident!.id,
    eventId,
    subject: subject.kind,
    provider: scanner.name,
    classification: verdict.classification,
  });

  return NextResponse.json({ error: 'not_accepted' }, { status: 422 });
}
