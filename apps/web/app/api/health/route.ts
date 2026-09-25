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
  try {
    await getDb().execute(sql`select 1`);
    database = true;
  } catch (err) {
    /*
     * Logged, not returned.
     *
     * This used to put 120 characters of driver output in the response, which
     * for postgres.js is typically the host and port it failed to reach — so
     * an endpoint whose own header promises "names and booleans only, never
     * values" was publishing the database endpoint to anybody who asked. The
     * boolean and the 503 are what a load balancer acts on; the sentence is
     * for whoever reads the logs, and that is the difference between operating
     * this and probing it.
     */
    console.error('health: database unreachable:', err instanceof Error ? err.message : err);
  }

  const missing = missingInProduction();
  const healthy = database && missing.length === 0;

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      database,
      missing: missing.map((c) => ({ name: c.name, consequence: c.consequence })),
      config: describeConfig().map((c) => ({ name: c.name, present: c.present })),
    },
    { status: healthy ? 200 : 503 },
  );
}
