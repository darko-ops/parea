/**
 * Recording the five things §18 needs that nothing else records.
 *
 * Everything about this is deliberately small. It is one insert into one
 * first-party table, the list of kinds is closed in the schema, and nothing
 * leaves this deployment — which is what keeps the app's privacy manifest
 * honest, since it declares no tracking and no tracking domains.
 *
 * **Never blocks and never fails a request.** An observation is a number about
 * what happened; if writing it goes wrong, the thing that happened still
 * happened, and a download that 500s because a metric could not be stored
 * would be the worst possible trade.
 */

import { schema } from '@parea/core';

import type { Db } from './db';

export type ObservationKind =
  (typeof schema.observations.$inferInsert)['kind'];

export type Client = 'web' | 'ios' | 'android';

/**
 * Which client a request came from.
 *
 * The native client sends its identity as a bearer token rather than a cookie,
 * which is the one structural difference between them (§3) — so the presence
 * of that header is the honest signal, and there is nothing to spoof that
 * matters: a client lying about itself skews a number and reaches nothing.
 */
export function clientOf(request: Request): Client {
  const declared = request.headers.get('x-parea-client');
  if (declared === 'ios' || declared === 'android') return declared;
  return 'web';
}

export async function observe(
  db: Db,
  observation: {
    kind: ObservationKind;
    eventId?: string | null;
    actorId?: string | null;
    client: Client;
    count?: number | null;
    outOf?: number | null;
  },
): Promise<void> {
  try {
    await db.insert(schema.observations).values({
      kind: observation.kind,
      eventId: observation.eventId ?? null,
      actorId: observation.actorId ?? null,
      client: observation.client,
      count: observation.count ?? null,
      outOf: observation.outOf ?? null,
    });
  } catch (err) {
    // Logged rather than swallowed silently: a metric that stops being
    // recorded looks exactly like a metric that went to zero, and the two
    // want very different reactions.
    console.warn(`observation ${observation.kind} not recorded:`, err);
  }
}
