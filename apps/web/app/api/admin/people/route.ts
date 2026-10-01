/**
 * Everybody on Parea.
 *
 *   ?q=…                              search by email, handle, name or id
 *   ?sort=…&filter=…&page=…           the directory, a page at a time
 *   ?stats=1                          totals and thirty days of sign-ups
 */

import { NextResponse } from 'next/server';

import { adminGuard } from '@/admin';
import {
  listPeople,
  PEOPLE_FILTERS,
  PEOPLE_SORTS,
  peopleStats,
  searchPeople,
  type PeopleFilter,
  type PeopleSort,
} from '@/adminPeople';
import { getDb } from '@/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const staff = adminGuard(request);
  if (staff instanceof Response) return staff;

  const params = new URL(request.url).searchParams;
  if (params.get('stats')) return NextResponse.json(await peopleStats(getDb()));

  const q = (params.get('q') ?? '').slice(0, 200);
  if (q.trim()) return NextResponse.json({ people: await searchPeople(getDb(), q) });

  const sort = (PEOPLE_SORTS as readonly string[]).includes(params.get('sort') ?? '')
    ? (params.get('sort') as PeopleSort)
    : 'newest';
  const filter = (PEOPLE_FILTERS as readonly string[]).includes(params.get('filter') ?? '')
    ? (params.get('filter') as PeopleFilter)
    : 'all';
  const page = Number(params.get('page')) || 1;
  return NextResponse.json(await listPeople(getDb(), { sort, filter, page }));
}
