/**
 * Parea at a glance, for the hub's overview tab.
 *
 *   ?days=7|90|365                    the period; 90 when absent or anything else
 *
 * See `src/adminPulse.ts`.
 */

import { NextResponse } from 'next/server';

import { adminGuard } from '@/admin';
import { pulse, PULSE_PERIODS, type PulsePeriod } from '@/adminPulse';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;

  const asked = Number(new URL(request.url).searchParams.get('days'));
  const days = (PULSE_PERIODS as readonly number[]).includes(asked) ? (asked as PulsePeriod) : 90;
  return NextResponse.json(await pulse(getDb(), days));
}
