/**
 * How Parea grows, and who stays, for the hub's growth & retention tab.
 *
 *   ?days=90|365                      the period; 90 when absent or anything else
 *
 * See `src/adminGrowth.ts`.
 */

import { NextResponse } from 'next/server';

import { adminGuard } from '@/admin';
import { growth, GROWTH_PERIODS, type GrowthPeriod } from '@/adminGrowth';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;

  const asked = Number(new URL(request.url).searchParams.get('days'));
  const days = (GROWTH_PERIODS as readonly number[]).includes(asked) ? (asked as GrowthPeriod) : 90;
  return NextResponse.json(await growth(getDb(), days));
}
