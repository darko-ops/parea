/**
 * Passkeys — design §3.
 *
 * The second way into an account, and the one that does not involve an inbox.
 * A code is still how an account is created and still how somebody gets in on
 * a device they have never held; this is what makes every visit after the
 * first a glance at a camera.
 *
 * ## It is an addition, never a replacement
 *
 * Nobody is required to have one. Removing the last one is allowed. The code
 * path is untouched and is never hidden behind this. That is not politeness:
 * a passkey lives on a device, and the case accounts exist for in this product
 * is *a new phone*, where by definition the old device is not present. A
 * product that made the passkey the way in would have locked people out of
 * their own photographs at exactly the moment the account was supposed to help.
 *
 * ## Why a library, when the mailer is four hand-written POSTs
 *
 * `email.ts` argues against an SDK and it is right: a send is four fields, and
 * the four providers' shapes fit on a page. This is not that. Verifying a
 * registration means decoding CBOR to find a COSE key, and verifying an
 * assertion means checking an origin, an RP ID hash, a user-verification flag,
 * a signature over a concatenation, and a counter — where every one of those
 * checks fails *silently open* if it is written wrongly. A mailer that is wrong
 * sends nothing and somebody notices; a verifier that is wrong accepts
 * everything and nobody does.
 *
 * So `@simplewebauthn/server` does the ceremony. What is written down here is
 * the part that is this product's rather than the specification's: which
 * origins count, what a passkey is allowed to be, and what happens to the
 * counter.
 */

import {
  clientLabel,
  describeClient,
  schema,
  type ClientKind,
} from '@parea/core';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import type { Db } from './db';
import { androidFingerprints } from './deeplinks';

/** Long enough to find the button, short enough that a captured one is stale. */
export const CHALLENGE_TTL_MS = 5 * 60_000;

/** What the authenticator shows the person it is asking. */
const RP_NAME = 'Parea';

/**
 * The apex this product's passkeys belong to.
 *
 * A passkey is bound to one RP ID forever, and the RP ID has to be a suffix of
 * whatever origin the ceremony runs on. Deriving it from the request host
 * naively would bind a key registered on `www.parea.photos` to `www`, and that
 * key would then not work on the bare domain — two hosts, two sets of keys,
 * and a person whose Face ID works only if they typed the `www`.
 *
 * So the apex wins wherever the request is recognisably this product, and
 * anything else — localhost, a preview deployment — uses its own host, which
 * is the only value WebAuthn will accept there. An override exists for a
 * deployment on a domain this constant does not know about.
 */
const APEX = 'parea.photos';

export function rpIdFor(host: string | null | undefined): string {
  const override = process.env.PASSKEY_RP_ID?.trim();
  if (override) return override;
  const hostname = (host ?? '').split(':')[0]!.toLowerCase();
  if (hostname === APEX || hostname.endsWith(`.${APEX}`)) return APEX;
  return hostname || APEX;
}

/**
 * Every origin an assertion for this deployment may legitimately come from.
 *
 * Three kinds, and the third is the one that is easy to get wrong.
 *
 *   - the site itself, on the apex and on `www`;
 *   - the host this request was served on, which is what makes a preview
 *     deployment and `localhost` work without configuration;
 *   - the Android app, which has no https origin at all. Chrome reports
 *     `android:apk-key-hash:<base64url sha256 of the signing cert>`, and the
 *     same fingerprints that go in `assetlinks.json` are where that comes from
 *     — so an app whose links verify is an app whose passkeys work, from one
 *     piece of configuration rather than two.
 *
 * iOS needs nothing here: an app holding the `webcredentials` entitlement
 * asserts as `https://parea.photos`, which is already in the list.
 *
 * ## Never from the `Origin` header, and no longer from any `Host` either
 *
 * The tempting shortcut is to add the request's own `Origin` to this list,
 * because it makes every deployment work with no configuration at all. It also
 * hands the allowlist to the caller: a request claiming `Origin:
 * https://evil.example` would have that origin accepted, and the check that
 * exists to establish *where the ceremony happened* would be answering with
 * whatever it was told. That has never been done here.
 *
 * `Host` was, and it is a better value — what the request was routed on rather
 * than a claim it makes about itself, matched by the platform against the
 * domains assigned to the project. It was still the caller's string arriving in
 * an allowlist, and the reasoning for trusting it was a sentence about how the
 * deployment happens to be configured. That sentence is true today and is not a
 * thing this file can check.
 *
 * So the list is built from things that are *not* the request:
 *
 *   - the apex and `www`, which are constants;
 *   - whatever Vercel says this deployment is. `VERCEL_URL` is the
 *     per-deployment hostname, `VERCEL_BRANCH_URL` the branch alias somebody
 *     actually opens a preview on, and `VERCEL_PROJECT_PRODUCTION_URL` the
 *     project's own. All three are set by the platform into the runtime, which
 *     is the whole distinction — a caller cannot reach them;
 *   - `PASSKEY_RP_ID` when a deployment lives on a domain this file has never
 *     heard of, which is the case that override already exists for;
 *   - `localhost` and `127.0.0.1`, read from `Host` because there is nothing
 *     else to read it from, and harmless because an attacker who can make a
 *     browser treat their origin as localhost has already won.
 *
 * What this costs: a preview opened on a URL Vercel did not put in the
 * environment cannot complete a passkey ceremony. That is a degradation on a
 * surface nobody registers real credentials on, and it is visible — the
 * ceremony fails rather than quietly accepting something.
 *
 * This is defence in depth and is worth being honest about. The browser already
 * refuses to sign for this RP ID on somebody else's domain, so an attacker
 * needs a subdomain of the apex or control of the `Host` on a real request
 * before any of this matters. Two locks, and this is the cheaper one to keep
 * shut.
 */
export function expectedOrigins(host: string | null | undefined): string[] {
  const origins = new Set<string>([`https://${APEX}`, `https://www.${APEX}`]);

  /*
   * The hosts the platform declares for this deployment.
   *
   * Set by Vercel into the function's environment, so unlike `Host` they
   * cannot be influenced by whoever is making the request. `VERCEL_BRANCH_URL`
   * is the one that matters in practice: a preview is opened on the branch
   * alias far more often than on the per-deployment hostname.
   */
  for (const declared of [
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]) {
    const trimmed = declared?.trim().toLowerCase();
    if (trimmed) origins.add(`https://${trimmed}`);
  }

  // A deployment on a domain this file does not know about. The same override
  // that decides the RP ID decides the origin it is asserted from; having one
  // without the other would be a deployment that can register and never verify.
  const override = process.env.PASSKEY_RP_ID?.trim().toLowerCase();
  if (override) origins.add(`https://${override}`);

  /*
   * Development, and the one place this product is served over http.
   *
   * WebAuthn requires a secure context and treats `localhost` as one, so this
   * is the only host that gets a plaintext origin. Read from `Host` because a
   * laptop has no platform to declare it — and safe to, because the value is
   * pinned to two names that mean "this machine".
   */
  const hostHeader = (host ?? '').toLowerCase();
  const hostname = hostHeader.split(':')[0]!;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    origins.add(`https://${hostHeader}`);
    origins.add(`http://${hostHeader}`);
  }

  for (const fingerprint of androidFingerprints()) {
    const bytes = Buffer.from(fingerprint.split(':').join(''), 'hex');
    origins.add(`android:apk-key-hash:${bytes.toString('base64url')}`);
  }
  return [...origins];
}

/**
 * Both RP IDs the apex can legitimately produce.
 *
 * `www.parea.photos` is an origin whose RP ID is the apex, and a preview host
 * is its own. Passing both to the verifier rather than one is what lets a key
 * registered before a domain change keep working.
 */
function expectedRpIds(host: string | null | undefined): string[] {
  const derived = rpIdFor(host);
  return derived === APEX ? [APEX] : [derived, APEX];
}

// --- the challenge -----------------------------------------------------------

async function storeChallenge(
  db: Db,
  challenge: string,
  purpose: 'register' | 'authenticate',
  actorId: string | null,
  now = new Date(),
): Promise<void> {
  await db.insert(schema.webauthnChallenges).values({
    challenge,
    purpose,
    actorId,
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
  });
}

/**
 * Spends a challenge, and will only ever spend it once.
 *
 * One statement, and that is the whole security argument: a select followed by
 * an update has a gap, and two assertions arriving inside that gap both find
 * the challenge unconsumed and both verify. Replaying a captured assertion is
 * precisely what a challenge exists to stop, so the single-use property cannot
 * be left to a read followed by a write.
 */
async function consumeChallenge(
  db: Db,
  challenge: string,
  purpose: 'register' | 'authenticate',
): Promise<{ ok: boolean; actorId: string | null }> {
  const rows: any = await db.execute(sql`
    update "webauthn_challenge"
       set "consumed_at" = now()
     where "challenge" = ${challenge}
       and "purpose" = ${purpose}
       and "consumed_at" is null
       and "expires_at" > now()
    returning "actor_id"
  `);
  const row = (rows.rows ?? rows)[0];
  return row ? { ok: true, actorId: (row.actor_id as string | null) ?? null } : { ok: false, actorId: null };
}

/** Spent and stale challenges. Called from the purge job. */
export function staleChallenges(now: Date) {
  return lt(schema.webauthnChallenges.expiresAt, now);
}

// --- registering one ---------------------------------------------------------

export type PasskeyListing = {
  id: string;
  label: string | null;
  /** Whether the authenticator says this key is in a synced keychain. */
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
};

export async function listPasskeys(db: Db, actorId: string): Promise<PasskeyListing[]> {
  const rows = await db
    .select({
      id: schema.passkeys.id,
      label: schema.passkeys.label,
      backedUp: schema.passkeys.backedUp,
      createdAt: schema.passkeys.createdAt,
      lastUsedAt: schema.passkeys.lastUsedAt,
    })
    .from(schema.passkeys)
    .where(eq(schema.passkeys.actorId, actorId))
    .orderBy(schema.passkeys.createdAt);

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    backedUp: row.backedUp,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }));
}

/**
 * Whether this actor has any passkey at all.
 *
 * Asked by the sign-in route so the client can skip the offer for somebody who
 * already has one on another device. A count would be more information and
 * less useful: the question is whether to show a card, and "one or more" is the
 * whole answer.
 */
export async function hasPasskey(db: Db, actorId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.passkeys.id })
    .from(schema.passkeys)
    .where(eq(schema.passkeys.actorId, actorId))
    .limit(1);
  return row != null;
}

/**
 * What the browser needs to make a passkey.
 *
 * ## The two hard requirements, and why each is required rather than preferred
 *
 * `residentKey: 'required'` makes this a *discoverable* credential — the key
 * carries enough to name its own account, so signing in is a button and a
 * glance rather than an address typed first. `preferred` would leave some
 * authenticators making a key that cannot be found without being told which
 * account to look for, and the sign-in screen would have to ask for the email
 * anyway. The whole feature is the absence of that question.
 *
 * `userVerification: 'required'` is the Face ID part. A passkey that asserts
 * without verifying the person is a bearer token in a keychain: possession of
 * the laptop would be possession of the account, and the product already has a
 * gentler version of that in the cookie. Requiring verification is what makes
 * this stronger than what it sits beside rather than a faster way to be weaker.
 *
 * `excludeCredentials` stops a second key for an authenticator that already
 * has one. Without it, tapping Add twice makes two keys that feel identical,
 * and removing "the wrong one" is a coin flip.
 */
export async function registrationOptions(
  db: Db,
  input: {
    actorId: string;
    accountId: string;
    email: string;
    displayName: string | null;
    host: string | null;
    /**
     * Ask for *this device's* authenticator — Face ID, Touch ID, Windows Hello.
     *
     * The client decides, because only the client can see whether there is one:
     * `isUserVerifyingPlatformAuthenticatorAvailable()` is a browser question.
     *
     * ## Why this is not simply always on
     *
     * It maps to `authenticatorAttachment: 'platform'`, and that does not
     * *prefer* the local device — it excludes everything else. On a machine with
     * no platform authenticator (a desktop Mac, Windows without Hello) the
     * ceremony then fails outright rather than falling back, and the fallback it
     * would have offered is a real feature: scanning a QR code with a phone is
     * how somebody signs into a borrowed laptop with the passkey they already
     * have.
     *
     * ## Why it is not simply always off, which is what shipped
     *
     * Left unset, the browser shows its full chooser: a QR code, a security key,
     * and the local device somewhere among them. That is the correct menu for
     * "add a passkey" in the abstract and the wrong one for a button that says
     * "Next time, sign in with Face ID" — the product promised one thing and the
     * platform offered three, with the promised one not obviously present.
     */
    preferPlatform: boolean;
  },
) {
  const existing = await db
    .select({
      credentialId: schema.passkeys.credentialId,
      transports: schema.passkeys.transports,
    })
    .from(schema.passkeys)
    .where(eq(schema.passkeys.actorId, input.actorId));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpIdFor(input.host),
    /*
     * The account id, not the actor id.
     *
     * This is the handle the authenticator files the key under, and it decides
     * whether registering again replaces the old entry or adds a second one
     * beside it. An actor id changes when two of them are merged, so a key
     * made before somebody signed in on a second device would be filed under a
     * name that no longer exists — and the person would see two Parea entries
     * in their keychain for one account.
     */
    userID: new Uint8Array(Buffer.from(input.accountId, 'utf8')),
    userName: input.email,
    userDisplayName: input.displayName ?? input.email,
    attestationType: 'none',
    excludeCredentials: existing.map((row) => ({
      id: row.credentialId,
      transports: row.transports ? (row.transports.split(',') as any) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
    /*
     * Sets `hints: ['client-device']` and `authenticatorAttachment: 'platform'`
     * together, which is what takes the browser straight to the biometric
     * prompt instead of to a menu. Omitted entirely when there is no local
     * authenticator to go to — see `preferPlatform`.
     */
    ...(input.preferPlatform ? { preferredAuthenticatorType: 'localDevice' as const } : {}),
  });

  await storeChallenge(db, options.challenge, 'register', input.actorId);
  return options;
}

export type RegistrationOutcome =
  | { ok: true; passkey: PasskeyListing }
  | { ok: false; reason: 'challenge' | 'rejected' | 'already_registered' };

/**
 * Checks what came back and keeps the key.
 *
 * The challenge is spent *before* the signature is checked. That ordering is
 * deliberate: a failed verification must not leave the challenge outstanding
 * for another attempt, because "another attempt" against a captured response
 * is the replay this is all for. Spending it first costs somebody who fumbles
 * a Touch ID prompt one extra tap on Add, and buys single-use unconditionally.
 */
export async function verifyRegistration(
  db: Db,
  input: {
    actorId: string;
    response: RegistrationResponseJSON;
    host: string | null;
    userAgent: string | null;
    kind: ClientKind;
  },
): Promise<RegistrationOutcome> {
  const expectedChallenge = input.response.response.clientDataJSON
    ? challengeFrom(input.response.response.clientDataJSON)
    : null;
  if (!expectedChallenge) return { ok: false, reason: 'challenge' };

  const spent = await consumeChallenge(db, expectedChallenge, 'register');
  // Tied to the actor it was issued to, so a challenge handed to one person
  // cannot be used to hang a passkey off somebody else's account.
  if (!spent.ok || spent.actorId !== input.actorId) {
    return { ok: false, reason: 'challenge' };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: expectedOrigins(input.host),
      expectedRPID: expectedRpIds(input.host),
      requireUserVerification: true,
    });
  } catch {
    // Every way of being wrong is one answer. The client has nothing to do
    // differently for a bad signature than for a bad origin.
    return { ok: false, reason: 'rejected' };
  }

  if (!verification.verified) return { ok: false, reason: 'rejected' };

  const { credential, credentialBackedUp } = verification.registrationInfo;
  const label = clientLabel(describeClient(input.userAgent, input.kind));

  try {
    const [row] = await db
      .insert(schema.passkeys)
      .values({
        actorId: input.actorId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        signCount: credential.counter,
        transports: credential.transports?.length ? credential.transports.join(',') : null,
        backedUp: credentialBackedUp,
        label,
      })
      .returning({
        id: schema.passkeys.id,
        label: schema.passkeys.label,
        backedUp: schema.passkeys.backedUp,
        createdAt: schema.passkeys.createdAt,
      });

    return {
      ok: true,
      passkey: {
        id: row!.id,
        label: row!.label,
        backedUp: row!.backedUp,
        createdAt: row!.createdAt.toISOString(),
        lastUsedAt: null,
      },
    };
  } catch {
    /*
     * The unique index on `credential_id`.
     *
     * `excludeCredentials` asks the authenticator not to make a duplicate and
     * most of them honour it, but the request is a hint and the index is the
     * decision. Reaching here means the same physical key is already enrolled
     * — possibly against another account, which is the case that must not
     * become a quiet re-pointing of somebody else's passkey.
     */
    return { ok: false, reason: 'already_registered' };
  }
}

/**
 * The challenge the client says it signed.
 *
 * Read out of `clientDataJSON` so it can be looked up, and then handed to the
 * verifier as the *expected* value — which sounds circular and is not. The
 * lookup is what proves the challenge was one this server issued, is
 * unexpired, and has not been used; the verifier then proves the signature
 * covers that same clientDataJSON. A made-up challenge fails the lookup, and a
 * real one cannot be moved onto a different signature.
 */
function challengeFrom(clientDataJSON: string): string | null {
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
    return typeof parsed?.challenge === 'string' ? parsed.challenge : null;
  } catch {
    return null;
  }
}

export async function removePasskey(
  db: Db,
  actorId: string,
  id: string,
): Promise<boolean> {
  // Scoped to the actor in the `where`, so an id belonging to somebody else
  // matches nothing and answers exactly as a made-up one does.
  const removed = await db
    .delete(schema.passkeys)
    .where(and(eq(schema.passkeys.id, id), eq(schema.passkeys.actorId, actorId)))
    .returning({ id: schema.passkeys.id });
  return removed.length > 0;
}

// --- signing in with one -----------------------------------------------------

/**
 * What the browser needs to sign in.
 *
 * No `allowCredentials`, deliberately. An empty list means "offer whatever you
 * have for this site", which is what makes the discoverable key worth
 * requiring: the person presses a button and picks a face, and never says who
 * they are first. Sending a list would also be an oracle — the server would
 * have to be told an address to build one, and the reply would say whether
 * that address had passkeys, which is the same question `/api/account/code`
 * refuses to answer.
 */
export async function authenticationOptions(db: Db, host: string | null) {
  const options = await generateAuthenticationOptions({
    rpID: rpIdFor(host),
    userVerification: 'required',
  });
  await storeChallenge(db, options.challenge, 'authenticate', null);
  return options;
}

export type AuthenticationOutcome =
  | { ok: true; actorId: string }
  | { ok: false; reason: 'challenge' | 'unknown_key' | 'rejected' };

/**
 * Checks an assertion and says whose account it was.
 *
 * Answers with an actor and nothing else. Everything after this — binding this
 * device's guest actor, the merge, the handle — is the same code the emailed
 * code path runs, because signing in has to mean the same thing however
 * somebody proved who they were.
 */
export async function verifyAuthentication(
  db: Db,
  input: {
    response: AuthenticationResponseJSON;
    host: string | null;
  },
): Promise<AuthenticationOutcome> {
  const expectedChallenge = challengeFrom(input.response.response.clientDataJSON);
  if (!expectedChallenge) return { ok: false, reason: 'challenge' };

  const spent = await consumeChallenge(db, expectedChallenge, 'authenticate');
  if (!spent.ok) return { ok: false, reason: 'challenge' };

  const [stored] = await db
    .select()
    .from(schema.passkeys)
    .where(eq(schema.passkeys.credentialId, input.response.id))
    .limit(1);
  if (!stored) return { ok: false, reason: 'unknown_key' };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge,
      expectedOrigin: expectedOrigins(input.host),
      expectedRPID: expectedRpIds(input.host),
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey),
        counter: stored.signCount,
        transports: stored.transports ? (stored.transports.split(',') as any) : undefined,
      },
      requireUserVerification: true,
    });
  } catch {
    return { ok: false, reason: 'rejected' };
  }

  if (!verification.verified) return { ok: false, reason: 'rejected' };

  /*
   * The counter, and why it is recorded rather than enforced.
   *
   * A hardware key increments a counter on every assertion, and a counter that
   * goes backwards means two copies of a key that was supposed to be
   * uncloneable. That check is worth having where it can be made.
   *
   * It cannot be made here for most of the keys this product will see. A
   * passkey synced through iCloud or a password manager exists on several
   * devices by design, and those authenticators report zero forever precisely
   * because a shared counter would be meaningless. So: the value is stored and
   * only ever moved forward, which keeps the signal for a key that does keep
   * one, and a zero is not treated as a regression — refusing on `newCounter
   * <= signCount` would refuse every Face ID sign-in after the first.
   */
  const { newCounter } = verification.authenticationInfo;
  await db
    .update(schema.passkeys)
    .set({
      signCount: Math.max(newCounter, stored.signCount),
      lastUsedAt: new Date(),
      // Re-read on every use: a key made on a device with no keychain and
      // later synced changes its answer, and the list says which it is.
      backedUp: verification.authenticationInfo.credentialBackedUp,
    })
    .where(eq(schema.passkeys.id, stored.id));

  return { ok: true, actorId: stored.actorId };
}

/**
 * Whether this actor still holds the account its passkeys belong to.
 *
 * A passkey whose actor lost its account — the account was deleted — must not
 * sign anybody in. The row would be cleaned up by the cascade if the *actor*
 * went, but deleting an account leaves the actor behind as a guest on purpose,
 * and a key still pointing at it would then be a way into an account that no
 * longer exists.
 */
export async function passkeyOwnerHasAccount(db: Db, actorId: string): Promise<boolean> {
  const [row] = await db
    .select({ accountId: schema.actors.accountId })
    .from(schema.actors)
    .where(and(eq(schema.actors.id, actorId), isNull(schema.actors.mergedIntoId)))
    .limit(1);
  return row?.accountId != null;
}
