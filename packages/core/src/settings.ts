/**
 * The two settings an album carries — who may see it, and who may add to it —
 * as plain values with no dependencies.
 *
 * Their own file so that a browser can have them. They were in `policy.ts`,
 * which imports `node:crypto`; a client component importing `PRIVATE` from
 * `@parea/core` therefore pulled in the package's whole entry — the schema,
 * drizzle, and a crypto polyfill — and shipped half a megabyte of it on the
 * home page. Client code imports `@parea/core/settings`; the policy re-exports
 * everything here, so server code is unchanged.
 */

/**
 * Anyone can see it.
 *
 * Possession of the link is the access model, and nothing else is asked: no
 * account to look, no host to ask. Adding photos still names who added them —
 * see the `contribute` check below — because an upload is attributable and a
 * look is not.
 */
export const PUBLIC = 'public';

/**
 * You are in it, or you are not.
 *
 * Two doors and no third: somebody added you and you accepted, or you asked
 * and the person who made it let you in. Holding the link is not one of them.
 * It gets you as far as the door — `/event/<id>/request` — and no further,
 * which is also all a stranger who found the album on somebody's profile
 * gets. Both arrive at the same page and press the same button.
 *
 * Being in is an `event_participant` row, whichever door it came through.
 * There is no separate "approved" column, because that row is already what
 * "in" means here and already what `joins_open` reads — a second table saying
 * the same thing is two answers to one question, and the day they disagree the
 * wrong one wins silently.
 *
 * Signing in comes before asking: a request from somebody with no account
 * names nobody, and the host is being asked about a person.
 *
 * This replaced two policies. `account_required` — the link admits whoever
 * signs in — was the middle setting, and it is gone because it made "private"
 * mean two different things depending on a switch most people never found. A
 * forwarded link either opens an album or it does not, and for a private
 * album the answer is now always no.
 */
export const PRIVATE = 'private';


/**
 * Whoever the album is open to can add to it.
 *
 * Deliberately deferred rather than restated: on a private album that is the
 * people in it, and on a public one it is whoever holds the link. Saying it
 * twice is how the two settings come to disagree, and the day they do the
 * wrong one wins silently.
 */
export const CONTRIBUTE_EVERYONE = 'everyone';

/**
 * The hosts: whoever made it, a group's admins, and anybody made a host of it.
 *
 * The case the boolean could not say. An evening where a few people were
 * taking photographs and everybody else is there to look at them is not the
 * same as a closed album, and offering only "open" and "closed" made it one or
 * the other.
 *
 * Group admins are included because `administer` already treats them as the
 * host of anything in their group — an album nobody in the group could add to
 * except its original maker would strand the room's own archive the day that
 * person left.
 *
 * `isEventHost` is the third, and it is the one this value is named for: a
 * participant the host promoted, or one whose `event_host_request` was
 * approved. It was labelled "Only me" in both clients while it already meant
 * more than one person on a group album, which is the label this corrects
 * rather than the behaviour.
 *
 * A host is not an administrator. Adding photographs is all this grants; see
 * `isEventHost`.
 */
export const CONTRIBUTE_HOST = 'host';

/**
 * The person who made it, and nobody else at all.
 *
 * What "Only me" was supposed to mean and did not: `host` has always included
 * a group's admins, so on an album inside a group the strictest setting on
 * offer was still several people. Now that a host can promote somebody it
 * would have been several more, and a setting called "Only me" that admits
 * whoever an admin decides to admit is a setting that lies.
 *
 * Deliberately narrow: not even a group admin, who can still `administer` the
 * album — change this setting included. That is the honest shape. The album's
 * photographs are one person's to put in; what the album *is* stays the
 * group's.
 */
export const CONTRIBUTE_CREATOR = 'creator';

/**
 * Nobody, the maker included. An album that is finished is finished.
 *
 * No longer offered by either client — the question is "who can add photos",
 * and "nobody, including you" turned out to be a way of ending an album that
 * people reached for by accident and could not find their way back out of.
 * `0034_event_hosts` moves the albums that held it to `creator`.
 *
 * Still understood here, and that is not an oversight. A value that exists in
 * one deployed client and not in the engine is a value that fails closed on
 * the wrong side of a rollback, and this one has an unambiguous meaning; the
 * cost of keeping it is a branch nothing writes any more.
 */
export const CONTRIBUTE_NOBODY = 'nobody';

/**
 * Every contribute policy this product knows, and the one list of them.
 *
 * Exported because it was not, and two routes then wrote their own. Both wrote
 * the same three of the four — `creator` was the one that fell out — so
 * "Only me", which is the *first* option a private album offers, could not be
 * chosen at creation and could not be set afterwards either. Both answered 400
 * and the create form had no wording for that code, so what somebody saw was
 * "Could not create the album (400)."
 *
 * `authorize` below fails closed on a policy it does not recognise, which is
 * the right shape and is why a validator has to exist at the edge at all: a
 * value that reached the column and then was not understood would seal an
 * album against the person who had just made it. What that argument does not
 * survive is the list being written out a second time by hand, which is how
 * one of them came to be missing a policy `authorize` has always handled.
 */
export const CONTRIBUTE_POLICIES = [
  CONTRIBUTE_EVERYONE,
  CONTRIBUTE_CREATOR,
  CONTRIBUTE_HOST,
  CONTRIBUTE_NOBODY,
] as const;

export type ContributePolicy = (typeof CONTRIBUTE_POLICIES)[number];

/** The same two for who may *see* an album. See `PUBLIC` and `PRIVATE`. */
export const ACCESS_POLICIES = [PUBLIC, PRIVATE] as const;

export type AccessPolicy = (typeof ACCESS_POLICIES)[number];
