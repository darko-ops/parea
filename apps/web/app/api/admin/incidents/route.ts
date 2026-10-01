/**
 * Child-safety incidents, newest first. Identifiers, hash and classification
 * only — never the image, its storage key, or a link that renders it.
 */

import { NextResponse } from 'next/server';

import { adminGuard, listIncidents } from '@/admin';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;
  return NextResponse.json({ incidents: await listIncidents(getDb()) });
}
