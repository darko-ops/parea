/**
 * Accounts, and the merge underneath them — design §3.
 *
 * An account here holds an email address and grants nothing an actor did not
 * already have. Almost all the risk is in one operation: folding two actors
 * into one when somebody signs in on a second device. Get that wrong and a
 * person owns some of their own photos, or a block silently stops applying,
 * and nothing errors — they find out months later.
 */

import { PGlite } from '@electric-sql/pglite';
import { groupSlug, handleProblem, newLinkToken, normaliseEmail, normaliseSignInCode, newSignInCode, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  MAX_CODE_ATTEMPTS,
  accountFor,
  consumeCode,
  deleteAccount,
  deleteEverything,
  ensureHandle,
  signIn,
  storeCode,
} from '../src/accounts';
import { cookiesToClear } from '../src/auth/cookies';
import type { Db } from '../src/db';
import { MERGED_TABLES, mergeActor, resolveActor } from '../src/merge';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);
const SECRET = 'test-secret';

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "code", "derivative", "device",
      "event", "event_participant", "group_join_request", "group_member",
      "groups", "observation", "photo", "rate_limit", "report",
      "safety_incident", "sign_in_code"
    restart identity cascade
  `);
});

async function actor(kind: 'guest' | 'user' = 'guest') {
  const [row] = await db.insert(schema.actors).values({ kind }).returning();
  return row!.id;
}

async function event(createdBy: string) {
  const [row] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy })
    .returning();
  return row!.id;
}

async function photo(eventId: string, uploaderId: string) {
  const [row] = await db
    .insert(schema.photos)
    .values({
      eventId,
      uploaderId,
      storageKey: `k-${Math.random()}`,
      byteSize: 1,
      mime: 'image/jpeg',
      status: 'ready',
    })
    .returning();
  return row!.id;
}

// --- the address ------------------------------------------------------------

describe('email normalisation', () => {
  it('folds case and trims, so one address is one account', () => {
    expect(normaliseEmail('  Sam@Example.COM ')).toBe('sam@example.com');
  });

  it('leaves dots and plus-tags alone', () => {
    // Those rules are one provider's. Applying them everywhere merges people
    // who are genuinely different — recoverable in one direction only.
    expect(normaliseEmail('a.b+party@example.com')).toBe('a.b+party@example.com');
  });

  it('refuses what is obviously not an address', () => {
    for (const bad of ['', 'sam', 'sam@', '@example.com', 'sam@example', 'a b@c.com']) {
      expect(normaliseEmail(bad), bad).toBeNull();
    }
  });
});

describe('the code itself', () => {
  it('is six digits', () => {
    for (let i = 0; i < 50; i++) expect(newSignInCode()).toMatch(/^\d{6}$/);
  });

  it('forgives the spacing a mail client adds', () => {
    expect(normaliseSignInCode(' 123 456 ')).toBe('123456');
    expect(normaliseSignInCode('123-456')).toBe('123456');
    expect(normaliseSignInCode('12345')).toBeNull();
    expect(normaliseSignInCode('1234567')).toBeNull();
  });
});

describe('presenting a code', () => {
  it('accepts the right one, once', async () => {
    await storeCode(db, SECRET, 'sam@example.com', '123456');
    expect(await consumeCode(db, SECRET, 'sam@example.com', '123456')).toEqual({
      ok: true,
      email: 'sam@example.com',
    });
    // Replay: a code in an inbox is a credential, and it has been spent.
    expect((await consumeCode(db, SECRET, 'sam@example.com', '123456')).ok).toBe(false);
  });

  it('is never stored in the clear', async () => {
    // Six digits is a space you can enumerate in microseconds, so an unkeyed
    // hash of one is the code. A read of this table must grant nothing.
    await storeCode(db, SECRET, 'sam@example.com', '123456');
    const [row] = await db.select().from(schema.signInCodes);
    expect(Buffer.from(row!.codeHash).toString('utf8')).not.toContain('123456');
    expect(row!.codeHash.length).toBe(32);
  });

  it('is keyed to the address it was sent to', async () => {
    await storeCode(db, SECRET, 'sam@example.com', '123456');
    expect((await consumeCode(db, SECRET, 'other@example.com', '123456')).ok).toBe(false);
  });

  it('stops after a handful of wrong guesses', async () => {
    await storeCode(db, SECRET, 'sam@example.com', '123456');
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      expect(await consumeCode(db, SECRET, 'sam@example.com', '000000')).toEqual({
        ok: false,
        reason: 'wrong',
      });
    }
    // And the right code no longer helps: the budget is per code, so asking
    // for a new one is the only way forward — which resets nothing an
    // attacker controls.
    expect(await consumeCode(db, SECRET, 'sam@example.com', '123456')).toEqual({
      ok: false,
      reason: 'too_many',
    });
  });

  it('expires', async () => {
    const past = new Date(Date.now() - 60 * 60_000);
    await storeCode(db, SECRET, 'sam@example.com', '123456', past);
    expect(await consumeCode(db, SECRET, 'sam@example.com', '123456')).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('only honours the newest, so asking again invalidates the last', async () => {
    // Otherwise every request widens the window instead of refreshing it, and
    // three requests means three live secrets in an inbox.
    await storeCode(db, SECRET, 'sam@example.com', '111111');
    await new Promise((r) => setTimeout(r, 5));
    await storeCode(db, SECRET, 'sam@example.com', '222222');

    expect((await consumeCode(db, SECRET, 'sam@example.com', '111111')).ok).toBe(false);
    expect((await consumeCode(db, SECRET, 'sam@example.com', '222222')).ok).toBe(true);
  });
});

// --- signing in --------------------------------------------------------------

describe('claiming an account', () => {
  it('keeps the actor and moves nothing, the first time', async () => {
    // §3: "claiming an account sets account_id; nothing else moves."
    const me = await actor();
    const id = await event(me);
    await photo(id, me);

    const result = await signIn(db, 'sam@example.com', me);

    expect(result).toMatchObject({ actorId: me, merged: false });
    // A name and a picture are still something else, and stay null: they are
    // things about a person, and nothing here has met one.
    //
    // The handle is the exception, and it is a deliberate one. §3's "nothing
    // else moves" was written when a handle was a field on a form, and an
    // empty field labelled "Handle" is homework at the door that most people
    // skip — leaving the accounts that skipped it with nothing to show beside
    // a name. So it is issued here rather than asked for.
    expect(await accountFor(db, me)).toMatchObject({
      email: 'sam@example.com',
      displayName: null,
      avatarUrl: null,
    });
    const [row] = await db.select().from(schema.actors).where(eq(schema.actors.id, me));
    expect(row!.kind).toBe('user');
  });

  it('is idempotent on the same device', async () => {
    const me = await actor();
    await signIn(db, 'sam@example.com', me);
    expect(await signIn(db, 'sam@example.com', me)).toMatchObject({ merged: false });
  });

  it('folds a second device into the first', async () => {
    // The whole reason accounts exist here: a new phone should still be you.
    const laptop = await actor();
    await signIn(db, 'sam@example.com', laptop);

    const phone = await actor();
    const id = await event(phone);
    await photo(id, phone);

    const result = await signIn(db, 'sam@example.com', phone);

    expect(result).toMatchObject({ actorId: laptop, merged: true });
    const [p] = await db.select().from(schema.photos);
    expect(p!.uploaderId, 'the phone’s photos are now the account’s').toBe(laptop);
  });

  it('adopts an account whose actor is gone', async () => {
    const gone = await actor();
    await signIn(db, 'sam@example.com', gone);
    await db.delete(schema.actors).where(eq(schema.actors.id, gone));

    const fresh = await actor();
    expect(await signIn(db, 'sam@example.com', fresh)).toMatchObject({ actorId: fresh });
  });
});

// --- the handle you did not ask for -------------------------------------------

describe('everyone leaves sign-in with a handle', () => {
  const handleOf = async (actorId: string) => {
    const [row] = await db
      .select({ handle: schema.actors.handle })
      .from(schema.actors)
      .where(eq(schema.actors.id, actorId));
    return row!.handle;
  };

  it('issues one, and a legal one', async () => {
    const me = await actor();
    await signIn(db, 'sam@example.com', me);

    const handle = await handleOf(me);
    expect(handle).toBeTruthy();
    // Generated by a different function from the one that validates, and the
    // lists are edited by hand — so the two can disagree.
    expect(handleProblem(handle!), handle!).toBeNull();
  });

  it('keeps its capitals', async () => {
    // The reason the unique index moved to `lower(handle)`. Folded on the way
    // in, `HairyTallLarry` is stored as three `l`s in a row and the three
    // words stop being readable as words.
    const me = await actor();
    await signIn(db, 'sam@example.com', me);
    expect(await handleOf(me)).toMatch(/^[A-Z][a-z]+[A-Z][a-z]+[A-Z][a-z]+$/);
  });

  it('does not reroll it on the next sign-in', async () => {
    // `ensureHandle` runs on every sign-in, not only the first. A handle that
    // changed each time you signed in would not be a name.
    const me = await actor();
    await signIn(db, 'sam@example.com', me);
    const first = await handleOf(me);

    await signIn(db, 'sam@example.com', me);
    expect(await handleOf(me)).toBe(first);
  });

  it('never overwrites one somebody chose', async () => {
    const me = await actor();
    await signIn(db, 'sam@example.com', me);
    await db
      .update(schema.actors)
      .set({ handle: 'SamJones' })
      .where(eq(schema.actors.id, me));

    await signIn(db, 'sam@example.com', me);
    expect(await handleOf(me)).toBe('SamJones');
  });

  it('backfills an account that predates the generator', async () => {
    // Every account that existed before this shipped has a null handle, and
    // none of them will visit a form to fix that. The next sign-in does it.
    const me = await actor();
    await signIn(db, 'sam@example.com', me);
    await db.update(schema.actors).set({ handle: null }).where(eq(schema.actors.id, me));

    await signIn(db, 'sam@example.com', me);
    expect(await handleOf(me)).toBeTruthy();
  });

  it('leaves the surviving actor’s handle alone across a merge', async () => {
    // The branch easiest to get wrong: the actor that arrived is folded away,
    // and the handle belongs to the one that won.
    const laptop = await actor();
    await signIn(db, 'sam@example.com', laptop);
    const kept = await handleOf(laptop);

    const phone = await actor();
    const result = await signIn(db, 'sam@example.com', phone);

    expect(result).toMatchObject({ actorId: laptop, merged: true });
    expect(await handleOf(laptop)).toBe(kept);
  });

  it('is decided by the index, not by the check in front of it', async () => {
    // `ensureHandle` catches a unique violation and tries another name. If the
    // index were still on the raw column that violation would never arrive for
    // a difference of case, and two accounts would answer to `samjones`.
    const a = await actor();
    const b = await actor();
    await db.update(schema.actors).set({ handle: 'SamJones' }).where(eq(schema.actors.id, a));

    await expect(
      db.update(schema.actors).set({ handle: 'samjones' }).where(eq(schema.actors.id, b)),
    ).rejects.toThrow();
  });

  it('gives up rather than failing a sign-in it cannot name', async () => {
    // Eight collisions in a row is not a reason someone cannot sign in. The
    // row keeps its null handle and the next sign-in tries again.
    const me = await actor();
    await db.insert(schema.accounts).values({ email: 'x@example.com' });
    await expect(ensureHandle(db, me)).resolves.not.toThrow();
  });
});

// --- the merge ---------------------------------------------------------------

describe('merging two actors', () => {
  it('moves everything owned', async () => {
    const from = await actor();
    const into = await actor();
    const id = await event(from);
    await photo(id, from);
    await db.insert(schema.devices).values({ actorId: from, platform: 'ios' });

    await mergeActor(db, from, into);

    const [p] = await db.select().from(schema.photos);
    const [e] = await db.select().from(schema.events);
    const [d] = await db.select().from(schema.devices);
    expect(p!.uploaderId).toBe(into);
    expect(e!.createdBy).toBe(into);
    expect(d!.actorId).toBe(into);
  });

  it('does not trip over a relationship both actors already had', async () => {
    // Both at the same party, both in the same group. The composite keys make
    // a naive UPDATE fail on the constraint.
    const from = await actor();
    const into = await actor();
    const id = await event(into);
    await db
      .insert(schema.eventParticipants)
      .values([{ eventId: id, actorId: from }, { eventId: id, actorId: into }]);
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'Climbing', slug: groupSlug('Climbing') })
      .returning();
    await db.insert(schema.groupMembers).values([
      { groupId: group!.id, actorId: from },
      { groupId: group!.id, actorId: into },
    ]);

    await mergeActor(db, from, into);

    expect(await db.select().from(schema.eventParticipants)).toHaveLength(1);
    expect(await db.select().from(schema.groupMembers)).toHaveLength(1);
  });

  it('keeps the survivor’s role rather than the loser’s', async () => {
    const from = await actor();
    const into = await actor();
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'Climbing', slug: groupSlug('Climbing') })
      .returning();
    await db.insert(schema.groupMembers).values([
      { groupId: group!.id, actorId: from, role: 'member' },
      { groupId: group!.id, actorId: into, role: 'admin' },
    ]);

    await mergeActor(db, from, into);

    const [row] = await db.select().from(schema.groupMembers);
    expect(row!.role).toBe('admin');
  });

  it('does not leave someone blocking themselves', async () => {
    // A blocked B; A and B turn out to be one person. Nothing else in the
    // product can produce a self-block, and the visibility predicate would
    // honour it — someone's own photos would vanish for them.
    const from = await actor();
    const into = await actor();
    await db
      .insert(schema.blocks)
      .values({ blockerActorId: into, blockedActorId: from });

    await mergeActor(db, from, into);

    expect(await db.select().from(schema.blocks)).toHaveLength(0);
  });

  it('leaves the old id working, because a phone still holds its token', async () => {
    const from = await actor();
    const into = await actor();
    await mergeActor(db, from, into);

    expect(await resolveActor(db, from)).toBe(into);
    expect(await resolveActor(db, into)).toBe(into);
  });

  it('does not grow a chain when a third device signs in', async () => {
    const first = await actor();
    const second = await actor();
    const third = await actor();
    await mergeActor(db, first, second);
    await mergeActor(db, second, third);

    // One hop from anywhere, so resolution is bounded no matter how many
    // devices someone has had.
    expect(await resolveActor(db, first)).toBe(third);
    const [row] = await db.select().from(schema.actors).where(eq(schema.actors.id, first));
    expect(row!.mergedIntoId).toBe(third);
  });

  it('does nothing when asked to merge an actor into itself', async () => {
    const me = await actor();
    expect(await mergeActor(db, me, me)).toEqual({ into: me, merged: [] });
  });

  it('leaves safety evidence pointing at who actually uploaded', async () => {
    // `safety_incident.uploader_actor_id` has no foreign key on purpose: it
    // records who uploaded a thing at the time, under a preservation duty
    // (§13). Rewriting it to match a later account change edits evidence.
    const from = await actor();
    const into = await actor();
    const id = await event(from);
    const photoId = await photo(id, from);
    await db.insert(schema.safetyIncidents).values({
      photoId,
      eventId: id,
      uploaderActorId: from,
      provider: 'test',
      classification: 'csam',
      storageKey: 'k',
      contentHash: Buffer.alloc(32),
    });

    await mergeActor(db, from, into);

    const [incident] = await db.select().from(schema.safetyIncidents);
    expect(incident!.uploaderActorId).toBe(from);
  });
});

describe('the list of things a merge moves', () => {
  it('covers every actor reference in the schema', async () => {
    // The failure of an incomplete merge is silent: a table nobody listed
    // keeps pointing at the old actor, and someone notices months later when
    // half their photos are not theirs. So the list is checked against the
    // schema rather than maintained by memory.
    const source = readFileSync(
      fileURLToPath(new URL('../../../packages/core/src/schema.ts', import.meta.url)),
      'utf8',
    );

    const tables = [...source.matchAll(/pgTable\(\s*\n?\s*'(\w+)'/g)].map((m) => ({
      name: m[1]!,
      start: m.index!,
    }));
    const found = new Set<string>();
    for (const [i, table] of tables.entries()) {
      const body = source.slice(table.start, tables[i + 1]?.start ?? source.length);
      for (const m of body.matchAll(/(\w+): uuid\('(\w+)'\)([\s\S]{0,200}?)(?=\n\s+\w+:|\n\s*\}|$)/g)) {
        if (m[3]!.includes('actors.id')) found.add(`${table.name}.${m[2]}`);
      }
    }

    const handled = new Set(MERGED_TABLES.map((t) => `${t.table}.${t.column}`));
    // `actor.merged_into_id` is the pointer itself, handled separately.
    handled.add('actor.merged_into_id');
    handled.add('actor.account_id');

    expect([...found].filter((ref) => !handled.has(ref)).sort()).toEqual([]);
    expect(found.size, 'the extractor found nothing, which is not a pass').toBeGreaterThan(8);
  });
});

// --- deleting ----------------------------------------------------------------

describe('deleting an account', () => {
  it('removes the address and the link, and leaves the person a guest', async () => {
    // Guideline 5.1.1(v) requires this to exist in the app at all.
    const me = await actor();
    await signIn(db, 'sam@example.com', me);

    expect(await deleteAccount(db, me)).toBe(true);
    expect(await db.select().from(schema.accounts)).toHaveLength(0);
    const [row] = await db.select().from(schema.actors).where(eq(schema.actors.id, me));
    expect(row!.kind).toBe('guest');
    expect(row!.accountId).toBeNull();
  });

  it('keeps their uploads, which are in other people’s events', async () => {
    // Deleting an account must not quietly take away other people's copies of
    // an evening they were also at. Removing the photos is a separate,
    // explicit action offered beside it.
    const me = await actor();
    const id = await event(me);
    await photo(id, me);
    await signIn(db, 'sam@example.com', me);

    await deleteAccount(db, me);

    const [p] = await db.select().from(schema.photos);
    expect(p!.deletedAt).toBeNull();
    expect(p!.uploaderId, 'and they are still theirs to remove').toBe(me);
  });

  it('removes everything when that is what was asked for', async () => {
    const me = await actor();
    const id = await event(me);
    await photo(id, me);
    await photo(id, me);

    expect(await deleteEverything(db, me)).toBe(2);
    const rows = await db.select().from(schema.photos);
    expect(rows.every((p) => p.deletedAt !== null)).toBe(true);
  });

  it('says nothing happened for someone with no account', async () => {
    expect(await deleteAccount(db, await actor())).toBe(false);
  });
});

/**
 * Staying signed in.
 *
 * The cookie was already long-lived, so the failure this guards is subtler
 * than "it expires": the clock started when the browser first touched the
 * product rather than when someone last proved who they were, and the value
 * named the actor from before the merge rather than the one the account
 * resolves to.
 */
describe('the session outlives the visit', () => {
  const cookies = readFileSync(
    fileURLToPath(new URL('../src/auth/cookies.ts', import.meta.url)),
    'utf8',
  );
  const session = readFileSync(
    fileURLToPath(new URL('../src/session.ts', import.meta.url)),
    'utf8',
  );
  const route = readFileSync(
    fileURLToPath(new URL('../app/api/account/session/route.ts', import.meta.url)),
    'utf8',
  );

  it('is not a session cookie', () => {
    // Without `maxAge` the browser drops it when the window closes, which is
    // the difference between an account and a visit.
    expect(session).toMatch(/maxAge: ACTOR_COOKIE_MAX_AGE/);
    expect(cookies).toMatch(/ACTOR_COOKIE_MAX_AGE\s*=\s*400 \* 24 \* 60 \* 60/);
  });

  it('stays out of reach of a script', () => {
    // It names a person now rather than a throwaway guest, and it survives
    // clearing site data on the native side.
    expect(cookies).toMatch(/httpOnly: true/);
    expect(cookies).toMatch(/secure: process\.env\.NODE_ENV === 'production'/);
  });

  it('is re-issued when someone signs in', () => {
    expect(route).toMatch(/issueActorCookie\(result\.actorId\)/);
  });

  it('re-issues the actor the account resolves to, not the one that arrived', () => {
    // `signIn` can fold this browser's actor into the account's canonical one.
    // Writing back the id we came in with leaves the cookie naming a merged
    // actor forever, resolved on every request by a pointer that only has to
    // be tidied once.
    expect(route).not.toMatch(/issueActorCookie\(actorId\)/);
  });
});

/**
 * Signing out, and the half of it that is easy to forget.
 *
 * Identity is one cookie; access to the photographs is a different set of
 * them, one per event this browser has ever opened a link to. Clearing only
 * the first looks completely correct — the name goes, the events list empties,
 * the page says signed out — and leaves every event this person opened still
 * openable by whoever sits down next. On a shared computer that is the exact
 * situation the button was pressed to avoid.
 */
describe('signing out gives back everything, not just the name', () => {
  it('takes identity and every capability with it', () => {
    expect(
      cookiesToClear([
        'pa_actor',
        'pa_cap_11111111-1111-1111-1111-111111111111',
        'pa_cap_22222222-2222-2222-2222-222222222222',
      ]),
    ).toEqual([
      'pa_actor',
      'pa_cap_11111111-1111-1111-1111-111111111111',
      'pa_cap_22222222-2222-2222-2222-222222222222',
    ]);
  });

  it('leaves alone what is not ours to take', () => {
    // A button labelled "Sign out" that also cleared, say, a theme choice is
    // doing something nobody asked it to.
    expect(cookiesToClear(['pa_actor', 'theme', '_vercel_jwt'])).toEqual(['pa_actor']);
  });

  it('is nothing to do for a browser that was never anybody', () => {
    expect(cookiesToClear([])).toEqual([]);
    expect(cookiesToClear(['theme'])).toEqual([]);
  });

  it('names the capability prefix once, where the cookie is named', () => {
    // The names are the only record of which events this browser holds — there
    // is no list of them server-side — so a second literal of `pa_cap_` is a
    // rename away from a sign-out that quietly keeps them.
    const session = readFileSync(
      fileURLToPath(new URL('../src/session.ts', import.meta.url)),
      'utf8',
    );
    expect(session).not.toMatch(/'pa_cap_/);
    expect(session).toMatch(/cookiesToClear\(/);
  });
});

describe('one place to change a profile', () => {
  const you = readFileSync(
    fileURLToPath(new URL('../app/components/AccountView.tsx', import.meta.url)),
    'utf8',
  );
  const edit = readFileSync(
    fileURLToPath(new URL('../app/components/EditProfile.tsx', import.meta.url)),
    'utf8',
  );

  it('shows the profile without offering to change it', () => {
    // The name was an input here *and* an input inside Edit profile, and the
    // handle was a "Pick a handle" link that went to the same screen the
    // button beside it goes to. Both are read-only now: the page a person
    // lands on says who they are, and one button says where that is changed.
    expect(you).not.toMatch(/<input/);
    expect(you).toMatch(/setView\('profile'\)/);
  });

  it('does not write to the account from the page that displays it', () => {
    // A second writer is how the two drift: this one saved on blur and only
    // patched its own copy of the account, so the value shown after an edit
    // depended on which screen last touched it.
    expect(you).not.toMatch(/method: 'PATCH'/);
    expect(edit).toMatch(/method: 'PATCH'/);
  });
});
