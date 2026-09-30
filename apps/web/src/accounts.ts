/**
 * Accounts — design §3.
 *
 * "Optional, asked for only after value has been delivered." An account exists
 * so that a person is still themselves on a new phone, which is the one thing
 * a device-bound identity cannot do. It grants nothing an actor does not
 * already have.
 *
 * It carries an email address, a handle issued at sign-in, and whatever
 * display name and picture someone chooses to add. It used to be the address
 * alone, and three places still said so long after it stopped being true —
 * including the privacy policy. The list is here because this is the module
 * that owns it.
 *
 * The surface started as three verbs — ask for a code, present one, delete the
 * account — and the third is not optional: App Store Guideline 5.1.1(v)
 * requires an app that creates accounts to delete them in-app.
 *
 * Two more have joined them and neither lives in this file. A passkey is a
 * second way of *proving* an account rather than a second kind of account, so it
 * is `passkeys.ts`; where somebody is signed in is a property of the credential
 * rather than of the account, so it is `sessions.ts`. Both converge here: a
 * passkey sign-in resolves to an address and comes through `signIn` exactly as a
 * code does, because the merge underneath is the one thing in this system whose
 * incomplete version is silent.
 */

import { generateHandle, normaliseEmail, recordModeration, REASON, schema } from '@parea/core';

import { getStorage } from './storage';
import { and, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { Db } from './db';
import { mergeActor } from './merge';
import { revokePhotoLinks } from './revoke';

/** Long enough to find the mail, short enough that a leaked one is stale. */
export const CODE_TTL_MS = 10 * 60_000;
/** Six digits is a million; without a ceiling that is a few hours of guessing. */
export const MAX_CODE_ATTEMPTS = 5;

/**
 * Stored as an HMAC, never in the clear.
 *
 * A read of this table should grant nothing. Keyed rather than plain-hashed
 * because six digits is a space you can enumerate in microseconds — an
 * unkeyed hash of a six-digit code is the code.
 */
function hashCode(secret: string, email: string, code: string): Buffer {
  return createHmac('sha256', secret).update(`${email}:${code}`).digest();
}

export async function storeCode(
  db: Db,
  secret: string,
  email: string,
  code: string,
  now = new Date(),
): Promise<void> {
  /*
   * Asking again retires the last code. It does not add a second one.
   *
   * `consumeCode` wanted "the newest outstanding code for this address" and got
   * it by ordering on `created_at`, which is not a total order: the column
   * defaults to `now()`, and `now()` in Postgres is the *transaction* timestamp,
   * so two rows written close enough together tie and the tiebreak is whatever
   * the planner felt like. Its own doc said asking again "should invalidate the
   * previous one", and nothing did — a sort is a guess about which row is
   * newest, not an act that retires the other.
   *
   * What the guess costs when it goes wrong: the code in somebody's inbox is not
   * the one that works, and the screen tells them it did not work and that codes
   * expire after ten minutes. So they ask for another, from a mail budget of five
   * an hour per address.
   *
   * The phone twin of this is `startVerification`, where the same tie decided
   * which number somebody had just proved. Same shape, same fix.
   *
   * In a transaction, because the two halves are one act: retiring without
   * inserting leaves somebody with nothing that works. Read-committed is enough
   * — two concurrent requests could still both insert, which is why the read
   * below keeps its ordering as a fallback rather than dropping it.
   */
  await db.transaction(async (tx) => {
    await tx
      .update(schema.signInCodes)
      .set({ consumedAt: now })
      .where(
        and(eq(schema.signInCodes.email, email), isNull(schema.signInCodes.consumedAt)),
      );

    await tx.insert(schema.signInCodes).values({
      email,
      codeHash: hashCode(secret, email, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    });
  });
}

export type CodeCheck =
  | { ok: true; email: string }
  | { ok: false; reason: 'no_code' | 'expired' | 'wrong' | 'too_many' };

/**
 * Checks a code and consumes it.
 *
 * At most one code is outstanding per address, because `storeCode` retires the
 * previous one as it writes the next — so every request refreshes the window
 * rather than widening it, and somebody who asked three times has one live
 * secret rather than three sitting in an inbox.
 *
 * That used to be this comment's claim and an ordering's approximation of it.
 * "The newest outstanding code" meant "whichever of several rows a sort on a
 * non-unique timestamp happened to return", and when it returned the wrong one
 * the code in somebody's inbox simply did not work.
 *
 * The ordering stays as a fallback rather than a mechanism: two concurrent
 * requests under read-committed could still write two rows, and rows that
 * predate the change above can be sitting in the table in pairs. Newest-wins is
 * the right guess for both, and success below retires every outstanding row for
 * the address rather than only the one it read, so the state collapses to one the
 * first time anybody signs in.
 */
export async function consumeCode(
  db: Db,
  secret: string,
  email: string,
  code: string,
  now = new Date(),
): Promise<CodeCheck> {
  const [row] = await db
    .select()
    .from(schema.signInCodes)
    .where(and(eq(schema.signInCodes.email, email), isNull(schema.signInCodes.consumedAt)))
    // See the header: a fallback for rows that predate retiring, not the thing
    // that picks the code.
    .orderBy(desc(schema.signInCodes.createdAt))
    .limit(1);

  if (!row) return { ok: false, reason: 'no_code' };

  /*
   * The attempt is taken before the code is compared, in one statement.
   *
   * This read the row, compared, and then wrote `attempts + 1` from what it had
   * read — so twenty guesses sent at once all read `attempts = 0`, all passed
   * the check, and all wrote 1. The ceiling of five was a ceiling on guesses
   * made one after another, and none at all on guesses made together: with
   * enough addresses to spread them over, a six-digit code could be walked in
   * the ten minutes it lives. Claiming the attempt in the database, and only
   * comparing when the claim succeeds, makes the fifth guess the last one
   * however many arrive at once.
   */
  const [claimed] = await db
    .update(schema.signInCodes)
    .set({ attempts: sql`${schema.signInCodes.attempts} + 1` })
    .where(
      and(
        eq(schema.signInCodes.id, row.id),
        isNull(schema.signInCodes.consumedAt),
        lt(schema.signInCodes.attempts, MAX_CODE_ATTEMPTS),
        gt(schema.signInCodes.expiresAt, now),
      ),
    )
    .returning({ codeHash: schema.signInCodes.codeHash });

  if (!claimed) {
    // Why there was nothing to claim, read fresh: another request may have
    // spent the last attempt, or the code, since the row above was read.
    const [current] = await db
      .select()
      .from(schema.signInCodes)
      .where(eq(schema.signInCodes.id, row.id))
      .limit(1);
    if (!current || current.consumedAt) return { ok: false, reason: 'no_code' };
    if (current.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: 'too_many' };
    return { ok: false, reason: 'expired' };
  }

  const expected = hashCode(secret, email, code);
  const stored = Buffer.from(claimed.codeHash);
  const matches =
    stored.length === expected.length && timingSafeEqual(stored, expected);

  // Counted already, against the code rather than the request: a fresh code
  // would otherwise reset the budget and there would be no ceiling at all.
  if (!matches) return { ok: false, reason: 'wrong' };

  /*
   * Spent once. Two requests carrying the right code at the same moment both
   * reach here, and only the one whose update finds the row unconsumed signs
   * anybody in.
   */
  const [spent] = await db
    .update(schema.signInCodes)
    .set({ consumedAt: now })
    .where(and(eq(schema.signInCodes.id, row.id), isNull(schema.signInCodes.consumedAt)))
    .returning({ id: schema.signInCodes.id });
  if (!spent) return { ok: false, reason: 'no_code' };

  /*
   * Every outstanding row for this address, not only the one just read.
   *
   * A code that has been spent settles the request it belonged to, so any other
   * live row for the address — one from two requests that raced, or a pair
   * written before `storeCode` began retiring — has been answered too. Leaving
   * one live leaves a second secret in an inbox that still signs somebody in,
   * which is the thing this function's header has always said it does not do.
   */
  await db
    .update(schema.signInCodes)
    .set({ consumedAt: now })
    .where(
      and(eq(schema.signInCodes.email, email), isNull(schema.signInCodes.consumedAt)),
    );
  return { ok: true, email };
}

export type SignInResult = {
  actorId: string;
  email: string;
  merged: boolean;
  /**
   * Whether this sign-in is the one that brought the account into existence.
   *
   * The clients use it for one thing: offering a passkey. "Next time, sign in
   * with Face ID" is a true and welcome sentence at the moment somebody first
   * has an account to attach one to, and a returning interruption on every
   * subsequent sign-in — so the moment has to be distinguishable, and only
   * `bindAccount` knows which branch it took.
   */
  created: boolean;
};

/** How many names to try before admitting the lists are not the problem. */
const HANDLE_TRIES = 8;

/**
 * Give this actor a handle if it has none.
 *
 * Called on the way in rather than offered on a form. An empty field labelled
 * "Handle" is homework at the door, and the accounts that skip it are the ones
 * left with nothing to show beside a name — so everyone leaves sign-in with a
 * real one, and Edit profile is where it becomes theirs.
 *
 * The write is conditional on the handle still being null, which is what makes
 * this safe to call on every sign-in: two tabs signing in at once cannot
 * produce two names, and it can never overwrite one somebody chose.
 *
 * Failure is quiet and returns null. A person who cannot sign in because the
 * generator lost eight coin flips is a worse outcome than a person with no
 * handle, and the next sign-in tries again.
 */
export async function ensureHandle(db: Db, actorId: string): Promise<string | null> {
  for (let attempt = 0; attempt < HANDLE_TRIES; attempt++) {
    const handle = generateHandle();
    try {
      const updated = await db
        .update(schema.actors)
        .set({ handle })
        .where(and(eq(schema.actors.id, actorId), isNull(schema.actors.handle)))
        .returning({ handle: schema.actors.handle });
      // Empty means the row already had one — nothing to do, and not a loss
      // worth retrying, because retrying would find the same row.
      return updated.length > 0 ? handle : null;
    } catch {
      // The unique index on `lower(handle)`. Another name, same as anyone
      // typing one that is taken.
    }
  }
  return null;
}

/**
 * Binds this device's actor to the account for `email`, creating it if needed.
 *
 * Three shapes, and the third is the interesting one:
 *
 *   - no account yet — create it, keep this actor, nothing moves. §3: "claiming
 *     an account sets `account_id`; nothing else moves."
 *   - the account is already this actor — nothing to do.
 *   - the account belongs to another actor — the same person on another
 *     device. Fold this one into it, so forty photos taken on a phone stop
 *     belonging to a stranger the moment they sign in on a laptop.
 *
 * Whichever shape it took, the actor that comes out of it leaves with a
 * handle. `ensureHandle` is outside the three branches rather than repeated in
 * them: it is the same thing in all three, and the branch it would be easiest
 * to forget is the merge, where the handle belongs to the actor that won.
 */
export async function signIn(
  db: Db,
  email: string,
  actorId: string,
  /** When the age check passed, for the sign-in that creates the account. */
  created: { ageConfirmedAt?: Date } = {},
): Promise<SignInResult> {
  const result = await bindAccount(db, email, actorId, created.ageConfirmedAt ?? null);
  await ensureHandle(db, result.actorId);
  return result;
}

/**
 * Points an actor at an account, and refuses to pretend it worked.
 *
 * This was two bare `update`s, and a bare update that matches nothing is
 * silent. When it matched nothing — an actor id from a cookie whose row no
 * longer existed — sign-in still answered 200 with an account that belonged
 * to nobody, and the very next request reported the person signed out. The
 * failure had no symptom except the thing not working.
 *
 * `returning` turns that into an error at the point it happens, where the
 * route answers 500 and the log says which actor. Callers reach here only
 * after `ensureActor`, which now guarantees the row exists; this is the
 * assertion that the guarantee held.
 */
async function link(db: Db, accountId: string, actorId: string): Promise<void> {
  const updated = await db
    .update(schema.actors)
    .set({ accountId, kind: 'user' })
    .where(eq(schema.actors.id, actorId))
    .returning({ id: schema.actors.id });

  if (updated.length === 0) {
    throw new Error(`cannot bind account to actor ${actorId}: no such actor`);
  }
}

/** Whether an address already has an account. For the age check, which asks only once. */
export async function accountExists(db: Db, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(eq(schema.accounts.email, email))
    .limit(1);
  return row !== undefined;
}

async function bindAccount(
  db: Db,
  email: string,
  actorId: string,
  ageConfirmedAt: Date | null,
): Promise<SignInResult> {
  const [existing] = await db
    .select()
    .from(schema.accounts)
    .where(eq(schema.accounts.email, email))
    .limit(1);

  if (!existing) {
    // The age check and the terms are passed on one screen, so one moment.
    const [account] = await db
      .insert(schema.accounts)
      .values({ email, ageConfirmedAt, termsAcceptedAt: ageConfirmedAt })
      .returning();
    await link(db, account!.id, actorId);
    return { actorId, email, merged: false, created: true };
  }

  const [canonical] = await db
    .select({ id: schema.actors.id })
    .from(schema.actors)
    .where(
      and(eq(schema.actors.accountId, existing.id), isNull(schema.actors.mergedIntoId)),
    )
    .limit(1);

  /*
   * An account whose actor is gone: adopt this one rather than stranding it.
   *
   * Not `created`, even though it is the first sign-in this account has
   * successfully completed. The row already existed, which means somebody has
   * been here before — and if they had a passkey it went with the account, so
   * this is not the moment to claim anything is new.
   */
  if (!canonical) {
    await link(db, existing.id, actorId);
    return { actorId, email, merged: false, created: false };
  }

  if (canonical.id === actorId) return { actorId, email, merged: false, created: false };

  await mergeActor(db, actorId, canonical.id);
  return { actorId: canonical.id, email, merged: true, created: false };
}

export type AccountProfile = {
  email: string;
  displayName: string | null;
  /** A line or two somebody wrote about themselves. Null draws nothing. */
  bio: string | null;
  /**
   * The one link on their profile, with its scheme. Null draws nothing.
   *
   * Always `http:` or `https:` — see the normalisation in `account/route.ts`,
   * which is the only thing that writes this column.
   */
  link: string | null;
  handle: string | null;
  /** Presigned and short-lived. The bucket is private; see `avatarUrl`. */
  avatarUrl: string | null;
  /** "47" when a number is set, null when none is. Never the number. */
  phoneLast2: string | null;
  /**
   * Whether a code sent to that number came back.
   *
   * Two digits and a boolean rather than one field, because "a number is here"
   * and "a number is proved" are different states with different screens: an
   * unproved number is a flow somebody abandoned halfway, and the page has to
   * be able to offer to finish it rather than either claiming it is done or
   * pretending nothing happened. Only a proved number makes anybody findable —
   * see `findByPhone`.
   */
  phoneVerified: boolean;
  /**
   * Whether the number and the address may be used to find this person.
   *
   * On the profile payload because it is a setting, and a setting a screen
   * cannot read is a switch that draws itself in the wrong position on the
   * first frame. See the column for what it governs.
   */
  discoverable: boolean;
};

export async function accountFor(
  db: Db,
  actorId: string,
): Promise<AccountProfile | null> {
  // The name comes back with the address because the page that asks for one
  // asks for the other in the same breath, and two round trips to render one
  // header is two chances for it to arrive half-drawn.
  const [row] = await db
    .select({
      email: schema.accounts.email,
      displayName: schema.actors.displayName,
      bio: schema.actors.bio,
      link: schema.actors.link,
      handle: schema.actors.handle,
      avatarKey: schema.actors.avatarKey,
      // The last two digits, never the number — there is no number to send.
      phoneLast2: schema.actors.phoneLast2,
      // The moment, reduced to a boolean below. The timestamp is a fact about
      // when somebody did something and nothing on any screen needs it.
      phoneVerifiedAt: schema.actors.phoneVerifiedAt,
      discoverable: schema.actors.discoverable,
    })
    .from(schema.actors)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.actors.accountId))
    .where(eq(schema.actors.id, actorId))
    .limit(1);
  if (!row) return null;

  const { avatarKey, phoneVerifiedAt, ...rest } = row;
  return {
    ...rest,
    phoneVerified: phoneVerifiedAt != null,
    avatarUrl: await avatarUrl(avatarKey),
  };
}

/**
 * A URL a browser can load the picture from.
 *
 * Presigned against R2 rather than proxied: `deploy.md` is explicit that the
 * app tier serves HTML and JSON and never photo bytes, and a profile picture
 * is photo bytes. The browser fetches it from storage directly and the app
 * only ever hands over the address.
 *
 * Short-lived on purpose. The URL is a capability, and the page holding it is
 * re-rendered often enough that an hour is generous.
 */
export async function avatarUrl(key: string | null): Promise<string | null> {
  if (!key) return null;
  return getStorage()
    .presignGet(key, 3600)
    .catch(() => null);
}

/**
 * Deletes the account, and everything about the person that is not somebody
 * else's too.
 *
 * The actor survives as a nameless guest, keeping its uploads. That is a
 * judgement worth stating: the photos are in other people's events, and the
 * person can still remove any of them one at a time or all at once —
 * `deleteEverything` below is offered next to this in the UI. Silently
 * tombstoning a shared event because someone closed an account would take away
 * other people's copies of an evening they were also at.
 *
 * Everything else goes. This used to delete the address and the passkeys and
 * nothing more, so a "deleted" person kept their name, handle, bio, picture
 * and phone number on the actor that survived; every message they had
 * written; their friendships, groups, reactions, tags and history; and every
 * session and push token, so their phones stayed signed in — as a guest — and
 * went on receiving their notifications. The privacy page promised more, and
 * so does Apple (guideline 5.1.1(v): the account *and its data*).
 *
 * What is kept, on purpose, and said so on the privacy page: the photographs
 * (see above), the events and groups they made, which belong to everybody in
 * them, and the safety and moderation records — reports they filed, incidents
 * about what they uploaded — which a reviewer may need long after, and which
 * the law may require.
 */
export async function deleteAccount(db: Db, actorId: string): Promise<boolean> {
  const [actor] = await db
    .select({ accountId: schema.actors.accountId })
    .from(schema.actors)
    .where(eq(schema.actors.id, actorId))
    .limit(1);
  if (!actor?.accountId) return false;

  let avatarKeys: string[] = [];
  await db.transaction(async (tx) => {
    /*
     * The passkeys go, and they go first.
     *
     * They are not profile data that a guest can keep having — they are keys to
     * an account, and the account is about to stop existing. The actor row
     * survives on purpose (it owns photographs), so nothing else would remove
     * them: they would sit there pointing at a guest, and the next person to
     * claim this address would find sign-in offering a Face ID prompt that
     * belongs to somebody who closed their account.
     *
     * Every actor the account speaks for, not just this one. A person who
     * signed in on three devices has one actor, but an account whose actor is
     * gone is adopted rather than stranded, and the `update` below already
     * works across the set for the same reason.
     */
    const theirs = tx
      .select({ id: schema.actors.id })
      .from(schema.actors)
      .where(eq(schema.actors.accountId, actor.accountId!));
    await tx.delete(schema.passkeys).where(inArray(schema.passkeys.actorId, theirs));

    const ids = (await theirs).map((row) => row.id);
    avatarKeys = await eraseActors(tx as unknown as Db, ids);

    await tx
      .update(schema.actors)
      .set({ accountId: null, kind: 'guest' })
      .where(eq(schema.actors.accountId, actor.accountId!));
    await tx.delete(schema.accounts).where(eq(schema.accounts.id, actor.accountId!));
  });

  // The pictures, after the rows that pointed at them are gone. Best-effort:
  // a stray object nobody can address is a cost, not an exposure.
  for (const key of avatarKeys) {
    try {
      await getStorage().delete(key);
    } catch (err) {
      console.error(`account deletion could not remove ${key}: ${err}`);
    }
  }
  return true;
}

/**
 * Everything about these actors that is theirs alone. See `deleteAccount`.
 *
 * Returns the profile pictures to delete from storage once the transaction has
 * committed. Every statement is scoped to the actors' own ids; nothing here
 * touches a row that is somebody else's — a block somebody made against them
 * stays, because it protects the other person.
 */
async function eraseActors(db: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);

  const avatars = (await db.execute(sql`
    select avatar_key as key from "actor" where id in (${list}) and avatar_key is not null
  `)) as unknown as { key: string }[] | { rows: { key: string }[] };
  const avatarKeys = (Array.isArray(avatars) ? avatars : avatars.rows).map((row) => row.key);

  // Who they were: nothing that names or reaches them survives on the actor.
  await db.execute(sql`
    update "actor" set
      display_name = null, handle = null, bio = null, link = null, avatar_key = null,
      phone_hash = null, phone_last2 = null, phone_verified_at = null,
      discoverable = false
    where id in (${list})
  `);

  // The groups they were in, before the memberships go — see below.
  const groupsRows = (await db.execute(sql`
    select distinct group_id from "group_member" where actor_id in (${list})
  `)) as unknown as { group_id: string }[] | { rows: { group_id: string }[] };
  const theirGroups = (Array.isArray(groupsRows) ? groupsRows : groupsRows.rows).map(
    (row) => row.group_id,
  );

  // Signed out everywhere, and no phone of theirs is sent anything again.
  await db.execute(sql`update "session" set revoked_at = now() where actor_id in (${list}) and revoked_at is null`);
  for (const table of [
    'device',
    'phone_code',
    'webauthn_challenge',
    'friendship',
    'group_member',
    'group_invite',
    'group_join_request',
    'event_participant',
    'event_invite',
    'event_access_request',
    'event_host_request',
    'photo_favourite',
    'photo_reaction',
    'message_reaction',
    'group_message_reaction',
    'moment_reaction',
    'moment_view',
    'moment_comment',
    'event_thread_read',
    'group_thread_read',
    'hidden_activity',
    'observation',
  ]) {
    await db.execute(sql`delete from ${sql.identifier(table)} where actor_id in (${list})`);
  }
  /*
   * A group whose only admin this was keeps somebody who can run it: the
   * member who has been in it longest. The same rule as `ensureAdmin`, as one
   * statement over every group they left.
   */
  if (theirGroups.length > 0) {
    const groupList = sql.join(theirGroups.map((id) => sql`${id}::uuid`), sql`, `);
    await db.execute(sql`
      update "group_member" gm set role = 'admin'
      from (
        select distinct on (g.group_id) g.group_id, g.actor_id
        from "group_member" g
        where g.group_id in (${groupList})
          and not exists (
            select 1 from "group_member" a where a.group_id = g.group_id and a.role = 'admin'
          )
        order by g.group_id, g.joined_at asc
      ) heir
      where gm.group_id = heir.group_id and gm.actor_id = heir.actor_id
    `);
  }

  // The other ends of what they were part of.
  await db.execute(sql`delete from "friendship" where friend_actor_id in (${list})`);
  await db.execute(sql`delete from "friend_request" where from_actor_id in (${list}) or to_actor_id in (${list})`);
  await db.execute(sql`delete from "block" where blocker_actor_id in (${list})`);
  // Where they are in somebody's photograph, and who they said was in one.
  await db.execute(sql`delete from "photo_tag" where actor_id in (${list})`);
  // What they said, blanked the way deleting a single message blanks it.
  await db.execute(sql`update "event_message" set body = '', deleted_at = coalesce(deleted_at, now()) where author_actor_id in (${list})`);
  await db.execute(sql`update "group_message" set body = '', deleted_at = coalesce(deleted_at, now()) where author_actor_id in (${list})`);
  // A moment is theirs alone; it goes whichever kind of deletion this is.
  await db.execute(sql`update "moment" set deleted_at = coalesce(deleted_at, now()) where actor_id in (${list})`);

  return avatarKeys;
}

/** Tombstones every photo this actor uploaded. The purge job removes the bytes. */
export async function deleteEverything(db: Db, actorId: string): Promise<number> {
  const removed = await db
    .update(schema.photos)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.photos.uploaderId, actorId), isNull(schema.photos.deletedAt)))
    .returning({
      id: schema.photos.id,
      eventId: schema.photos.eventId,
      contentHash: schema.photos.contentHash,
    });
  // Every link to them stops working too. See `./revoke`.
  await revokePhotoLinks(removed);

  // One row each. A bulk deletion that leaves no trace is the case where
  // "where did all of these go" has no answer at all, and it is the largest
  // single removal the product can perform.
  // Moments go with them. They are not in anybody's evening, so there is no
  // one else's copy of anything to keep.
  await db
    .update(schema.moments)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.moments.actorId, actorId), isNull(schema.moments.deletedAt)));

  for (const photo of removed) {
    await recordModeration(db, {
      photoId: photo.id,
      eventId: photo.eventId,
      action: 'removed',
      actorId,
      reason: REASON.accountDeleted,
    });
  }
  return removed.length;
}

/** Spent and stale codes. Called from the purge job. */
export function staleCodes(now: Date) {
  return lt(schema.signInCodes.expiresAt, now);
}

export { normaliseEmail };
