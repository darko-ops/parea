/** Find people by id, email, handle or name. See `searchPeople`. */

import { NextResponse } from 'next/server';

import { adminGuard } from '@/admin';
import { searchPeople } from '@/adminPeople';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;
  const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 200);
  return NextResponse.json({ people: await searchPeople(getDb(), q) });
}
