/**
 * Where somebody is signed in, and ending one of them — design §3.
 *
 * Not to be confused with `session.ts` next door, which is about reading
 * identity out of one request. This file is about the *set* of credentials an
 * actor is holding across their devices: the rows behind the Devices screen,
 * and the thing a revoke actually revokes.
 *
 * ## What changed, and what it cost
 *
 * §3 used to say that an actor is not a session, that the cookie is not a
 * session id, and that nothing is revoked server-side because there is
 * nothing to revoke. Every word of that was true and the design was cheaper
 * for it — identity cost no query, and sign-out was a cookie deletion.
 *
 * What it could not do is answer "where am I signed in?", and it could not
 * end a sign-in from anywhere but the device holding it. The cookie lasts
 * four hundred days. A laptop sold, lent or left behind stays signed in for
 * that long, and the only honest thing the product could offer was to rotate
 * every event link, which punishes everybody else at the party.
 *
 * So there is a row now. The cost is one query per authenticated request,
 * which is a cost the product was already paying: `currentActorId` has always
 * had to read the actor table to follow a merge pointer, and this replaces
 * that read rather than adding to it — a live session already names the
 * current actor, because a merge moves the row.
 */

import { clientLabel, describeClient, schema, type ClientKind } from '@parea/core';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import type { Db } from './db';

/** How this credential came to exist. Shown, because the list is about trust. */
export type SignInMethod = 'guest' | 'code' | 'passkey';

/**
 * How stale `last_seen_at` is allowed to get.
 *
 * The column exists to render "2 hours ago", so it is written at the accuracy
 * that sentence needs and no better. Without a throttle this is a write in
 * front of every read in the product — every page, every poll, every image
 * listing — to move a timestamp nobody reads to the second.
 */
const TOUCH_AFTER_SECONDS = 15 * 60;

export type StartedSession = { id: string };

/**
 * Records a newly issued credential.
 *
 * Called wherever one is minted: a guest actor on first contribution, a
 * sign-in by code, a sign-in by passkey.
 */
export async function startSession(
  db: Db,
  input: {
    actorId: string;
    kind: ClientKind;
    userAgent?: string | null;
    method: SignInMethod;
  },
): Promise<StartedSession> {
  const description = describeClient(input.userAgent, input.kind);
  const [row] = await db
    .insert(schema.sessions)
    .values({
      actorId: input.actorId,
      kind: description.kind,
      client: description.client,
      platform: description.platform,
      method: input.method,
    })
    .returning({ id: schema.sessions.id });
  return { id: row!.id };
}

/**
 * Signing in on a browser that already had a session keeps that session.
 *
 * The alternative — always minting — leaves a person who signed in on the
 * laptop they were already using looking at two rows for one laptop, one of
 * them dead and neither distinguishable from the other. So the row is
 * re-pointed at whoever the account resolved to and re-labelled with how they
 * got in, which is the truth about that device: it is the same browser, and
 * it is signed in differently now.
 *
 * Returns false when there was nothing to update — a revoked row, or an id
 * naming nothing — and the caller mints instead.
 */
export async function adoptSession(
  db: Db,
  sessionId: string,
  actorId: string,
  method: SignInMethod,
): Promise<boolean> {
  const updated = await db
    .update(schema.sessions)
    .set({ actorId, method, lastSeenAt: new Date() })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)))
    .returning({ id: schema.sessions.id });
  return updated.length > 0;
}

/**
 * Who this session is, and a throttled note that it was here.
 *
 * One statement, doing both. The read has to happen on every authenticated
 * request and the write almost never does, so they are folded into a single
 * round trip rather than paying for two — the `update` matches nothing inside
 * the throttle window, which is the common case, and the `select` answers
 * either way.
 *
 * Returns null for a session that is revoked or gone, and null is the whole
 * point of this file: it means signed out, decided by the server, on a
 * credential that still verifies perfectly well.
 */
export async function resolveSession(
  db: Db,
  sessionId: string,
): Promise<{ actorId: string } | null> {
  const stale = sql.raw(`interval '${TOUCH_AFTER_SECONDS} seconds'`);
  const rows: any = await db.execute(sql`
    with live as (
      select "id", "actor_id"
        from "session"
       where "id" = ${sessionId} and "revoked_at" is null
    ), touched as (
      update "session"
         set "last_seen_at" = now()
       where "id" in (select "id" from live)
         and "last_seen_at" < now() - ${stale}
      returning 1
    )
    select "actor_id" from live
  `);

  const actorId = (rows.rows ?? rows)[0]?.actor_id as string | undefined;
  return actorId ? { actorId } : null;
}

export type DeviceListing = {
  id: string;
  /** "Safari on iPhone". Everything the row says about what it is. */
  label: string;
  kind: ClientKind;
  method: SignInMethod;
  /** ISO. */
  lastSeenAt: string;
  createdAt: string;
  /** The one reading this page. Never offered a sign-out button of its own. */
  current: boolean;
};

/**
 * Everywhere this actor is signed in, most recently used first.
 *
 * Guest sessions are included, and that is not an oversight. A browser that
 * was a guest and got folded in at sign-in is a browser that can act as this
 * person — it can delete their photographs — so leaving it off a list headed
 * "where you are signed in" would be the one omission that matters.
 */
export async function listSessions(
  db: Db,
  actorId: string,
  currentSessionId: string | null,
): Promise<DeviceListing[]> {
  const rows = await db
    .select({
      id: schema.sessions.id,
      kind: schema.sessions.kind,
      client: schema.sessions.client,
      platform: schema.sessions.platform,
      method: schema.sessions.method,
      lastSeenAt: schema.sessions.lastSeenAt,
      createdAt: schema.sessions.createdAt,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.actorId, actorId), isNull(schema.sessions.revokedAt)))
    .orderBy(desc(schema.sessions.lastSeenAt));

  return rows.map((row) => ({
    id: row.id,
    label: clientLabel({ kind: row.kind, client: row.client, platform: row.platform }),
    kind: row.kind,
    method: row.method,
    lastSeenAt: row.lastSeenAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    current: row.id === currentSessionId,
  }));
}

/**
 * Ends one session, and only if it is this actor's.
 *
 * Scoped in the `where` rather than checked first, so the ownership test and
 * the write cannot disagree and there is no gap between them. An id belonging
 * to somebody else matches nothing and answers exactly as a made-up one does,
 * which is also what keeps this from being a way to ask whether a session id
 * exists.
 */
export async function revokeSession(
  db: Db,
  actorId: string,
  sessionId: string,
): Promise<boolean> {
  const revoked = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.sessions.id, sessionId),
        eq(schema.sessions.actorId, actorId),
        isNull(schema.sessions.revokedAt),
      ),
    )
    .returning({ id: schema.sessions.id });
  return revoked.length > 0;
}

/**
 * Ends every session but the one asking.
 *
 * The button for somebody who has just realised they do not recognise two of
 * the rows and does not want to think about which. Keeping the current one is
 * what makes it pressable at all — the alternative signs the person out of the
 * page they are standing on, which reads as the product breaking.
 */
export async function revokeOtherSessions(
  db: Db,
  actorId: string,
  keepSessionId: string | null,
): Promise<number> {
  const revoked = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.sessions.actorId, actorId),
        isNull(schema.sessions.revokedAt),
        keepSessionId ? sql`${schema.sessions.id} <> ${keepSessionId}` : sql`true`,
      ),
    )
    .returning({ id: schema.sessions.id });
  return revoked.length;
}

/**
 * Rows the purge job drops.
 *
 * Re-exported rather than written here: the deriver is what actually deletes
 * them, and a retention window defined in both places is one that drifts
 * silently. See `@parea/core`'s `sessions.ts` for the two cutoffs and why each
 * is later than it could be.
 */
export { SESSION_RETENTION_DAYS, staleSessions } from '@parea/core';
