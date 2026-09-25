/**
 * Passkeys — design §3.
 *
 * The ceremony itself is `@simplewebauthn/server`'s and is not re-tested here;
 * what is tested is the part that is this product's, which is also the part
 * that fails silently open if it is wrong: which origins count, which RP ID a
 * host produces, and whether a challenge can be spent twice.
 *
 * The last one is the one worth having. Replay is what a challenge exists to
 * prevent, and a "consume" written as a read followed by a write passes every
 * test that does not run two of them.
 */

import { PGlite } from '@electric-sql/pglite';
import { schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { deleteAccount, signIn } from '../src/accounts';
import type { Db } from '../src/db';
import {
  authenticationOptions,
  expectedOrigins,
  hasPasskey,
  registrationOptions,
  passkeyOwnerHasAccount,
  removePasskey,
  rpIdFor,
  staleChallenges,
  verifyAuthentication,
} from '../src/passkeys';

const MIGRATIONS = new URL('../../../packages/core/drizzle', import.meta.url).pathname;

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "passkey", "session", "webauthn_challenge"
    restart identity cascade
  `);
});

async function actor(kind: 'guest' | 'user' = 'guest') {
  const [row] = await db.insert(schema.actors).values({ kind }).returning();
  return row!.id;
}

// --- where a ceremony is allowed to happen -----------------------------------

describe('the RP ID a host produces', () => {
  it('is the apex for the apex and for www', () => {
    /*
     * A passkey is bound to one RP ID forever. Deriving `www` from
     * `www.parea.photos` would make a key registered there fail on the bare
     * domain — Face ID that works only if you typed the www.
     */
    expect(rpIdFor('parea.photos')).toBe('parea.photos');
    expect(rpIdFor('www.parea.photos')).toBe('parea.photos');
    expect(rpIdFor('PAREA.PHOTOS')).toBe('parea.photos');
  });

  it('is its own host anywhere else, which is what makes development work', () => {
    expect(rpIdFor('localhost:3000')).toBe('localhost');
    expect(rpIdFor('parea-git-branch.vercel.app')).toBe('parea-git-branch.vercel.app');
  });

  it('falls back to the apex rather than to an empty string', () => {
    // An empty RP ID is rejected by every authenticator, with an error that
    // says nothing about a missing Host header.
    expect(rpIdFor(null)).toBe('parea.photos');
    expect(rpIdFor('')).toBe('parea.photos');
  });
});

describe('the origins an assertion may come from', () => {
  it('always includes the site, on both of its names', () => {
    expect(expectedOrigins('parea.photos')).toContain('https://parea.photos');
    expect(expectedOrigins('parea.photos')).toContain('https://www.parea.photos');
  });

  it('does not add the host it was served on', () => {
    /*
     * This asserted the opposite, and the change is the point of the finding.
     * `Host` is a better value than `Origin` — what the request was routed on
     * rather than a claim about itself — but it is still the caller's string
     * arriving in an allowlist, defended by a sentence about how the platform
     * happens to be configured rather than by anything this code can check.
     */
    const origins = expectedOrigins('parea-git-branch.vercel.app');
    expect(origins).not.toContain('https://parea-git-branch.vercel.app');
    expect(origins).toEqual(['https://parea.photos', 'https://www.parea.photos']);
  });

  describe('a preview, declared by the platform rather than by the request', () => {
    const before = {
      url: process.env.VERCEL_URL,
      branch: process.env.VERCEL_BRANCH_URL,
    };
    afterEach(() => {
      for (const [key, value] of [
        ['VERCEL_URL', before.url],
        ['VERCEL_BRANCH_URL', before.branch],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    it('trusts what Vercel puts in the environment', () => {
      // The branch alias is the one that matters: a preview is opened on it far
      // more often than on the per-deployment hostname.
      process.env.VERCEL_BRANCH_URL = 'parea-web-git-branch-team.vercel.app';
      expect(expectedOrigins('parea-web-git-branch-team.vercel.app')).toContain(
        'https://parea-web-git-branch-team.vercel.app',
      );
    });

    it('still refuses a host the platform did not declare', () => {
      // The same request, with the platform naming a different deployment.
      process.env.VERCEL_URL = 'parea-abc123-team.vercel.app';
      const origins = expectedOrigins('parea-somebody-else.vercel.app');
      expect(origins).toContain('https://parea-abc123-team.vercel.app');
      expect(origins).not.toContain('https://parea-somebody-else.vercel.app');
    });
  });

  it('allows plaintext for localhost and nowhere else', () => {
    // WebAuthn requires a secure context, and treats localhost as one. Every
    // other host is https or it is not doing this at all. Read from `Host`
    // because a laptop has no platform to declare it, and safe to because the
    // value is pinned to two names that mean "this machine".
    expect(expectedOrigins('localhost:3000')).toContain('http://localhost:3000');
    expect(expectedOrigins('localhost:3000')).toContain('https://localhost:3000');
    expect(expectedOrigins('127.0.0.1:3000')).toContain('http://127.0.0.1:3000');
    expect(expectedOrigins('parea-git-branch.vercel.app')).not.toContain(
      'http://parea-git-branch.vercel.app',
    );
  });

  describe('a deployment on a domain this file has never heard of', () => {
    const before = process.env.PASSKEY_RP_ID;
    afterEach(() => {
      if (before === undefined) delete process.env.PASSKEY_RP_ID;
      else process.env.PASSKEY_RP_ID = before;
    });

    it('asserts from the domain its RP ID names', () => {
      // The override that decides the RP ID has to decide the origin too, or
      // it describes a deployment that can register and never verify.
      process.env.PASSKEY_RP_ID = 'photos.example';
      expect(expectedOrigins('photos.example')).toContain('https://photos.example');
    });
  });

  it('never contains a scheme and host the caller simply asserted', () => {
    /*
     * The whole reason this takes a host rather than an `Origin`. Adding the
     * request's claimed origin to its own allowlist hands the check to the
     * caller, and the check exists to establish where the ceremony happened.
     */
    expect(expectedOrigins('evil.example')).not.toContain('https://parea.photos.evil.example');
    const origins = expectedOrigins('parea.photos');
    expect(origins.every((origin) => origin.startsWith('https://') || origin.startsWith('android:'))).toBe(true);
  });

  describe('with an Android app configured', () => {
    const before = process.env.ANDROID_CERT_FINGERPRINTS;
    afterEach(() => {
      if (before === undefined) delete process.env.ANDROID_CERT_FINGERPRINTS;
      else process.env.ANDROID_CERT_FINGERPRINTS = before;
    });

    it('derives the apk-key-hash origin from the same fingerprint assetlinks uses', () => {
      // One piece of configuration, two files: an app whose links verify is an
      // app whose passkeys work.
      process.env.ANDROID_CERT_FINGERPRINTS = Array(32).fill('AB').join(':');
      const expected = Buffer.from('ab'.repeat(32), 'hex').toString('base64url');
      expect(expectedOrigins('parea.photos')).toContain(`android:apk-key-hash:${expected}`);
    });

    it('ignores a malformed one rather than inventing an origin', () => {
      process.env.ANDROID_CERT_FINGERPRINTS = 'not-a-fingerprint';
      expect(
        expectedOrigins('parea.photos').some((origin) => origin.startsWith('android:')),
      ).toBe(false);
    });
  });
});

// --- the challenge -----------------------------------------------------------

/**
 * A response shaped enough to reach the challenge lookup and no further.
 *
 * The signature is never checked in these tests because the challenge is spent
 * before the verifier is reached — which is itself the behaviour under test.
 */
function assertionCarrying(challenge: string) {
  const clientData = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge, origin: 'https://parea.photos' }),
  ).toString('base64url');
  return {
    id: 'unknown-key',
    rawId: 'unknown-key',
    type: 'public-key' as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: clientData,
      authenticatorData: '',
      signature: '',
    },
  };
}

describe('a challenge is spent once', () => {
  it('cannot be presented twice', async () => {
    const options = await authenticationOptions(db, 'parea.photos');

    // First use reaches past the challenge and fails on the key, which is as
    // far as a made-up credential id gets.
    const first = await verifyAuthentication(db, {
      response: assertionCarrying(options.challenge) as never,
      host: 'parea.photos',
    });
    expect(first).toEqual({ ok: false, reason: 'unknown_key' });

    /*
     * Second use does not get that far. This is the assertion the whole table
     * exists for: a captured response replayed against a still-outstanding
     * challenge is exactly what a challenge is supposed to stop.
     */
    const second = await verifyAuthentication(db, {
      response: assertionCarrying(options.challenge) as never,
      host: 'parea.photos',
    });
    expect(second).toEqual({ ok: false, reason: 'challenge' });
  });

  it('refuses one this server never issued', async () => {
    const outcome = await verifyAuthentication(db, {
      response: assertionCarrying('a-challenge-nobody-wrote-down') as never,
      host: 'parea.photos',
    });
    expect(outcome).toEqual({ ok: false, reason: 'challenge' });
  });

  it('refuses one that has expired', async () => {
    const options = await authenticationOptions(db, 'parea.photos');
    await db
      .update(schema.webauthnChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.webauthnChallenges.challenge, options.challenge));

    const outcome = await verifyAuthentication(db, {
      response: assertionCarrying(options.challenge) as never,
      host: 'parea.photos',
    });
    expect(outcome).toEqual({ ok: false, reason: 'challenge' });
  });

  it('refuses a registration challenge presented as an authentication', async () => {
    // The purpose is part of the lookup, so a challenge handed out for one
    // ceremony cannot be spent on the other.
    const me = await actor();
    await db.insert(schema.webauthnChallenges).values({
      challenge: 'for-registering',
      purpose: 'register',
      actorId: me,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const outcome = await verifyAuthentication(db, {
      response: assertionCarrying('for-registering') as never,
      host: 'parea.photos',
    });
    expect(outcome).toEqual({ ok: false, reason: 'challenge' });
  });

  it('is dropped by the purge job once it is stale', async () => {
    await authenticationOptions(db, 'parea.photos');
    await db
      .update(schema.webauthnChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) });

    const dropped = await db
      .delete(schema.webauthnChallenges)
      .where(staleChallenges(new Date()))
      .returning();
    expect(dropped).toHaveLength(1);
  });
});

describe('the options a sign-in is offered', () => {
  it('names no credentials, so nobody has to say who they are first', async () => {
    /*
     * An `allowCredentials` list would need an address to build, and the reply
     * would say whether that address has passkeys — the same question
     * `/api/account/code` refuses to answer.
     */
    const options = await authenticationOptions(db, 'parea.photos');
    expect(options.allowCredentials ?? []).toHaveLength(0);
  });

  it('requires the person to be verified, which is the Face ID part', async () => {
    // Without this a passkey is a bearer token in a keychain, and possession
    // of the laptop is possession of the account.
    const options = await authenticationOptions(db, 'parea.photos');
    expect(options.userVerification).toBe('required');
  });
});

/**
 * Which authenticator the browser is sent to.
 *
 * This shipped wrong. `authenticatorSelection` set `residentKey` and
 * `userVerification` and said nothing about attachment, so the browser showed
 * its whole chooser — a QR code, a security key, and the local device somewhere
 * among them — behind a button that said "Next time, sign in with Face ID". The
 * promised option was not the obvious one, and on some machines was not visibly
 * there at all.
 *
 * Asserted on the generated options rather than on the request shape, because
 * the failure was not an exception: every value was valid and the ceremony
 * worked. What was wrong was which sheet a person saw.
 */
describe('which authenticator the person is offered', () => {
  async function optionsFor(preferPlatform: boolean) {
    const me = await actor();
    await signIn(db, 'sam@example.com', me);
    const [account] = await db.select().from(schema.accounts);
    return registrationOptions(db, {
      actorId: me,
      accountId: account!.id,
      email: 'sam@example.com',
      displayName: null,
      host: 'parea.photos',
      preferPlatform,
    });
  }

  it('goes straight to Face ID when the device has it', async () => {
    const options = await optionsFor(true);
    // The pair that skips the menu. `hints` is what current browsers read and
    // `authenticatorAttachment` is what older ones do, and the library sets both.
    expect(options.hints).toEqual(['client-device']);
    expect(options.authenticatorSelection?.authenticatorAttachment).toBe('platform');
  });

  it('leaves the QR code available when it does not', async () => {
    /*
     * `platform` excludes rather than prefers, so pinning it on a desktop with
     * no reader turns a working QR-code flow into a hard failure. Signing into a
     * borrowed laptop with the passkey on your phone is a real feature, and this
     * is the request that keeps it.
     */
    const options = await optionsFor(false);
    expect(options.hints ?? []).toEqual([]);
    expect(options.authenticatorSelection?.authenticatorAttachment).toBeUndefined();
  });

  it('still requires a verified person and a discoverable key either way', async () => {
    for (const preferPlatform of [true, false]) {
      const options = await optionsFor(preferPlatform);
      expect(options.authenticatorSelection?.userVerification).toBe('required');
      expect(options.authenticatorSelection?.residentKey).toBe('required');
    }
  });
});

// --- the keys themselves -----------------------------------------------------

describe('a passkey and the account behind it', () => {
  it('will not sign anybody into an account that is gone', async () => {
    /*
     * `deleteAccount` removes the keys, and this is the belt to that braces:
     * a key that somehow outlived its account must not be a way into one that
     * no longer exists.
     */
    const me = await actor();
    await signIn(db, 'sam@example.com', me);
    expect(await passkeyOwnerHasAccount(db, me)).toBe(true);

    await deleteAccount(db, me);
    expect(await passkeyOwnerHasAccount(db, me)).toBe(false);
  });

  it('will not sign anybody in as an actor that was merged away', async () => {
    const phone = await actor();
    const laptop = await actor();
    await signIn(db, 'sam@example.com', laptop);
    await db
      .update(schema.actors)
      .set({ mergedIntoId: laptop })
      .where(eq(schema.actors.id, phone));

    expect(await passkeyOwnerHasAccount(db, phone)).toBe(false);
  });
});

describe('removing a passkey', () => {
  it('refuses one belonging to somebody else', async () => {
    const me = await actor();
    const them = await actor();
    const [theirs] = await db
      .insert(schema.passkeys)
      .values({ actorId: them, credentialId: 'key-1', publicKey: Buffer.from([1]) })
      .returning();

    // The same answer a made-up id gets.
    expect(await removePasskey(db, me, theirs!.id)).toBe(false);
    expect(await hasPasskey(db, them)).toBe(true);
  });

  it('allows removing the last one, because a code always works', async () => {
    /*
     * Refusing would be a product that can trap somebody: the key on a phone
     * they have just sold is the one they most need to remove.
     */
    const me = await actor();
    const [mine] = await db
      .insert(schema.passkeys)
      .values({ actorId: me, credentialId: 'key-1', publicKey: Buffer.from([1]) })
      .returning();

    expect(await removePasskey(db, me, mine!.id)).toBe(true);
    expect(await hasPasskey(db, me)).toBe(false);
  });

  it('will not let one authenticator be enrolled twice', async () => {
    // Globally unique, so a key already registered against another account
    // cannot be quietly re-pointed at this one.
    const me = await actor();
    const them = await actor();
    await db
      .insert(schema.passkeys)
      .values({ actorId: me, credentialId: 'shared', publicKey: Buffer.from([1]) });

    await expect(
      db
        .insert(schema.passkeys)
        .values({ actorId: them, credentialId: 'shared', publicKey: Buffer.from([2]) }),
    ).rejects.toThrow();
  });
});
