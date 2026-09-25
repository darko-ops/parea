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

  it('adds the host it was served on, so a preview works unconfigured', () => {
    expect(expectedOrigins('parea-git-branch.vercel.app')).toContain(
      'https://parea-git-branch.vercel.app',
    );
  });

  it('allows plaintext for localhost and nowhere else', () => {
    // WebAuthn requires a secure context, and treats localhost as one. Every
    // other host is https or it is not doing this at all.
    expect(expectedOrigins('localhost:3000')).toContain('http://localhost:3000');
    expect(expectedOrigins('parea-git-branch.vercel.app')).not.toContain(
      'http://parea-git-branch.vercel.app',
    );
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
