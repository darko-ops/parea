/**
 * Record what a person did about an incident — the runbook's steps 4 and 5.
 *
 *   { action: 'file', reference, note? }   reported; starts preservation
 *   { action: 'release', note }            a false match; lifts the hold
 *
 * Filing itself happens outside Parea, with NCMEC or through PhotoDNA. This
 * only writes down that it did.
 */

import { NextResponse } from 'next/server';

import { adminError, adminGuard, fileIncident, releaseIncident } from '@/admin';
import { getDb } from '@/db';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const note = text(body.note, 2000);
  try {
    if (body.action === 'file') {
      const reference = text(body.reference, 200);
      if (!reference) return NextResponse.json({ error: 'reference_required' }, { status: 400 });
      await fileIncident(getDb(), staff, { id, reference, note });
      return NextResponse.json({ state: 'filed' });
    }
    if (body.action === 'release') {
      if (!note) return NextResponse.json({ error: 'note_required' }, { status: 400 });
      await releaseIncident(getDb(), staff, { id, note });
      return NextResponse.json({ state: 'released' });
    }
  } catch (err) {
    return adminError(err);
  }
  return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
}
