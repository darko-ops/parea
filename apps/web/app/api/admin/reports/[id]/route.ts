/**
 * Answer a report.
 *
 *   { source: 'photo' | 'content', action: 'decline', note? }   nothing done
 *   { source: 'photo' | 'content', action: 'remove', note? }    taken down
 *
 * Removal goes through the code that already owns each kind of thing — see
 * `removeContent` and `takeDown`.
 */

import { NextResponse } from 'next/server';

import { adminError, adminGuard, declineReport, removeContent } from '@/admin';
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
  const action = body.action === 'decline' || body.action === 'remove' ? body.action : null;
  if (!source || !action) {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  }
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null;

  try {
    if (action === 'remove') {
      const { alreadyGone } = await removeContent(getDb(), staff, { source, id, note });
      return NextResponse.json({ status: 'actioned', alreadyGone });
    }
    await declineReport(getDb(), staff, { source, id, note });
  } catch (err) {
    return adminError(err);
  }
  return NextResponse.json({ status: 'declined' });
}
