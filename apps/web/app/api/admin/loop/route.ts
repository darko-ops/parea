/**
 * The loop — whether a roll brings people in, and whether they bring the next
 * one — for the hub's Invite loop page.
 *
 *   ?days=90|365                      the period; 90 when absent or anything else
 *
 * See `src/adminLoop.ts` for what each number means.
 */

import { NextResponse } from 'next/server';

import { adminGuard } from '@/admin';
import { loop, LOOP_PERIODS, type LoopPeriod } from '@/adminLoop';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;

  const asked = Number(new URL(request.url).searchParams.get('days'));
  const days = (LOOP_PERIODS as readonly number[]).includes(asked) ? (asked as LoopPeriod) : 90;
  return NextResponse.json(await loop(getDb(), days));
}
