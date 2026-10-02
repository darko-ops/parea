/**
 * How people respond to what is in Parea — reactions, comments and
 * favourites — as totals.
 *
 *   ?days=7|30|90|365                 the period; 30 when absent or anything else
 *
 * See `src/adminEngagement.ts` for what each one means.
 */

import { NextResponse } from 'next/server';

import { adminGuard } from '@/admin';
import { engagement, ENGAGEMENT_PERIODS, type EngagementPeriod } from '@/adminEngagement';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;

  const asked = Number(new URL(request.url).searchParams.get('days'));
  const days = (ENGAGEMENT_PERIODS as readonly number[]).includes(asked) ? (asked as EngagementPeriod) : 30;
  return NextResponse.json(await engagement(getDb(), days));
}
