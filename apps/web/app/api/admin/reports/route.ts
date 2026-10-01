/**
 * Open reports that come to Parea rather than to a host: abuse and other
 * reports on photos, and every report on words, profiles and groups.
 */

import { NextResponse } from 'next/server';

import { adminGuard, listReports } from '@/admin';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;
  return NextResponse.json(await listReports(getDb()));
}
