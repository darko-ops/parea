/**
 * Report a moment, a comment, a message, a profile or a group.
 *
 * One route for all of them, because the thing a person does is the same —
 * "this is not OK" — and a client should not need to know six URLs to say it.
 * Photos keep their own route, which also carries removal requests.
 *
 * Needs an identity, not an account: somebody being harassed in a group chat
 * they were added to may never have signed in.
 */

import { NextResponse } from 'next/server';

import {
  fileReport,
  isReportKind,
  isTargetKind,
  resolveTarget,
} from '@/contentReports';
import { getDb } from '@/db';
import { REPORT_LIMIT, withinLimit, withinLimitFor } from '@/ratelimit';
import { currentActorId } from '@/session';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const reporter = await currentActorId();
  if (!reporter) return NextResponse.json({ error: 'sign_in_required' }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    targetKind?: unknown;
    targetId?: unknown;
    kind?: unknown;
    note?: unknown;
  };
  if (!isTargetKind(body.targetKind) || typeof body.targetId !== 'string' || !UUID.test(body.targetId)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const kind = isReportKind(body.kind) ? body.kind : 'abuse';
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : null;

  const db = getDb();
  const secret = process.env.SESSION_SECRET;
  if (
    !(await withinLimit(db, REPORT_LIMIT, secret)) ||
    !(await withinLimitFor(db, REPORT_LIMIT, secret, reporter))
  ) {
    return NextResponse.json({ error: 'too_many_requests' }, { status: 429 });
  }

  const target = await resolveTarget(db, body.targetKind, body.targetId, reporter);
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (target.subject === reporter) {
    return NextResponse.json({ error: 'own_content' }, { status: 400 });
  }

  await fileReport(db, {
    targetKind: body.targetKind,
    targetId: body.targetId,
    subject: target.subject,
    reporter,
    kind,
    note,
  });
  return NextResponse.json({ reported: true });
}
