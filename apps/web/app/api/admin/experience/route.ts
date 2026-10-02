/**
 * Whether Parea is working for the people using it — §18's numbers, as totals.
 *
 *   ?days=7|30|90|365                 the period; 30 when absent or anything else
 *
 * See `src/adminExperience.ts` for what each one means.
 */

import { NextResponse } from 'next/server';

import { adminGuard } from '@/admin';
import { experience, EXPERIENCE_PERIODS, type ExperiencePeriod } from '@/adminExperience';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;

  const asked = Number(new URL(request.url).searchParams.get('days'));
  const days = (EXPERIENCE_PERIODS as readonly number[]).includes(asked) ? (asked as ExperiencePeriod) : 30;
  return NextResponse.json(await experience(getDb(), days));
}
