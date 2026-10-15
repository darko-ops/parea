/**
 * An upload queue saying what went wrong — see `src/uploadFailures.ts`.
 *
 * Always 204 to a signed-in caller, recorded or not: the client sends these
 * and forgets them, and nothing it could do with a refusal would help.
 */

import { schema } from '@parea/core';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { UPLOAD_FAILURE_LIMIT, withinLimit } from '@/ratelimit';
import { currentActorId } from '@/session';
import { parseReports } from '@/uploadFailures';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const actorId = await currentActorId();
  if (!actorId) return NextResponse.json({ error: 'no_actor' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const rows = parseReports(body, actorId, request.headers.get('user-agent'));
  if (rows.length === 0) return new NextResponse(null, { status: 204 });

  const db = getDb();
  if (!(await withinLimit(db, UPLOAD_FAILURE_LIMIT, process.env.SESSION_SECRET))) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    await db.insert(schema.uploadFailures).values(rows);
  } catch (err) {
    console.error(`could not record upload failures: ${err}`);
  }
  return new NextResponse(null, { status: 204 });
}
