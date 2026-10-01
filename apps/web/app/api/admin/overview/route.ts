/**
 * The hub's front page: how much is waiting, and how close the nearest
 * child-safety deadline is. See `src/admin.ts` for who may ask.
 */

import { NextResponse } from 'next/server';

import { adminGuard, overview } from '@/admin';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;
  return NextResponse.json(await overview(getDb()));
}
