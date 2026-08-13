/**
 * Bounds on how fast one source can ask — design §7.8.
 *
 * The per-actor cap counts what an identity has stored. It is the right shape
 * for the honest heavy shooter and the wrong shape for anyone hostile, because
 * an actor is minted on demand and costs nothing: drop the cookie, get a fresh
 * allowance. Anything that survives that has to be counted somewhere the
 * client does not control.
 *
 * Two things do. The per-event cap in the uploads route bounds one link's total
 * blast radius, whoever presents it. This file bounds *rate*, per source, which
 * is what stops the same person turning the crank faster or spraying a hundred
 * new events.
 *
 * ## Why rate and not volume
 *
 * A per-source volume cap would be the intuitive thing and it would fire on the
 * exact case the product is for: twenty people at a wedding, on the venue's
 * wifi, sharing one NAT address, all uploading at once. That is not abuse and
 * must not look like it. A rate limit does not care how much they upload, only
 * how fast the requests come — and twenty humans tapping a file picker never
 * approach what one loop does in a second.
 *
 * ## What is stored
 *
 * Not the IP. The bucket key is an HMAC of it under the server secret, so the
 * table is opaque to anyone who reads it and carries no personal data to
 * retain, disclose or delete. Truncated to 128 bits, which is far past what a
 * counter key needs and short enough to index cheaply.
 *
 * ## What this does not do
 *
 * `x-forwarded-for` is only as honest as the proxy in front of it. Vercel
 * overwrites the header and does not pass through a client-supplied one, so on
 * the intended deployment the value is the connecting address. Behind a proxy
 * that appends instead, or none at all, a caller can name whatever source it
 * likes and this bounds nothing. That is why it is the second line and not the
 * first: the per-event cap does not depend on any of it.
 */

import { schema } from '@parea/core';
import { lt, sql } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { headers } from 'next/headers';

import type { Db } from './db';

export type Limit = { name: string; max: number; windowSeconds: number };

/**
 * Presigning, per source.
 *
 * 50 files a request, so 300 requests is 15,000 photo slots an hour — orders
 * of magnitude past a party and orders of magnitude below what an unattended
 * script manages. The volume those requests can actually land is bounded
 * separately, by the per-event cap.
 */
export const PRESIGN_LIMIT: Limit = {
  name: 'presign',
  max: 300,
  windowSeconds: 3600,
};

/**
 * Event creation, per source.
 *
 * The hole this closes: every other bound is per event, so an attacker who can
 * mint events without limit has no bound at all. Someone organising a weekend
 * makes two or three.
 */
export const CREATE_EVENT_LIMIT: Limit = {
  name: 'create-event',
  max: 20,
  windowSeconds: 3600,
};

/**
 * Sign-in codes, per source.
 *
 * Tighter than everything else, because this is the one endpoint that makes
 * the deployment send mail to an address a stranger chose. Unbounded, it is a
 * way to post things to other people over someone else's reputation, and the
 * bill and the blocklisting both land here.
 *
 * Ten an hour is far more than a person signing in needs and far less than
 * anyone would bother automating.
 */
export const SIGN_IN_LIMIT: Limit = {
  name: 'sign-in',
  max: 10,
  windowSeconds: 3600,
};

/**
 * Sign-in codes, per *address asked about*.
 *
 * The other half of the same problem, and the half a per-source cap cannot
 * reach. Ten an hour per source bounds what one caller can spend; it does not
 * bound what one *person* receives, because the address is chosen by whoever
 * asks and a handful of sources is not a hard thing to have. The party on the
 * receiving end of that is not a Parea user and never agreed to any of it.
 *
 * Five is generous for the real case — ask, mistype, ask again, switch
 * devices — and turns a mail flood into a trickle. Exceeding it changes
 * nothing a caller can see: the endpoint still answers 204, because a
 * distinguishable "that address has had enough" would answer the question the
 * whole endpoint refuses to answer.
 */
export const SIGN_IN_ADDRESS_LIMIT: Limit = {
  name: 'sign-in-address',
  max: 5,
  windowSeconds: 3600,
};

/**
 * An opaque, stable-per-window handle for the caller.
 *
 * Returns null when no address is available, which is the local-development
 * case and also a misconfigured proxy. Callers treat null as "cannot limit"
 * and allow the request: refusing everything the moment a header goes missing
 * would turn a proxy change into an outage, and the caps that actually protect
 * storage do not run through here.
 */
export async function sourceKey(secret: string): Promise<string | null> {
  const header = await headers();
  // Leftmost is the client on a proxy that overwrites the header, which is the
  // documented Vercel behaviour. See the caveat at the top of this file.
  const forwarded = header.get('x-forwarded-for')?.split(',')[0]?.trim();
  const address = forwarded || header.get('x-real-ip')?.trim();
  if (!address) return null;
  return createHmac('sha256', secret).update(address).digest('hex').slice(0, 32);
}

export type Verdict = { allowed: boolean; count: number; max: number };

/**
 * Counts one request against a fixed window, atomically.
 *
 * Fixed rather than sliding: one upsert, no history table, and the worst case
 * is that someone gets up to 2× the limit across a window boundary. At these
 * numbers that is not worth a second table to prevent.
 *
 * The whole decision is a single statement on purpose. Read-then-write would
 * let concurrent requests — precisely what a limiter exists to see — each read
 * the same count and each decide they were under it.
 */
export async function consume(
  db: Db,
  key: string,
  limit: Limit,
): Promise<Verdict> {
  const bucket = `${limit.name}:${key}`;
  const window = sql.raw(`interval '${limit.windowSeconds} seconds'`);

  const rows: any = await db.execute(sql`
    insert into "rate_limit" ("bucket", "window_start", "count")
    values (${bucket}, now(), 1)
    on conflict ("bucket") do update set
      "window_start" = case
        when "rate_limit"."window_start" < now() - ${window} then now()
        else "rate_limit"."window_start"
      end,
      "count" = case
        when "rate_limit"."window_start" < now() - ${window} then 1
        else "rate_limit"."count" + 1
      end
    returning "count"
  `);

  const count = Number((rows.rows ?? rows)[0]?.count ?? 0);
  return { allowed: count <= limit.max, count, max: limit.max };
}

/**
 * Checks a limit and says whether to proceed.
 *
 * Failing open on a database error is deliberate. This is a bound on abuse,
 * not an authorization decision — the things that must not fail open are in
 * `authorize()` and in the storage caps, and both are elsewhere.
 */
export async function withinLimit(
  db: Db,
  limit: Limit,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return true;
  const key = await sourceKey(secret).catch(() => null);
  if (!key) return true;

  const verdict = await consume(db, key, limit).catch(() => null);
  if (!verdict) return true;

  if (!verdict.allowed) {
    // Worth a log line: these are set far above real use, so one firing is
    // either abuse or an assumption about real use being wrong.
    console.warn(
      `rate limit: ${limit.name} at ${verdict.count}/${verdict.max} for ${key.slice(0, 8)}…`,
    );
  }
  return verdict.allowed;
}

/**
 * The same check against something other than the caller's address.
 *
 * `subject` is hashed under the server secret before it is stored, exactly as
 * an IP is, so the table holds no email addresses — a bucket name is a counter
 * key and has no business being a list of who has tried to sign in.
 *
 * Fails open on a database error for the same reason `withinLimit` does.
 */
export async function withinLimitFor(
  db: Db,
  limit: Limit,
  secret: string | undefined,
  subject: string,
): Promise<boolean> {
  if (!secret) return true;
  const key = createHmac('sha256', secret)
    .update(`${limit.name}:${subject}`)
    .digest('hex')
    .slice(0, 32);

  const verdict = await consume(db, key, limit).catch(() => null);
  if (!verdict) return true;

  if (!verdict.allowed) {
    console.warn(`rate limit: ${limit.name} at ${verdict.count}/${verdict.max}`);
  }
  return verdict.allowed;
}

/** Drops windows that have closed. Called from the purge job. */
export function expiredBefore(now: Date, longestWindowSeconds = 3600): Date {
  return new Date(now.getTime() - longestWindowSeconds * 1000);
}

export function staleRateLimits(cutoff: Date) {
  return lt(schema.rateLimits.windowStart, cutoff);
}

/**
 * Searching for a person, per source.
 *
 * The only read in this product that walks the account table, which makes it
 * the only one that can be used to learn who has an account rather than to
 * find somebody you already know. Sixty an hour is more than anyone adding
 * friends will ever spend and far short of what enumerating handles would
 * need — the space is three words out of a hundred thousand, so a bounded
 * trickle gets nowhere.
 */
export const PEOPLE_SEARCH_LIMIT: Limit = {
  name: 'people-search',
  max: 60,
  windowSeconds: 3600,
};
