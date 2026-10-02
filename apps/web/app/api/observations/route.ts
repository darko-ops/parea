/**
 * The client-side half of §18.
 *
 * Four observations happen on a device and nowhere else: whether a suggestion
 * was shown, how much of it survived, whether the app fell through to the
 * system picker, and photographs saved to the camera roll. The server cannot
 * infer any of them, so the client posts them.
 *
 * The rest of the list is recorded server-side where the thing actually
 * happens, and is not accepted here — an endpoint that let a client assert
 * "someone downloaded this" would make the one metric about delivery
 * unfalsifiable. A camera-roll save is its own kind for that reason.
 */

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { clientOf, observe } from '@/observe';
import { PRESIGN_LIMIT, withinLimit } from '@/ratelimit';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

/**
 * Only the ones a device is the sole witness to. `device_save` is the app
 * saving photographs to the camera roll straight from their image URLs, which
 * no server sees — reported here, and kept a different kind from the
 * server-witnessed `download` so that one stays unfalsifiable.
 */
const CLIENT_REPORTABLE = ['autoselect_shown', 'autoselect_confirmed', 'picker_used', 'device_save'] as const;
const SCOPES = ['all', 'favourites', 'selection', 'one'] as const;

/** Nothing here is worth more than a rough magnitude, and a cap bounds nonsense. */
const MAX_COUNT = 100_000;

export async function POST(request: Request) {
  const db = getDb();

  // An unauthenticated write endpoint, so it shares the presign limiter rather
  // than getting a more generous one of its own. Metrics are not worth a way
  // to fill the table.
  if (!(await withinLimit(db, PRESIGN_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    kind?: unknown;
    eventId?: unknown;
    count?: unknown;
    outOf?: unknown;
    scope?: unknown;
  };

  const kind = CLIENT_REPORTABLE.find((k) => k === body.kind);
  if (!kind) return NextResponse.json({ error: 'unknown_kind' }, { status: 400 });

  await observe(db, {
    kind,
    eventId: typeof body.eventId === 'string' ? body.eventId : null,
    actorId: await currentActorId(),
    client: clientOf(request),
    count: bounded(body.count),
    outOf: bounded(body.outOf),
    scope: kind === 'device_save' ? (SCOPES.find((s) => s === body.scope) ?? null) : null,
  });

  // 204: the client has nothing to do with the answer, and should never wait
  // on one or retry. A lost observation is a rounding error; a client
  // retrying metrics is a bug that shows up as traffic.
  return new NextResponse(null, { status: 204 });
}

function bounded(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value < 0 || value > MAX_COUNT ? null : value;
}
