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
import { and, eq, sql } from 'drizzle-orm';

import type { Db } from './db';

export type ObservationKind =
  (typeof schema.observations.$inferInsert)['kind'];

export type Client = 'web' | 'ios' | 'android';

export type DeliveryScope = NonNullable<(typeof schema.observations.$inferInsert)['scope']>;

/**
 * Which set a download was, from what was asked for — decided here rather than
 * taken from the client, for the same reason `download` is recorded on the
 * server at all.
 *
 * No selection is the whole roll. A selection that is exactly the person's
 * favourites in this roll is `favourites`: the button the web and the app both
 * offer, and the only way to send that set — checked first, so one favourite
 * saved from that button is still a favourites download. Otherwise a single
 * photograph is `one` and anything else a `selection`.
 */
export async function downloadScope(
  db: Db,
  eventId: string,
  actorId: string | null,
  selection: string[] | null,
): Promise<DeliveryScope> {
  if (!selection) return 'all';
  const single = selection.length === 1 ? 'one' : 'selection';
  if (!actorId) return single;
  const rows = await db
    .select({ photoId: schema.photoFavourites.photoId })
    .from(schema.photoFavourites)
    .innerJoin(schema.photos, eq(schema.photos.id, schema.photoFavourites.photoId))
    .where(and(eq(schema.photoFavourites.actorId, actorId), eq(schema.photos.eventId, eventId)));
  const kept = new Set(rows.map((r) => r.photoId));
  const chosen = new Set(selection);
  return chosen.size === kept.size && [...chosen].every((id) => kept.has(id)) ? 'favourites' : single;
}

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
    /** `join_refused` only. */
    reason?: string | null;
    /** `download` and `device_save`: which set of photographs left. */
    scope?: DeliveryScope | null;
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
      reason: observation.reason ?? null,
      scope: observation.scope ?? null,
    });
  } catch (err) {
    // Logged rather than swallowed silently: a metric that stops being
    // recorded looks exactly like a metric that went to zero, and the two
    // want very different reactions.
    console.warn(`observation ${observation.kind} not recorded:`, err);
  }
}

/**
 * Whether somebody presenting a link is arriving rather than coming back.
 *
 * `link_opened` counts arrivals: a member opening the album's link again for
 * the hundredth time is using the product, not finding their way into it, and
 * counting them would bury the door's numbers under the album's regulars.
 * Unknown people are arriving by definition.
 */
export async function isArriving(db: Db, eventId: string, actorId: string | null): Promise<boolean> {
  if (!actorId) return true;
  try {
    const [row] = await db
      .select({ one: sql<number>`1` })
      .from(schema.eventParticipants)
      .where(and(eq(schema.eventParticipants.eventId, eventId), eq(schema.eventParticipants.actorId, actorId)))
      .limit(1);
    return !row;
  } catch {
    // Never let a metric fail the door.
    return false;
  }
}
