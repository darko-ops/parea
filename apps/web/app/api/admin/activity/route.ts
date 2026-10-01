/** What staff have done through the hub, newest first. */

import { NextResponse } from 'next/server';

import { adminGuard, listStaffActions } from '@/admin';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;
  const limit = Number(new URL(request.url).searchParams.get('limit')) || 100;
  return NextResponse.json({ actions: await listStaffActions(getDb(), limit) });
}
