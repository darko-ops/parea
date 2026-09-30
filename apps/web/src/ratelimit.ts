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

export type Limit = {
  name: string;
  max: number;
  windowSeconds: number;
  /**
   * Refuse when the count cannot be taken, rather than allow.
   *
   * Most limits fail open on a database error, deliberately — a bound on
   * abuse is not worth taking the site down for. The ones guarding a guess at
   * a secret are different: a database that errors under load is exactly
   * when a flood of guesses would otherwise go uncounted.
   */
  failClosed?: boolean;
};

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
 * Presenting a code, per source. Its own bucket, and that is the whole point.
 *
 * `SIGN_IN_LIMIT` is a *mail* budget — every word of its note above is about
 * the deployment sending messages to an address a stranger chose, and ten an
 * hour is sized for that. The verify route was spending from it too, which
 * quietly made the two compete: a person who asked for a few codes and then
 * mistyped one had no allowance left to present the code already sitting in
 * their inbox. What they were told was "That code did not work. Codes expire
 * after ten minutes" — so they asked for another, which they could not have
 * either. Testing the sign-in screen for ten minutes was enough to do it.
 *
 * Guessing is already bounded, and bounded better, by `MAX_CODE_ATTEMPTS`:
 * five tries *per code*, counted on the row so a wrong guess costs something
 * that persists. A fresh code does start a fresh five — carrying the count
 * forward would spend a mistyping person's budget on a code that is no longer
 * theirs to guess — which is why the ceiling below is worked out from the *mail*
 * budget rather than from the attempt counter alone.
 *
 * What neither of those can see is one source spraying guesses across many
 * addresses, because every address is a new row with a new allowance. This is
 * that, and nothing else.
 *
 * Thirty an hour is past anything honest — five codes is all one address can
 * receive in an hour and each allows five tries, so twenty-five is the ceiling
 * on a person working their own inbox — and far short of what a million-guess
 * space needs.
 */
export const SIGN_IN_VERIFY_LIMIT: Limit = {
  name: 'sign-in-verify',
  max: 30,
  windowSeconds: 3600,
  failClosed: true,
};

/**
 * Presenting a code, per address — the other half of the bound above.
 *
 * `SIGN_IN_VERIFY_LIMIT` stops one source spraying many addresses. Nothing
 * stopped many sources converging on one: each got its own thirty, so a
 * thousand addresses were thirty thousand guesses an hour at somebody's
 * account. The attempt counter on the row now holds at five however the
 * guesses arrive, and this caps the rest — fresh codes requested to reset it.
 *
 * Twenty-five is exactly the honest ceiling: five codes an hour can reach an
 * address (`SIGN_IN_ADDRESS_LIMIT`) and each allows five tries. It is counted
 * for every address presented, with or without an account behind it, so being
 * refused says nothing about whether one exists.
 *
 * The cost is known and accepted: somebody can spend an address's allowance
 * and keep its owner from signing in *by code* for up to an hour. A passkey
 * still works, and an hour of that is a much smaller harm than the account.
 */
export const SIGN_IN_VERIFY_ADDRESS_LIMIT: Limit = {
  name: 'sign-in-verify-address',
  max: 25,
  windowSeconds: 3600,
  failClosed: true,
};

/**
 * Starting a WebAuthn ceremony, per source.
 *
 * Not a guessing bound — a passkey assertion is a signature over a challenge
 * this server chose, and there is nothing to guess. What this bounds is the
 * *rows*: every challenge asked for is a row with a five-minute life, and the
 * endpoint that issues them answers to anybody, because the whole point of a
 * discoverable credential is that nobody has to say who they are first.
 *
 * Sixty an hour is far past somebody fumbling Face ID on a laptop, and far
 * short of what it would take to make that table worth watching.
 */
export const PASSKEY_CHALLENGE_LIMIT: Limit = {
  name: 'passkey-challenge',
  max: 60,
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
  // Vercel's own header first: it is set by the platform and a client cannot
  // supply it. `x-forwarded-for` is the fallback for anywhere else, where its
  // leftmost entry is only trustworthy behind a proxy that overwrites it.
  const forwarded =
    header.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
    header.get('x-forwarded-for')?.split(',')[0]?.trim();
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
  if (!verdict) return !limit.failClosed;

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
  if (!verdict) return !limit.failClosed;

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
 * Setting a profile picture, per source.
 *
 * The only route in this product that decodes an uploaded image *in the web
 * tier* without requiring the caller to have been let into anything first. The
 * event cover decodes too, but `administer` means somebody made the event, so
 * the set of callers is already small and already accountable. This one needs
 * an actor, and an actor is minted on demand by `POST /api/session` — so the
 * honest description of who can reach the decoder here is "anybody".
 *
 * What it bounds is CPU and memory rather than storage: one object per person,
 * replaced each time, so there is nothing cumulative to cap. A decode is the
 * expensive part, and thirty an hour is far past somebody trying three photos
 * of themselves and far below what it takes to keep a function busy.
 */
export const AVATAR_LIMIT: Limit = {
  name: 'avatar',
  max: 30,
  windowSeconds: 3600,
};

/**
 * Posting a moment, per source.
 *
 * The same shape and the same reason as the avatar's: it is a request handler
 * decoding an image, reachable by anyone with an actor. A person puts up a
 * handful in a day; sixty an hour is a script.
 */
export const MOMENT_LIMIT: Limit = {
  name: 'moment',
  max: 60,
  windowSeconds: 3600,
};

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
/**
 * Trying a spoken code, per source and per account.
 *
 * A code is three short words, and the pool is about a hundred and seventeen
 * thousand of them — small enough to sweep. `/api/join` had no limit at all,
 * and until it stopped doing so it handed the album's full link to whoever
 * guessed a live code. Codes now only work for someone signed in, and this is
 * what keeps a signed-in account from walking the pool.
 *
 * Twenty an hour is far past anybody typing codes read out across a room —
 * mistyping one twice is three tries — and makes a sweep take years. A full
 * link token is not limited here: 131 random bits is not something to guess.
 */
/**
 * Making a group out of people, per account.
 *
 * Each one notifies everybody named in it, so an unbounded route was a way to
 * push a message onto any number of phones. Thirty an hour is far past anyone
 * starting conversations by hand.
 */
export const CREATE_GROUP_LIMIT: Limit = {
  name: 'create-group',
  max: 30,
  windowSeconds: 3600,
};

/**
 * Asking for photographs to come down, per account.
 *
 * An unanswered request hides its photo after 48 hours, so each one is a
 * small lever on somebody else's album. Anybody who could see an album could
 * pull it on every photo in it, signed in or not, with no limit — and two days
 * later the album was gone unless the host declined each request by hand.
 * Twenty an hour is more than somebody going through a party's photos of
 * themselves; `REMOVAL_REQUESTS_OPEN_PER_EVENT` bounds the rest.
 */
export const REMOVAL_REQUEST_LIMIT: Limit = {
  name: 'removal-request',
  max: 20,
  windowSeconds: 3600,
};

/** How many requests one person may have waiting on one album at a time. */
export const REMOVAL_REQUESTS_OPEN_PER_EVENT = 30;

/**
 * Reporting photographs, per source.
 *
 * Open to anybody who can see the photo, signed in or not, on purpose: a
 * report of a child being abused should cost the person making it nothing.
 * But a child-safety report hides the photo on receipt and wakes a person, so
 * an unlimited route was a way to empty an album and page the responder once
 * per photograph. Twenty an hour is far past anybody reporting in good faith.
 */
export const REPORT_LIMIT: Limit = {
  name: 'report',
  max: 20,
  windowSeconds: 3600,
};

/**
 * How many photos one reporter's child-safety reports may hide, per hour,
 * before a person has looked.
 *
 * Past this the report is still recorded — nothing a reporter says is thrown
 * away — but the photo stays up until somebody reviews it. Five is more than
 * a real report ever needs at once, and it stops one account quarantining an
 * album a photograph at a time.
 */
export const QUARANTINE_ON_REPORT_LIMIT: Limit = {
  name: 'quarantine-on-report',
  max: 5,
  windowSeconds: 3600,
};

/** Looking up places, per source. Somebody naming a few events, not a script. */
export const PLACES_LIMIT: Limit = {
  name: 'places',
  max: 120,
  windowSeconds: 3600,
};

/**
 * New guest identities from the app, per source.
 *
 * Each is an actor and a session row, minted for any caller that is not a
 * browser, with nothing counting them. A phone makes one, once; twenty an hour
 * from one address is somebody making them on purpose.
 */
export const GUEST_SESSION_LIMIT: Limit = {
  name: 'guest-session',
  max: 20,
  windowSeconds: 3600,
};

export const JOIN_CODE_LIMIT: Limit = {
  name: 'join-code',
  max: 20,
  windowSeconds: 3600,
  failClosed: true,
};

export const PEOPLE_SEARCH_LIMIT: Limit = {
  name: 'people-search',
  max: 60,
  windowSeconds: 3600,
};

/**
 * Verification codes, per source.
 *
 * The text-message twin of `SIGN_IN_LIMIT`, and the note there applies word for
 * word: this is the one endpoint that makes the deployment send a message to a
 * number a caller chose, so unbounded it is a way to post things to strangers
 * over somebody else's reputation, and the bill lands here. A text costs real
 * money per segment, which the email path does not, so the ceiling is lower.
 *
 * Five an hour is a person mistyping their number twice and still getting
 * through, and far below anything worth automating.
 */
export const PHONE_CODE_LIMIT: Limit = {
  name: 'phone-code',
  max: 5,
  windowSeconds: 3600,
};

/**
 * Verification codes, per *number asked about*.
 *
 * The half a per-source cap cannot reach, and here it matters more than it does
 * for mail. The person on the receiving end of a texted code did not ask for it,
 * may not use this product at all, and cannot make it stop — and a text wakes a
 * phone up. Three an hour turns the worst case from a flood into a nuisance.
 *
 * Keyed on the number, which means the number reaches `withinLimitFor` — where
 * it is HMACed into a bucket name and never written down. That is the same
 * treatment `hashPhone` gives it and the reason this is safe to key on at all.
 *
 * Exceeding it is silent: the route answers as though the text went, because a
 * distinguishable "that number has had enough" is an oracle on whether somebody
 * has been asked about.
 */
export const PHONE_NUMBER_LIMIT: Limit = {
  name: 'phone-number',
  max: 3,
  windowSeconds: 3600,
};

/**
 * Presenting a verification code, per source.
 *
 * Its own bucket for exactly the reason `SIGN_IN_VERIFY_LIMIT` has one: sending
 * and guessing are two budgets, and sharing them means somebody who asked for a
 * couple of codes and mistyped one has no allowance left to present the code
 * already on their phone.
 *
 * Guessing is bounded better by `MAX_PHONE_ATTEMPTS` — five per code, counted on
 * the row. This bounds one source spraying guesses across many codes.
 */
export const PHONE_VERIFY_LIMIT: Limit = {
  name: 'phone-verify',
  max: 20,
  windowSeconds: 3600,
  failClosed: true,
};
