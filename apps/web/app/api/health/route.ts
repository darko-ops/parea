/**
 * Is this deployment actually working?
 *
 * Reports whether the database answers and whether configuration is complete.
 * Names and booleans only — never values — so it is safe to leave unauthenticated,
 * which it has to be for a load balancer to use it.
 *
 * Returns 503 when something required is missing, so a bad deploy fails its
 * health check instead of serving a subtly broken product: photos landing on
 * container disk, or downloads 404ing because two secrets disagree.
 */

import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { getDb } from '@/db';
import { describeConfig, missingInProduction } from '@/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let database = false;
  let databaseError: string | null = null;
  try {
    await getDb().execute(sql`select 1`);
    database = true;
  } catch (err) {
    databaseError = err instanceof Error ? err.message.slice(0, 120) : 'unknown';
  }

  const missing = missingInProduction();
  const healthy = database && missing.length === 0;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      database,
      databaseError,
      missing: missing.map((c) => ({ name: c.name, consequence: c.consequence })),
      config: describeConfig().map((c) => ({ name: c.name, present: c.present })),
    },
    { status: healthy ? 200 : 503 },
  );
}
