/**
 * Close a report as needing nothing done.
 *
 *   { source: 'photo' | 'content', action: 'decline', note? }
 *
 * Taking things down is not here yet: each kind of thing has its own removal
 * path, and those should be reached through the code that already owns them
 * rather than reimplemented for staff.
 */

import { NextResponse } from 'next/server';

import { adminError, adminGuard, declineReport } from '@/admin';
import { getDb } from '@/db';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const source = body.source === 'photo' || body.source === 'content' ? body.source : null;
  if (!source || body.action !== 'decline') {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null;

  try {
    await declineReport(getDb(), staff, { source, id, note });
  } catch (err) {
    return adminError(err);
  }
  return NextResponse.json({ status: 'declined' });
}
