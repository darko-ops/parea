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

/**
 * Two answers: one for anybody, one for whoever runs the deployment.
 *
 * It used to give everybody the full answer — a query against the database on
 * every request, and the name of every setting and whether it was set. The
 * first made it the cheapest way to keep a scale-to-zero database awake, and
 * on a plan measured in compute-hours a monitor pinging it each minute, or a
 * script pinging it faster, could spend the month. The second told anybody
 * which providers were configured and which were not.
 *
 * So the public answer is "the website is up" and touches nothing, which is
 * what an uptime monitor needs. The full check — database, and every setting —
 * is for requests carrying `HEALTH_TOKEN`, which the operator reads from the
 * Vercel dashboard: `curl -H "authorization: Bearer $HEALTH_TOKEN" …/api/health`.
 */
export async function GET(request: Request) {
  const token = process.env.HEALTH_TOKEN;
  const deep = Boolean(token) && request.headers.get('authorization') === `Bearer ${token}`;
  if (!deep) return NextResponse.json({ status: 'ok' });

  let database = false;
  try {
    await getDb().execute(sql`select 1`);
    database = true;
  } catch (err) {
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
