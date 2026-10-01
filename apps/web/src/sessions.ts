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
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

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
      // Every call that is not a sign-in passes `guest`; see `signedInAt`.
      signedInAt: input.method === 'guest' ? null : new Date(),
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
    .set({
      actorId,
      method,
      lastSeenAt: new Date(),
      signedInAt: method === 'guest' ? null : new Date(),
    })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)))
    .returning({ id: schema.sessions.id });
  return updated.length > 0;
}

/**
 * How recent a sign-in has to be to add a way into the account.
 *
 * An hour: long enough that the offer straight after signing in, and a trip
 * to the Devices screen in the same sitting, both work without a second code;
 * short enough that a cookie lifted from somebody's browser next week cannot
 * enrol a passkey of its own and outlive being signed out.
 */
export const RECENT_SIGN_IN_SECONDS = 3600;

/** Whether this session signed in within `RECENT_SIGN_IN_SECONDS`. */
export async function signedInRecently(
  db: Db,
  sessionId: string | null,
  now: Date = new Date(),
): Promise<boolean> {
  if (!sessionId) return false;
  const [row] = await db
    .select({ signedInAt: schema.sessions.signedInAt })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)))
    .limit(1);
  const at = row?.signedInAt;
  return at != null && now.getTime() - at.getTime() <= RECENT_SIGN_IN_SECONDS * 1000;
}

/**
 * The refusal every route asking for a recent sign-in gives, in one shape, so
 * both clients can recognise it wherever it comes from.
 */
export const STALE_SIGN_IN = { error: 'recent_sign_in_required' } as const;

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
  /** The session the row acts on: this one if it is in the group, else the newest. */
  id: string;
  /** "Safari on iPhone". Everything the row says about what it is. */
  label: string;
  kind: ClientKind;
  method: SignInMethod;
  /** ISO. The newest in the group. */
  lastSeenAt: string;
  /** ISO. The oldest in the group. */
  createdAt: string;
  /** The one reading this page is in this group. */
  current: boolean;
  /** How many sessions the row stands for. Usually one. */
  count: number;
};

/**
 * Everywhere this actor is signed in, most recently used first, one row per
 * thing a person would recognise.
 *
 * Guest sessions are included, and that is not an oversight. A browser that
 * was a guest and got folded in at sign-in is a browser that can act as this
 * person — it can delete their photographs — so leaving it off a list headed
 * "where you are signed in" would be the one omission that matters.
 *
 * ## Why rows are grouped by label
 *
 * One laptop collects sessions: a cleared cookie, a private window, a second
 * profile, a sign-in from before `adoptSession` existed. Each is a real row and
 * each printed as its own "Chrome on macOS", so the list read as six laptops
 * when there was one — and a list nobody can check against reality is the
 * failure this screen exists to avoid. Nothing in a request says two of them
 * are the same machine, so they are grouped by the only thing the person can
 * see, the label, and the row says how many it stands for. Signing the row out
 * ends all of them; see `revokeDevice`.
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

  // Rows arrive newest first, so the first of each label sets the group's
  // place in the list and its "last used".
  const groups = new Map<string, DeviceListing>();
  for (const row of rows) {
    const label = clientLabel({ kind: row.kind, client: row.client, platform: row.platform });
    const current = row.id === currentSessionId;
    const createdAt = row.createdAt.toISOString();
    const group = groups.get(label);
    if (!group) {
      groups.set(label, {
        id: row.id,
        label,
        kind: row.kind,
        method: row.method,
        lastSeenAt: row.lastSeenAt.toISOString(),
        createdAt,
        current,
        count: 1,
      });
      continue;
    }
    group.count += 1;
    if (createdAt < group.createdAt) group.createdAt = createdAt;
    // The device in your hand speaks for its group, so "This device" and its
    // Sign out mean this device.
    if (current) {
      group.id = row.id;
      group.method = row.method;
      group.current = true;
    }
  }
  return [...groups.values()];
}

/**
 * Ends a row of the Devices list: the session named and every other live one
 * printed under the same label, never the one asking.
 *
 * Asked for by id rather than by label so the client sends back exactly what
 * it was given, and so ownership is decided the way `revokeSession` decides it
 * — an id that is not this actor's matches nothing. Returns how many ended.
 */
export async function revokeDevice(
  db: Db,
  actorId: string,
  sessionId: string,
  keepSessionId: string | null,
): Promise<number> {
  const live = await db
    .select({
      id: schema.sessions.id,
      kind: schema.sessions.kind,
      client: schema.sessions.client,
      platform: schema.sessions.platform,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.actorId, actorId), isNull(schema.sessions.revokedAt)));

  const named = live.find((row) => row.id === sessionId);
  if (!named) return 0;
  const label = clientLabel(named);
  const ids = live
    .filter((row) => row.id !== keepSessionId && clientLabel(row) === label)
    .map((row) => row.id);
  if (ids.length === 0) return 0;

  const revoked = await db
    .update(schema.sessions)
    .set({ revokedAt: new Date() })
    .where(and(inArray(schema.sessions.id, ids), isNull(schema.sessions.revokedAt)))
    .returning({ id: schema.sessions.id });
  return revoked.length;
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
