/**
 * A short-lived link to the flagged photo, for the person reviewing it.
 *
 * POST, not GET: it writes a record of who looked, and a GET that changes
 * something is a GET a prefetcher can make. See `src/adminReveal.ts` for
 * what it refuses to show.
 */

import { NextResponse } from 'next/server';

import { adminError, adminGuard } from '@/admin';
import { revealFlaggedPhoto } from '@/adminReveal';
import { getDb } from '@/db';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;

  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  try {
    return NextResponse.json(await revealFlaggedPhoto(getDb(), staff, id));
  } catch (err) {
    return adminError(err);
  }
}
