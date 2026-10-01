/**
 * One person: what they have done, what was reported about them, what staff
 * did, and whether they are suspended.
 *
 *   GET                                   the detail
 *   POST { action: 'suspend', reason }    signed out everywhere, refused at sign-in
 *   POST { action: 'lift', note }         let back in
 */

import { NextResponse } from 'next/server';

import { adminError, adminGuard } from '@/admin';
import { liftSuspension, personDetail, suspend } from '@/adminPeople';
import { getDb } from '@/db';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  try {
    return NextResponse.json(await personDetail(getDb(), id));
  } catch (err) {
    return adminError(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const text = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, 2000) : null;

  try {
    if (body.action === 'suspend') {
      const reason = text(body.reason);
      if (!reason) return NextResponse.json({ error: 'reason_required' }, { status: 400 });
      await suspend(getDb(), staff, { actorId: id, reason });
      return NextResponse.json({ suspended: true });
    }
    if (body.action === 'lift') {
      const note = text(body.note);
      if (!note) return NextResponse.json({ error: 'note_required' }, { status: 400 });
      await liftSuspension(getDb(), staff, { actorId: id, note });
      return NextResponse.json({ suspended: false });
    }
  } catch (err) {
    return adminError(err);
  }
  return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
}
