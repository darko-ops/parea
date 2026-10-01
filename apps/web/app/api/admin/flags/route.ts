/** Open classifier flags, most confident first. Never the photo — see `reveal`. */

import { NextResponse } from 'next/server';

import { adminGuard, listFlags } from '@/admin';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;
  return NextResponse.json({ flags: await listFlags(getDb()) });
}
