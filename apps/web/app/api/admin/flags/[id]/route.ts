/**
 * Answer a classifier flag.
 *
 *   { action: 'clear', note? }      fine; nothing changes
 *   { action: 'remove', note? }     taken down, as a reported photo would be
 *   { action: 'escalate', note? }   looks like a child: quarantined, incident opened
 *
 * See `answerFlag`.
 */

import { NextResponse } from 'next/server';

import { adminError, adminGuard, answerFlag } from '@/admin';
import { getDb } from '@/db';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['clear', 'remove', 'escalate']);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.action !== 'string' || !ACTIONS.has(body.action)) {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  }
  const action = body.action as 'clear' | 'remove' | 'escalate';
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null;

  try {
    const result = await answerFlag(getDb(), staff, { id, action, note });
    return NextResponse.json({ answered: action, ...result });
  } catch (err) {
    return adminError(err);
  }
}
