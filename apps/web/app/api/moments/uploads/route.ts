/**
 * Somewhere to put a moment's original: a presigned PUT, straight to storage.
 *
 * The picture does not come through this origin because it cannot — the
 * platform refuses a request body over about 4.5MB, and a photograph off a
 * current phone is larger. So the bytes go phone → storage like a roll's
 * photographs do, and `/api/moments` is then handed the key.
 *
 * The size is signed into the URL (see `presignPut`), so what is declared here
 * is what can be uploaded, and the ceiling is checked before anything is
 * signed at all.
 */

import { randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { MOMENT_MAX_BYTES, incomingPrefix } from '@/moments';
import { MOMENT_LIMIT, withinLimit } from '@/ratelimit';
import { currentActorId } from '@/session';
import { getStorage } from '@/storage';

export const runtime = 'nodejs';

/** What the PUT may say it is. Anything else is signed as opaque bytes. */
const TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/avif']);

export async function POST(request: Request) {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    byteSize?: unknown;
    contentType?: unknown;
  };
  const byteSize = body.byteSize;
  if (typeof byteSize !== 'number' || !Number.isInteger(byteSize) || byteSize <= 0) {
    return NextResponse.json({ error: 'bad_size' }, { status: 400 });
  }
  if (byteSize > MOMENT_MAX_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413 });
  }

  if (!(await withinLimit(getDb(), MOMENT_LIMIT, process.env.SESSION_SECRET))) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const contentType =
    typeof body.contentType === 'string' && TYPES.has(body.contentType)
      ? body.contentType
      : 'application/octet-stream';
  const key = `${incomingPrefix(actorId)}${randomUUID()}`;
  const upload = await getStorage().presignPut(key, contentType, byteSize);

  return NextResponse.json({ key, url: upload.url, headers: upload.headers });
}
