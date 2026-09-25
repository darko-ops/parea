/**
 * Sessions, and the revocation they exist for — design §3.
 *
 * This feature reverses a decision, and the reversal is the risk. The old
 * credential was self-authenticating: verify the signature and you had an
 * actor, with no row to consult and nothing that could say no. Everything here
 * exists because there is now something that can say no, and the ways it can
 * fail are all quiet ones — a revoked session that keeps working, a merge that
 * strands the row a phone resolves through, a credential shape that stops
 * being readable and signs out everybody at once.
 */

import { PGlite } from '@electric-sql/pglite';
import { clientLabel, describeClient, newLinkToken, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { deleteAccount, signIn } from '../src/accounts';
import { decodeCredential, encodeCredential } from '../src/auth/cookies';
import type { Db } from '../src/db';
import { mergeActor } from '../src/merge';
import {
  adoptSession,
  listSessions,
  resolveSession,
  revokeOtherSessions,
  revokeSession,
  startSession,
  staleSessions,
} from '../src/sessions';

const MIGRATIONS = new URL('../../../packages/core/drizzle', import.meta.url).pathname;

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "event", "passkey", "photo", "session",
      "sign_in_code", "webauthn_challenge"
    restart identity cascade
  `);
});

async function actor(kind: 'guest' | 'user' = 'guest') {
  const [row] = await db.insert(schema.actors).values({ kind }).returning();
  return row!.id;
}

const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// --- the credential ----------------------------------------------------------

/**
 * The shape in the cookie, and the one still in keychains.
 *
 * Every browser and every phone signed in on the day this shipped is carrying
 * a credential with no session id in it. Refusing those would have signed out
 * the entire userbase to add a screen listing who is signed in, which is a
 * trade nobody would take.
 */
describe('what a credential says', () => {
  it('carries the actor and the session, and reads them back', () => {
    const encoded = encodeCredential({ actorId: 'actor-1', sessionId: 'session-1' });
    expect(decodeCredential(encoded)).toEqual({
      actorId: 'actor-1',
      sessionId: 'session-1',
    });
  });

  it('still reads one from before sessions existed', () => {
    // A bare signed actor id, which is exactly what the old `sign(actorId)`
    // produced. It has to keep working.
    const legacy = encodeCredential({ actorId: 'actor-1', sessionId: null });
    expect(decodeCredential(legacy)).toEqual({ actorId: 'actor-1', sessionId: null });
  });

  it('refuses one that has been tampered with', () => {
    const encoded = encodeCredential({ actorId: 'actor-1', sessionId: 'session-1' });
    // Swapping in another session id under the same signature. The pair is
    // signed as one string precisely so this cannot be done.
    const swapped = encoded.replace('session-1', 'session-2');
    expect(decodeCredential(swapped)).toBeNull();
  });

  it('refuses a half-written one', () => {
    expect(decodeCredential(undefined)).toBeNull();
    expect(decodeCredential('nonsense')).toBeNull();
  });
});

// --- resolving ---------------------------------------------------------------

describe('resolving a session', () => {
  it('answers with the actor it belongs to', async () => {
    const me = await actor();
    const session = await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: SAFARI_IPHONE,
      method: 'code',
    });
    expect(await resolveSession(db, session.id)).toEqual({ actorId: me });
  });

  it('answers with nothing once it is revoked', async () => {
    const me = await actor();
    const session = await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: SAFARI_IPHONE,
      method: 'code',
    });

    expect(await revokeSession(db, me, session.id)).toBe(true);
    // The credential still verifies perfectly. The row is what says no, and
    // this is the entire point of the row.
    expect(await resolveSession(db, session.id)).toBeNull();
  });

  it('answers with nothing for a session that never existed', async () => {
    expect(await resolveSession(db, crypto.randomUUID())).toBeNull();
  });

  it('moves last-seen forward, but not on every request', async () => {
    const me = await actor();
    const session = await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'code',
    });

    const read = async () => {
      const [row] = await db
        .select({ at: schema.sessions.lastSeenAt })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, session.id));
      return row!.at.getTime();
    };

    const fresh = await read();
    await resolveSession(db, session.id);
    // Inside the throttle window, so the statement matched nothing. Without
    // this the product does a write in front of every read it serves.
    expect(await read()).toBe(fresh);

    // Pushed back past the window, and the next resolve moves it.
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(schema.sessions.id, session.id));
    await resolveSession(db, session.id);
    expect(await read()).toBeGreaterThan(Date.now() - 60 * 1000);
  });
});

// --- the list ----------------------------------------------------------------

describe('the list of where you are signed in', () => {
  it('marks the one asking, and names what the others are', async () => {
    const me = await actor();
    const here = await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'code',
    });
    await startSession(db, {
      actorId: me,
      kind: 'ios',
      userAgent: null,
      method: 'passkey',
    });

    const listed = await listSessions(db, me, here.id);
    expect(listed).toHaveLength(2);

    const current = listed.find((row) => row.current);
    expect(current?.label).toBe('Chrome on macOS');
    expect(listed.find((row) => !row.current)?.label).toBe('Parea for iOS');
  });

  it('leaves out the ones that have been signed out', async () => {
    const me = await actor();
    const gone = await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'code',
    });
    await revokeSession(db, me, gone.id);
    expect(await listSessions(db, me, null)).toHaveLength(0);
  });

  it('includes a browser that never signed in itself', async () => {
    /*
     * A guest session folded in by a sign-in elsewhere. It can delete this
     * person's photographs, so leaving it off a list headed "where you are
     * signed in" would be the one omission that matters.
     */
    const me = await actor();
    await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: SAFARI_IPHONE,
      method: 'guest',
    });
    const [listed] = await listSessions(db, me, null);
    expect(listed?.method).toBe('guest');
  });
});

describe('ending a session', () => {
  it('refuses one belonging to somebody else', async () => {
    const me = await actor();
    const them = await actor();
    const theirs = await startSession(db, {
      actorId: them,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'code',
    });

    // The same answer a made-up id gets, which is what keeps this from being a
    // way to ask whether a session id exists.
    expect(await revokeSession(db, me, theirs.id)).toBe(false);
    expect(await resolveSession(db, theirs.id)).toEqual({ actorId: them });
  });

  it('signs out everywhere else and leaves this one alone', async () => {
    const me = await actor();
    const here = await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'code',
    });
    const laptop = await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: SAFARI_IPHONE,
      method: 'code',
    });
    const phone = await startSession(db, {
      actorId: me,
      kind: 'ios',
      userAgent: null,
      method: 'passkey',
    });

    expect(await revokeOtherSessions(db, me, here.id)).toBe(2);
    // The page the button was pressed on still works, which is what makes it
    // pressable at all.
    expect(await resolveSession(db, here.id)).toEqual({ actorId: me });
    expect(await resolveSession(db, laptop.id)).toBeNull();
    expect(await resolveSession(db, phone.id)).toBeNull();
  });

  it('does not reach into another account', async () => {
    const me = await actor();
    const them = await actor();
    const theirs = await startSession(db, {
      actorId: them,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'code',
    });
    await startSession(db, { actorId: me, kind: 'browser', userAgent: null, method: 'code' });

    await revokeOtherSessions(db, me, null);
    expect(await resolveSession(db, theirs.id)).toEqual({ actorId: them });
  });
});

describe('signing in on a browser that was already here', () => {
  it('keeps the one row and relabels it', async () => {
    /*
     * Minting instead would leave two rows for one laptop on the Devices
     * screen, only one of which will ever be used again, with nothing on
     * either to say which.
     */
    const guest = await actor();
    const session = await startSession(db, {
      actorId: guest,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'guest',
    });

    expect(await adoptSession(db, session.id, guest, 'passkey')).toBe(true);
    const [listed] = await listSessions(db, guest, session.id);
    expect(listed?.method).toBe('passkey');
    expect(await listSessions(db, guest, null)).toHaveLength(1);
  });

  it('refuses to resurrect one that was signed out', async () => {
    // Somebody signing in again on a device that was revoked from elsewhere
    // gets a new session, not the old one back.
    const me = await actor();
    const session = await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'code',
    });
    await revokeSession(db, me, session.id);
    expect(await adoptSession(db, session.id, me, 'code')).toBe(false);
  });
});

// --- the merge ---------------------------------------------------------------

/**
 * The failure this guards is the worst one available here.
 *
 * `currentCredential` resolves a live credential *through* the session row. A
 * merge that left the row pointing at the tombstoned actor would mean signing
 * in on a laptop silently signs you out on the phone in your hand — and the
 * phone has no way to explain it, because its credential still verifies.
 */
describe('a merge and the devices either side of it', () => {
  it('moves the sessions, so both devices keep working', async () => {
    const phone = await actor();
    const laptop = await actor();
    const onPhone = await startSession(db, {
      actorId: phone,
      kind: 'ios',
      userAgent: null,
      method: 'code',
    });
    const onLaptop = await startSession(db, {
      actorId: laptop,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'code',
    });

    await mergeActor(db, phone, laptop);

    expect(await resolveSession(db, onPhone.id)).toEqual({ actorId: laptop });
    expect(await resolveSession(db, onLaptop.id)).toEqual({ actorId: laptop });
    // And they are one person's list now, not two.
    expect(await listSessions(db, laptop, onLaptop.id)).toHaveLength(2);
  });

  it('moves the passkeys with them', async () => {
    const phone = await actor();
    const laptop = await actor();
    await db.insert(schema.passkeys).values({
      actorId: phone,
      credentialId: 'key-1',
      publicKey: Buffer.from([1, 2, 3]),
    });

    await mergeActor(db, phone, laptop);

    const [key] = await db.select().from(schema.passkeys);
    // Dropping it would take away the Face ID sign-in on a phone whose owner
    // had just proved, by signing in, that it is theirs.
    expect(key!.actorId).toBe(laptop);
  });
});

// --- deleting ----------------------------------------------------------------

describe('deleting an account', () => {
  it('takes the passkeys with it', async () => {
    /*
     * The actor survives as a guest on purpose, so nothing else would remove
     * them: they would sit there pointing at a guest, and the next person to
     * claim the address would be offered a Face ID prompt belonging to
     * somebody who closed their account.
     */
    const me = await actor();
    await signIn(db, 'sam@example.com', me);
    await db.insert(schema.passkeys).values({
      actorId: me,
      credentialId: 'key-1',
      publicKey: Buffer.from([1, 2, 3]),
    });

    expect(await deleteAccount(db, me)).toBe(true);
    expect(await db.select().from(schema.passkeys)).toHaveLength(0);
  });
});

// --- tidying -----------------------------------------------------------------

describe('what the purge job drops', () => {
  it('keeps a freshly revoked row, so the screen can show it worked', async () => {
    const now = new Date();
    const me = await actor();
    const session = await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'code',
    });
    await revokeSession(db, me, session.id);

    const dropped = await db.delete(schema.sessions).where(staleSessions(now)).returning();
    expect(dropped).toHaveLength(0);
  });

  it('drops one revoked long enough ago', async () => {
    const me = await actor();
    const session = await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'code',
    });
    await db
      .update(schema.sessions)
      .set({ revokedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.sessions.id, session.id));

    const dropped = await db
      .delete(schema.sessions)
      .where(staleSessions(new Date()))
      .returning();
    expect(dropped).toHaveLength(1);
  });

  it('does not drop a live one that is simply old', async () => {
    // Retention is longer than the cookie on purpose: a row removed while its
    // credential still verifies is a person signed out with no explanation.
    const me = await actor();
    await startSession(db, {
      actorId: me,
      kind: 'browser',
      userAgent: CHROME_MAC,
      method: 'code',
    });
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: new Date(Date.now() - 300 * 24 * 60 * 60 * 1000) });

    const dropped = await db
      .delete(schema.sessions)
      .where(staleSessions(new Date()))
      .returning();
    expect(dropped).toHaveLength(0);
  });
});

// --- what the row is called --------------------------------------------------

describe('naming a device', () => {
  it('reads the browser and the thing it is running on', () => {
    expect(clientLabel(describeClient(SAFARI_IPHONE))).toBe('Safari on iPhone');
    expect(clientLabel(describeClient(CHROME_MAC))).toBe('Chrome on macOS');
  });

  it('does not let Chromium browsers all report as Safari', () => {
    // Every one of these carries `Safari/` and most carry `Chrome/` too, so
    // the order the patterns are tested in is the whole correctness argument.
    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
    expect(clientLabel(describeClient(edge))).toBe('Edge on Windows');

    const criOS =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.0.0 Mobile/15E148 Safari/604.1';
    expect(clientLabel(describeClient(criOS))).toBe('Chrome on iPhone');
  });

  it('admits when it does not know', () => {
    // A row claiming to be an iPhone and not being one is worse than one that
    // says nothing: the use of the screen is spotting the row that is not
    // yours.
    expect(clientLabel(describeClient('curl/8.4.0'))).toBe('A browser');
    expect(clientLabel(describeClient(null))).toBe('A browser');
  });

  it('takes the app at its word rather than reading a string', () => {
    expect(clientLabel(describeClient(null, 'ios'))).toBe('Parea for iOS');
    expect(clientLabel(describeClient(SAFARI_IPHONE, 'android'))).toBe('Parea for Android');
  });
});
