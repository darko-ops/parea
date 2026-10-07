/**
 * Friends — asking, answering, and who is one.
 *
 * The product's position until now was that there is nobody to find: an
 * account was an email address, and handles existed so a host could tell who
 * was knocking. Making handles searchable is a real change to that, and the
 * things it makes possible are bounded on purpose — you can be found by your
 * handle, and the only thing being found leads to is somebody asking. Nothing
 * here lists a person's events, their photos, or who else they know.
 *
 * The shape follows the two requests that already exist, for groups and for
 * private events: a request table for the conversation, and a separate table
 * for the thing it grants. A bug in the first can lose an ask, which is
 * visible and fixable by asking again; only the second makes anyone friends.
 */

import { handleKey, normaliseEmail, schema } from '@parea/core';
import { and, eq, isNotNull, isNull, ne, not, or, sql } from 'drizzle-orm';

import type { Db } from './db';
import { blockedBetween } from './moderation';
import { hashPhone, normalisePhone } from './phone';

/**
 * What a person looks like to somebody who is not them.
 *
 * `avatarKey` is a storage key and not a URL, like `EventListing.coverKey`:
 * this type is read on the server, and every boundary that hands it to a
 * client signs it there — see `/api/friends` and `/api/people`, which emit a
 * presigned `avatar` and never the key. A key crossing that line is an
 * internal address published, and it does not expire.
 *
 * Which is also why the field is named for what it is. A `Person` handed
 * straight to a client component serialises every property it has, declared
 * in the receiving type or not, so the name is the warning.
 */
export type Person = {
  actorId: string;
  handle: string | null;
  displayName: string | null;
  avatarKey: string | null;
};

/**
 * Where a viewer and a person in a list stand, worked out row by row.
 *
 * The same five words `profileFor` uses and deliberately the same type: a
 * search result that offers "Add friend" to somebody you asked last week is
 * the list disagreeing with the page it opens, and two vocabularies for that
 * is how the disagreement gets written by accident.
 *
 * `self` never appears here — `findPeople` excludes the viewer — but the type
 * is shared rather than narrowed, because a narrower one would have to be
 * widened again at the boundary that renders both.
 */
export type Standing = 'friends' | 'asked' | 'asking' | 'none';

/** A person in a list, with what the viewer may do about them. */
export type FoundPerson = Person & { standing: Standing };

/**
 * The standing of every row, in the row's own query.
 *
 * Three correlated subqueries rather than three statements and a join in
 * JavaScript: this runs over at most ten rows — `SEARCH_LIMIT` — and the
 * alternative is a round trip per person in a list that is redrawn on every
 * keystroke somebody types.
 *
 * Theirs before yours, the order `profileFor` argues for: if you have both
 * asked, the one you can act on is the one pointing at you, and a row reading
 * "Requested" over somebody's unanswered question is the list hiding it.
 *
 * An outgoing request counts whatever its status — a declined one reads the
 * same as an open one, because saying "no" is said once and telling somebody
 * they were refused is the refuser's to do.
 */
function standingOf(actorId: string | null) {
  if (!actorId) return sql<Standing>`'none'`;
  /*
   * `"actor".id`, written out rather than interpolated.
   *
   * Drizzle qualifies an interpolated column with its table only when the
   * query has a join, and neither search below has one — so `${schema.actors
   * .id}` renders as a bare `"id"`, which inside `from "friend_request" r`
   * resolves against `friend_request`, a table with an `id` of its own. The
   * clause becomes `r.to_actor_id = r.id`: valid SQL, no error, and never
   * true. Every row came back `none`, which is the answer that offers to ask
   * somebody you already asked.
   */
  return sql<Standing>`(
    case
      when exists (
        select 1 from "friendship" f
        where f.actor_id = ${actorId} and f.friend_actor_id = "actor".id
      ) then 'friends'
      when exists (
        select 1 from "friend_request" r
        where r.from_actor_id = "actor".id and r.to_actor_id = ${actorId}
          and r.status = 'open'
      ) then 'asking'
      when exists (
        select 1 from "friend_request" r
        where r.from_actor_id = ${actorId} and r.to_actor_id = "actor".id
      ) then 'asked'
      else 'none'
    end
  )`;
}

/** The most a search will return. Enough to find who you meant, and not a page. */
export const SEARCH_LIMIT = 10;
/** Below this a search is a way to enumerate handles rather than to find one. */
export const SEARCH_MIN = 2;

/**
 * Find people by handle or by name.
 *
 * A handle matches from its start — `may` finds `@maya_c`. A name matches from
 * the start of any word in it — `chen` finds "Maya Chen", and so does `maya c`
 * — because a person half-remembers somebody by what they are called, not by
 * the handle they picked. This was handle-only on the reasoning that a display
 * name is not something anyone chose to be findable by; but it is printed on
 * their profile, on every roll they are in and beside every message, so finding
 * them by it discloses nothing those do not, and a search that could not find
 * "Lillian" by typing "Lillian" was a search people gave up on.
 *
 * A leading `@` asks for handles only, which is what somebody typing one means.
 *
 * Handles first, then names, so the person whose handle you typed is never
 * pushed off the end of ten by people who happen to share a first name with it.
 *
 * Signed-in accounts only, so a guest actor — which exists for anybody who ever
 * opened a link — is not a person in a list.
 *
 * Blocked people are excluded in both directions. Someone you blocked should
 * not surface, and you should not surface to them: a block that still let them
 * find you and ask to be friends would be a block in name only.
 */
export async function findPeople(
  db: Db,
  actorId: string | null,
  query: string,
): Promise<FoundPerson[]> {
  const raw = handleKey(query);
  const handleOnly = raw.startsWith('@');
  const key = raw.replace(/^@/, '');
  if (key.length < SEARCH_MIN) return [];

  // `%` and `_` are wildcards to LIKE and ordinary characters to a person.
  const literal = key.replace(/[\\%_]/g, (c) => `\\${c}`);
  const byHandle = sql`lower(${schema.actors.handle}) like ${`${literal}%`}`;
  const byName = handleOnly
    ? sql`false`
    : sql`(lower(${schema.actors.displayName}) like ${`${literal}%`}
          or lower(${schema.actors.displayName}) like ${`% ${literal}%`})`;

  const rows = await db
    .select({
      actorId: schema.actors.id,
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
      avatarKey: schema.actors.avatarKey,
      standing: standingOf(actorId),
    })
    .from(schema.actors)
    .where(
      and(
        // An account, not a device. `account_id` is set by sign-in and nothing
        // else, which is the same test everything here uses for "a person".
        sql`${schema.actors.accountId} is not null`,
        sql`${schema.actors.mergedIntoId} is null`,
        or(byHandle, byName),
        actorId ? ne(schema.actors.id, actorId) : sql`true`,
        actorId
          ? sql`not exists (
              select 1 from "block" b
              where (b.blocker_actor_id = ${actorId} and b.blocked_actor_id = ${schema.actors.id})
                 or (b.blocker_actor_id = ${schema.actors.id} and b.blocked_actor_id = ${actorId})
            )`
          : sql`true`,
      ),
    )
    .orderBy(sql`case when ${byHandle} then 0 else 1 end`, schema.actors.handle)
    .limit(SEARCH_LIMIT);

  return rows;
}

/** Everyone this actor is friends with. */
export async function friendsOf(db: Db, actorId: string | null): Promise<Person[]> {
  if (!actorId) return [];
  return db
    .select({
      actorId: schema.actors.id,
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
      avatarKey: schema.actors.avatarKey,
    })
    .from(schema.friendships)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.friendships.friendActorId))
    .where(eq(schema.friendships.actorId, actorId))
    .orderBy(schema.actors.handle);
}

/**
 * Somebody else's friends, as one particular reader may see them.
 *
 * Open to anybody signed in — the route checks that — which is the choice made
 * for this list: the count was already on every profile, and the people behind
 * it are now one tap from it, as they are on your own. What is held back is
 * anybody a block stands between the reader and, either way round: a list
 * that showed them would be the one place a block did not reach.
 */
export async function friendsSeenBy(
  db: Db,
  viewer: string,
  actorId: string,
): Promise<Person[]> {
  return db
    .select({
      actorId: schema.actors.id,
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
      avatarKey: schema.actors.avatarKey,
    })
    .from(schema.friendships)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.friendships.friendActorId))
    .where(
      and(
        eq(schema.friendships.actorId, actorId),
        not(blockedBetween(viewer, schema.actors.id)),
      ),
    )
    .orderBy(schema.actors.handle);
}

/**
 * People your friends are friends with, and you are not.
 *
 * The one suggestion this product makes about people, and it is deliberately
 * the weakest one available: a friend of a friend is somebody you can already
 * reach by asking the friend, so the suggestion saves a message rather than
 * disclosing a relationship you had no route to.
 *
 * ## What a count discloses, and what a list would
 *
 * The row says "2 mutual friends" and never which two. That is not squeamish
 * about a small number — naming them tells the person reading it who two of
 * *their own* friends are friends with, which is a fact about those two that
 * neither was asked about. The count is the same shape of information every
 * product of this kind shows, and the names are the line past it.
 *
 * ## Everybody who must not appear
 *
 * Yourself, obviously. People you are already friends with, because a
 * suggestion is an offer to ask. Anybody with a request open in either
 * direction, because asking twice is not a feature. And anybody either of you
 * has blocked — a block hides two people from each other everywhere, and a
 * suggestion screen is exactly where a missed exclusion becomes a person
 * reappearing in front of somebody who cut them off. And anybody you took off
 * the list with the × — see `suggestionDismissals`.
 */
export type Suggestion = Person & { mutuals: number };

/** Enough to be worth a screen, few enough to read. */
export const SUGGESTION_LIMIT = 12;

export async function suggestionsFor(
  db: Db,
  actorId: string | null,
): Promise<Suggestion[]> {
  if (!actorId) return [];

  type Row = {
    actorId: string;
    handle: string | null;
    displayName: string | null;
    avatarKey: string | null;
    mutuals: number;
  };

  const answer = await db.execute<Row>(sql`
    select
      a.id            as "actorId",
      a.handle        as "handle",
      a.display_name  as "displayName",
      a.avatar_key    as "avatarKey",
      count(*)::int   as "mutuals"
    from "friendship" mine
    join "friendship" theirs on theirs.actor_id = mine.friend_actor_id
    join "actor" a on a.id = theirs.friend_actor_id
    where mine.actor_id = ${actorId}
      and theirs.friend_actor_id <> ${actorId}
      -- An account, not a device: the same test everything here uses for "a
      -- person", and the same one the handle search applies.
      and a.account_id is not null
      and a.merged_into_id is null
      and not exists (
        select 1 from "friendship" f
        where f.actor_id = ${actorId} and f.friend_actor_id = a.id
      )
      and not exists (
        select 1 from "friend_request" r
        where (r.from_actor_id = ${actorId} and r.to_actor_id = a.id)
           or (r.from_actor_id = a.id and r.to_actor_id = ${actorId})
      )
      and not exists (
        select 1 from "block" b
        where (b.blocker_actor_id = ${actorId} and b.blocked_actor_id = a.id)
           or (b.blocker_actor_id = a.id and b.blocked_actor_id = ${actorId})
      )
      -- Taken off this list with the ×. One way only: dismissing somebody says
      -- nothing about whether they should be suggested to you.
      and not exists (
        select 1 from "suggestion_dismissal" d
        where d.actor_id = ${actorId} and d.dismissed_actor_id = a.id
      )
    group by a.id, a.handle, a.display_name
    -- Most mutual friends first: the strongest suggestion is the one the most
    -- of your own people already know.
    order by count(*) desc, a.handle asc
    limit ${SUGGESTION_LIMIT}
  `);

  /*
   * `db.execute` answers a `{ rows }` object on one driver and a bare array on
   * the other. Both appear in this codebase — production and the test suite —
   * so neither shape may be assumed. The note is in `groups.ts` twice and this
   * is the third place to have learned it.
   *
   * It spread the result directly, which throws on the object shape rather
   * than returning the wrong number. This ran only on the web's Find page, a
   * server component, and so only ever on the driver where it happened to
   * work — the first test ever written against it failed on the line below.
   * Now that the app draws from it too, it gets both.
   */
  const rows = answer as unknown as Row[] | { rows: Row[] };
  return Array.isArray(rows) ? rows : (rows.rows ?? []);
}

/**
 * Whether what somebody typed is a number rather than a name.
 *
 * Deliberately narrow: a leading `+` and then digits. Without the `+` this
 * would have to guess a country, and a wrong guess is a lookup that silently
 * finds nobody — which reads as "they are not on here" rather than as "that is
 * not how to type it".
 */
export function looksLikePhone(query: string): boolean {
  return /^\+[\d\s()\-.]{6,}$/.test(query.trim());
}

/**
 * Whether what somebody typed is an address rather than a name.
 *
 * An `@` with something either side of it and a dot in the right-hand half,
 * which is as much as is worth checking here: `normaliseEmail` is what decides,
 * and this only has to be sure enough not to send a handle down the exact-match
 * door. A handle cannot contain an `@` — see `handleKey` — so there is no
 * overlap to arbitrate.
 */
export function looksLikeEmail(query: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(query.trim());
}

/**
 * Who may be surfaced by one of the two identifiers they did not choose to
 * publish.
 *
 * A handle is a name somebody picked in order to be found by it, so the handle
 * search asks nobody's permission. A phone number and an email address are not
 * that: they are how the product reaches you, given for that reason, and being
 * *found* by them is a second use of the same fact. `discoverable` is where
 * somebody says no to the second without giving up the first — it is the
 * settings line "Let people who have my phone number or email find me on
 * Parea", and this clause is the whole of its enforcement.
 *
 * On for everybody by default; see the column. Written once and shared by both
 * lookups below, because a flag honoured by one door and not the other is worse
 * than no flag at all — somebody who turned it off would still be findable and
 * would have been told otherwise.
 */
const discoverableOnly = sql`${schema.actors.discoverable} = true`;

/**
 * The exclusions every exact lookup shares with the handle search.
 *
 * Yourself, a device that never signed in, a merged actor, and either side of a
 * block. Factored out rather than written twice: the phone door and the email
 * door have to admit exactly the same set, or the narrower one becomes a way to
 * ask questions the wider one refuses.
 */
function reachable(actorId: string | null) {
  return and(
    sql`${schema.actors.accountId} is not null`,
    sql`${schema.actors.mergedIntoId} is null`,
    actorId ? ne(schema.actors.id, actorId) : sql`true`,
    actorId
      ? sql`not exists (
          select 1 from "block" b
          where (b.blocker_actor_id = ${actorId} and b.blocked_actor_id = ${schema.actors.id})
             or (b.blocker_actor_id = ${schema.actors.id} and b.blocked_actor_id = ${actorId})
        )`
      : sql`true`,
  );
}

/** The four columns an exact lookup answers with, plus where you stand. */
function found(actorId: string | null) {
  return {
    actorId: schema.actors.id,
    handle: schema.actors.handle,
    displayName: schema.actors.displayName,
    avatarKey: schema.actors.avatarKey,
    // The same field the handle search sends. A caller must not be able to
    // tell from the response which door it came through — see the note in
    // the route — and a row that is missing a column is a difference.
    standing: standingOf(actorId),
  };
}

/**
 * The one person whose number this is, if they are findable at all.
 *
 * Exact, because possession of the number is the permission: somebody who has
 * it can already ring you, and this saves them asking what your handle is. A
 * partial match would turn that into a way to walk the account table.
 *
 * The same exclusions as the handle search — yourself, and anybody either of
 * you has blocked — and the same answer shape, so nothing about the response
 * says which door it came through.
 *
 * Two conditions have joined the hash since this was written, and both are the
 * point of the discovery work rather than incidental. The number has to have
 * been **proved** — a hash written straight from a form is anybody's guess at
 * somebody else's digits, and matching on one would hand a stranger's account
 * to whoever typed the number first. And its owner has to still be
 * **discoverable**, which is the setting that exists so that giving this
 * product a number is not the same as agreeing to be found by it forever.
 */
export async function findByPhone(
  db: Db,
  actorId: string | null,
  query: string,
): Promise<FoundPerson[]> {
  const e164 = normalisePhone(query);
  if (!e164) return [];

  const rows = await db
    .select(found(actorId))
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.phoneHash, hashPhone(e164)),
        // Proved, not merely typed. See the note above.
        isNotNull(schema.actors.phoneVerifiedAt),
        discoverableOnly,
        reachable(actorId),
      ),
    )
    .limit(1);

  return rows;
}

/**
 * The one person whose address this is, on the same terms as the number.
 *
 * The other half of the sentence the setting makes. "People who have my phone
 * number or email" was only ever half true while an address matched nothing:
 * somebody could turn the switch off and the only thing it retracted was the
 * number.
 *
 * Exact and normalised, for the phone lookup's reason — possession of the
 * address is the permission, and a prefix over this column would be a way to
 * read the account table. Nothing about the answer names the address, and the
 * address is never sent back: an email belongs to its owner and to the people
 * they gave it to, and this route is neither.
 *
 * `account.email` rather than a second column, so there is one address per
 * person and no question of which one discovery uses.
 */
export async function findByEmail(
  db: Db,
  actorId: string | null,
  query: string,
): Promise<FoundPerson[]> {
  const email = normaliseEmail(query);
  if (!email) return [];

  const rows = await db
    .select(found(actorId))
    .from(schema.actors)
    .innerJoin(schema.accounts, eq(schema.accounts.id, schema.actors.accountId))
    .where(and(eq(schema.accounts.email, email), discoverableOnly, reachable(actorId)))
    .limit(1);

  return rows;
}

/**
 * People you may already know, and why the product thinks so.
 *
 * This is the list behind the Find Friends page, and the whole design argument
 * is about what is *not* in it.
 *
 * ## No address book
 *
 * The obvious way to build this is to ask for the contacts permission, upload
 * the phone's address book and match it. That is the industry's answer and this
 * product refuses it, for a reason that has nothing to do with squeamishness: an
 * uploaded address book is a list of people who never agreed to anything. Half
 * of them are not users, some of them are ex-partners and doctors and the
 * plumber, and the product would then hold a social graph of strangers it has no
 * business knowing. There is no contacts permission in either client, nothing
 * here reads one, and the recommendation set is built entirely out of records
 * this product already had a reason to keep.
 *
 * ## The three reasons somebody appears
 *
 * Each is a relationship the viewer can already see the other end of, which is
 * the test every suggestion in this product has to pass — a suggestion should
 * save a message, never disclose something you had no route to.
 *
 *   **mutual friends** — a friend of a friend, already the basis of
 *   `suggestionsFor`. You could reach them by asking the friend you share.
 *
 *   **albums together** — you have both been in the same album. You were in a
 *   room with them; the album is on both your screens and so is their face.
 *
 *   **groups together** — you are in the same group. The member list is a
 *   thing you can both already read.
 *
 * ## What a verified number has to do with any of it
 *
 * Nothing, mechanically, and that is worth stating plainly rather than dressing
 * up. The page asks for a number before it shows this list, and the reason is
 * reciprocity rather than data: a list of people who may know you is the one
 * screen in the product where somebody is being handed the benefit of everybody
 * else being findable, and the price of it is being findable yourself. The
 * number is what makes that true — it is the thing that lets the people who
 * already have it reach you without anybody uploading a contact list.
 *
 * Which is why `discoverable` is *not* consulted here. It governs the two exact
 * lookups and only those: turning it off means "do not use my number or my
 * address to put me in front of people", not "hide me from the friends of my
 * friends", who can see me on a mutual friend's list already. Reading the flag
 * here would quietly make it a general invisibility switch, which is a
 * different promise from the one the settings line makes.
 */
export type Recommendation = Person & {
  /** Friends you have in common. Zero when this is not why they are here. */
  mutuals: number;
  /** Albums you have both been in. */
  albums: number;
  /** Groups you are both in. */
  groups: number;
};

/** Enough to be worth the screen, few enough to read in one pass. */
export const RECOMMENDATION_LIMIT = 24;

export async function recommendationsFor(
  db: Db,
  actorId: string | null,
): Promise<Recommendation[]> {
  if (!actorId) return [];

  type Row = {
    actorId: string;
    handle: string | null;
    displayName: string | null;
    avatarKey: string | null;
    mutuals: number;
    albums: number;
    groups: number;
  };

  /*
   * One statement, three sources, counted separately.
   *
   * Three queries and a merge in JavaScript would be the same answer and three
   * round trips, and — worse — the exclusions would be written three times. It
   * is the exclusions that matter most here: this is the only list in the
   * product that puts a person in front of somebody who has never looked for
   * them, so a missed block is a person reappearing in front of somebody who
   * cut them off, on a screen they did not ask for.
   *
   * The counts stay separate rather than being summed into one score. The row
   * has to be able to say *why*, and "3 mutual friends" and "2 albums together"
   * are different sentences with different weight; a single number would make
   * the screen say "suggested" and nothing else.
   */
  const answer = await db.execute<Row>(sql`
    with mutual as (
      select theirs.friend_actor_id as id, count(*)::int as mutuals
      from "friendship" mine
      join "friendship" theirs on theirs.actor_id = mine.friend_actor_id
      where mine.actor_id = ${actorId}
        and theirs.friend_actor_id <> ${actorId}
      group by theirs.friend_actor_id
    ),
    together as (
      -- Albums, and only ones that still exist: a deleted album is not a room
      -- anybody was in any more, and eventsFor reads the same flag.
      select theirs.actor_id as id, count(distinct theirs.event_id)::int as albums
      from "event_participant" mine
      join "event" e on e.id = mine.event_id and e.deleted_at is null
      join "event_participant" theirs
        on theirs.event_id = mine.event_id and theirs.actor_id <> ${actorId}
      where mine.actor_id = ${actorId}
      group by theirs.actor_id
    ),
    rooms as (
      select theirs.actor_id as id, count(distinct theirs.group_id)::int as groups
      from "group_member" mine
      join "group_member" theirs
        on theirs.group_id = mine.group_id and theirs.actor_id <> ${actorId}
      where mine.actor_id = ${actorId}
      group by theirs.actor_id
    ),
    candidates as (
      select id from mutual
      union select id from together
      union select id from rooms
    )
    select
      a.id                          as "actorId",
      a.handle                      as "handle",
      a.display_name                as "displayName",
      a.avatar_key                  as "avatarKey",
      coalesce(mutual.mutuals, 0)   as "mutuals",
      coalesce(together.albums, 0)  as "albums",
      coalesce(rooms.groups, 0)     as "groups"
    from candidates c
    join "actor" a on a.id = c.id
    left join mutual on mutual.id = c.id
    left join together on together.id = c.id
    left join rooms on rooms.id = c.id
    -- An account, not a device: the same test the handle search applies, and
    -- the reason a guest who once opened a link is not a person in a list.
    where a.account_id is not null
      and a.merged_into_id is null
      -- A suggestion is an offer to ask, so anybody there is nothing left to
      -- ask goes: already friends, or a request open in either direction.
      and not exists (
        select 1 from "friendship" f
        where f.actor_id = ${actorId} and f.friend_actor_id = a.id
      )
      and not exists (
        select 1 from "friend_request" r
        where (r.from_actor_id = ${actorId} and r.to_actor_id = a.id)
           or (r.from_actor_id = a.id and r.to_actor_id = ${actorId})
      )
      and not exists (
        select 1 from "block" b
        where (b.blocker_actor_id = ${actorId} and b.blocked_actor_id = a.id)
           or (b.blocker_actor_id = a.id and b.blocked_actor_id = ${actorId})
      )
    -- Mutual friends first, because it is the strongest of the three and the
    -- only one that says other people already vouched. Then albums, which is
    -- "we were in the same room", then groups, which is only "we are both on a
    -- list". The handle breaks ties so the order is stable between reloads.
    order by
      coalesce(mutual.mutuals, 0) desc,
      coalesce(together.albums, 0) desc,
      coalesce(rooms.groups, 0) desc,
      a.handle asc
    limit ${RECOMMENDATION_LIMIT}
  `);

  /*
   * `db.execute` answers `{ rows }` on one driver and a bare array on the
   * other, and both are in this codebase. The fourth place to have learned it
   * — see `suggestionsFor`, which learned it the hard way.
   */
  const rows = answer as unknown as Row[] | { rows: Row[] };
  return Array.isArray(rows) ? rows : (rows.rows ?? []);
}

export type FriendRequest = Person & { id: string; askedAt: string };

/** The people waiting on an answer from this actor. */
export async function requestsFor(
  db: Db,
  actorId: string | null,
): Promise<FriendRequest[]> {
  if (!actorId) return [];
  const rows = await db
    .select({
      id: schema.friendRequests.id,
      actorId: schema.actors.id,
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
      avatarKey: schema.actors.avatarKey,
      askedAt: schema.friendRequests.createdAt,
    })
    .from(schema.friendRequests)
    .innerJoin(schema.actors, eq(schema.actors.id, schema.friendRequests.fromActorId))
    .where(
      and(
        eq(schema.friendRequests.toActorId, actorId),
        eq(schema.friendRequests.status, 'open'),
      ),
    )
    .orderBy(schema.friendRequests.createdAt);

  return rows.map((r) => ({ ...r, askedAt: r.askedAt.toISOString() }));
}

export async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ actorId: schema.friendships.actorId })
    .from(schema.friendships)
    .where(and(eq(schema.friendships.actorId, a), eq(schema.friendships.friendActorId, b)))
    .limit(1);
  return row != null;
}

/**
 * Make two people friends, and drop the request that got them there.
 *
 * Both rows in one transaction. Half a friendship is a state nothing in the
 * product knows how to read: they would appear in one person's list and not
 * the other's, and the one who could not see it has nothing to click to fix
 * it.
 */
export async function befriend(db: Db, a: string, b: string): Promise<void> {
  if (a === b) return;
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.friendships)
      .values([
        { actorId: a, friendActorId: b },
        { actorId: b, friendActorId: a },
      ])
      .onConflictDoNothing();
  });
}

/** Both directions, because being unfriended by half is not a state either. */
export async function unfriend(db: Db, a: string, b: string): Promise<void> {
  await db
    .delete(schema.friendships)
    .where(
      or(
        and(eq(schema.friendships.actorId, a), eq(schema.friendships.friendActorId, b)),
        and(eq(schema.friendships.actorId, b), eq(schema.friendships.friendActorId, a)),
      ),
    );
}

/**
 * Whether one person may put another into an event they host.
 *
 * Not friendship — the Members screen searches every handle, and a host who
 * can find somebody has to be able to add them. What is left is the two things
 * that were doing the real work inside the friendship check: the target is an
 * account rather than a passing device, and neither party has blocked the
 * other.
 *
 * Deliberately the same predicate `findPeople` applies, so what a host can see
 * and what a host can act on are the same set. A search that offers somebody
 * the server will then refuse is a bug that looks like a permissions message.
 */
export async function invitable(
  db: Db,
  hostId: string,
  targetId: string,
): Promise<boolean> {
  if (hostId === targetId) return false;

  const [row] = await db
    .select({ id: schema.actors.id })
    .from(schema.actors)
    .where(
      and(
        eq(schema.actors.id, targetId),
        // An account, not a guest device — being added has to mean something
        // that survives the browser it happened in.
        isNotNull(schema.actors.accountId),
        isNull(schema.actors.mergedIntoId),
        not(
          sql`exists (
            select 1 from "block" b
            where (b.blocker_actor_id = ${hostId} and b.blocked_actor_id = ${targetId})
               or (b.blocked_actor_id = ${hostId} and b.blocker_actor_id = ${targetId})
          )`,
        ),
      ),
    );

  return row != null;
}

/**
 * Takes somebody off your "People you may know", for good.
 *
 * Quiet and one-way, like the × it answers: nothing is sent, and nothing else
 * between the two of you changes. Dismissing somebody who was never suggested
 * is allowed and harmless — the row only ever narrows this one list.
 */
export async function dismissSuggestion(db: Db, actorId: string, dismissedActorId: string): Promise<void> {
  await db
    .insert(schema.suggestionDismissals)
    .values({ actorId, dismissedActorId })
    .onConflictDoNothing();
}
