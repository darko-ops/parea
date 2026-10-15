/**
 * Uploads that did not go through, and why.
 *
 *   ?days=1|7|30                      the period; 7 when absent or anything else
 *   ?person=…                         one person, by handle (with or without @) or actor id
 *
 * See `src/adminUploadFailures.ts`.
 */

import { NextResponse } from 'next/server';

import { adminGuard } from '@/admin';
import {
  UPLOAD_FAILURE_PERIODS,
  uploadFailures,
  type UploadFailurePeriod,
} from '@/adminUploadFailures';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;

  const params = new URL(request.url).searchParams;
  const asked = Number(params.get('days'));
  const days = (UPLOAD_FAILURE_PERIODS as readonly number[]).includes(asked)
    ? (asked as UploadFailurePeriod)
    : 7;
  const person = (params.get('person') ?? '').slice(0, 200) || undefined;
  return NextResponse.json(await uploadFailures(getDb(), { days, person }));
}
