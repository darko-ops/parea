/**
 * Access control — docs/design.md §6.
 *
 * Every read, write and download passes through `authorize`. Not a middleware,
 * not scattered conditionals: one function, so that adding a second policy
 * later is a branch here rather than archaeology across the codebase.
 *
 * This module is pure. Relationship facts (is this actor a participant? a group
 * admin?) are resolved by the data-access layer and passed in, which keeps the
 * decision logic exhaustively testable without a database.
 */

import { timingSafeEqual } from 'node:crypto';

/**
 * `upload` is `contribute` plus the album's own answer about photographs.
 *
 * They were one capability, and six routes checked it: posting a message,
 * reacting to a message, reacting to a photograph, presigning an upload,
 * completing one, and the feed's own "may I speak". That was tolerable while
 * the only setting was a boolean meaning "this album is finished" — closing it
 * closing the conversation too is at least arguable.
 *
 * It stops being arguable at three settings. "Only the host adds photographs"
 * is a thing people want for an evening where one person had the camera, and
 * it must not mean "only the host may speak" — everybody else is there to look
 * and to say something about what they are looking at.
 *
 * So the split is: `contribute` is being entitled to take part, and `upload`
 * is that plus permission to put photographs in. Everything that was a message
 * or a reaction stays on the first; the two upload routes move to the second.
 *
 * What changes for an album already closed: its conversation reopens. That is
 * the honest reading of a setting called "who can add photos" — the album is
 * finished, and the people in it can still talk about it.
 */
export type Capability = 'view' | 'contribute' | 'upload' | 'download' | 'administer';

/**
 * `hasAccount` is required rather than optional on purpose. Every call site has
 * to say whether this actor has claimed an account, and forgetting is a
 * compile error rather than a silent `false` — which would read as "signed
 * out" and deny, or as "signed in" and admit, depending on which way the
 * default fell. Neither is a thing to leave to a default.
 */
export type PolicyActor = { id: string; hasAccount: boolean } | null;

export type PolicyEvent = {
  id: string;
  linkToken: string;
  capEpoch: number;
  accessPolicy: string;
  joinsOpen: boolean;
  contributePolicy: string;
  createdBy: string;
  groupId: string | null;
  deletedAt: Date | null;
};

export type Presented = {
  /** A link token straight off the URL. */
  linkToken?: string;
  /** A spoken code the user typed. */
  code?: string;
  /** The code currently claimed by this event, resolved by the caller. */
  eventCode?: string | null;
  /** Epoch carried by a stored capability (web cookie / native token). */
  capEpoch?: number;
  isParticipant?: boolean;
  isGroupMember?: boolean;
  isGroupAdmin?: boolean;
};

export type DenyReason =
  | 'event_deleted'
  | 'unknown_policy'
  | 'no_credential'
  | 'stale_capability'
  | 'joins_closed'
  | 'uploads_closed'
  | 'host_only'
  | 'not_administrator'
  | 'sign_in_required'
  | 'approval_required';

export type Decision = { allow: true } | { allow: false; reason: DenyReason };

const ALLOW: Decision = { allow: true };
const deny = (reason: DenyReason): Decision => ({ allow: false, reason });

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

const KNOWN_POLICIES: readonly string[] = [PUBLIC, PRIVATE];

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
 * The person who made it, and a group's admins where it belongs to one.
 *
 * The case the boolean could not say. An evening where one person took the
 * photographs and everybody else is there to look at them is not the same as a
 * closed album, and offering only "open" and "closed" made it one or the other.
 *
 * Group admins are included because `administer` already treats them as the
 * host of anything in their group — an album nobody in the group could add to
 * except its original maker would strand the room's own archive the day that
 * person left.
 */
export const CONTRIBUTE_HOST = 'host';

/** Nobody, the maker included. An album that is finished is finished. */
export const CONTRIBUTE_NOBODY = 'nobody';

const KNOWN_CONTRIBUTE: readonly string[] = [
  CONTRIBUTE_EVERYONE,
  CONTRIBUTE_HOST,
  CONTRIBUTE_NOBODY,
];

export function authorize(
  actor: PolicyActor,
  capability: Capability,
  resource: { event: PolicyEvent },
  presented: Presented = {},
): Decision {
  const { event } = resource;

  if (event.deletedAt) return deny('event_deleted');

  // Fail closed on an unrecognised policy. When `paid_gallery` arrives it
  // branches here; an unexpected value must never fall through to the
  // permissive path.
  if (!KNOWN_POLICIES.includes(event.accessPolicy)) return deny('unknown_policy');

  // An actor is signed in when it has claimed an account. Device identity is
  // not enough: an actor exists for anyone who has ever loaded a page, which
  // is what makes "you can delete your own uploads" work without a login, and
  // exactly why it cannot stand in for one.
  const signedIn = actor?.hasAccount === true;

  const isCreator = actor != null && actor.id === event.createdBy;
  const isGroupAdmin = Boolean(presented.isGroupAdmin);
  const isGroupMember = Boolean(presented.isGroupMember) || isGroupAdmin;
  const isParticipant = Boolean(presented.isParticipant);

  // Administration is not something a link can grant, so it short-circuits
  // ahead of the credential checks below.
  if (capability === 'administer') {
    return isCreator || isGroupAdmin ? ALLOW : deny('not_administrator');
  }

  const viaLink = secretMatches(presented.linkToken, event.linkToken);
  const codeMatches = secretMatches(presented.code, presented.eventCode);
  const capFresh =
    presented.capEpoch !== undefined && presented.capEpoch === event.capEpoch;

  // A spoken code only counts as a credential in the hands of someone signed
  // in. It is the weakest secret in the system — short, said out loud across a
  // room, and recycled back into a shared pool once an event goes dormant — so
  // it names who is using it or it opens nothing.
  const viaCode = codeMatches && signedIn;

  /*
   * A public album needs no credential at all.
   *
   * This is the half of the simplification that is not in the column. It used
   * to be link_open — possession of the link *was* the access — and "public"
   * cannot mean that: an album listed on somebody's profile, opened by a
   * person who was never sent anything, is the whole point of the word. So for
   * `public` the link is a convenience for finding the thing, not the lock on
   * it.
   *
   * What that costs, said plainly: rotating the link no longer shuts anybody
   * out of a public album, because there is nothing to shut. The lever that
   * still works is the policy itself — switch it to private and everyone who
   * is not already a participant is out, which is the honest shape anyway.
   * `joins_open` is untouched and still overrides this below.
   */
  const isPublic = event.accessPolicy === PUBLIC;

  const hasCredential =
    isPublic ||
    viaLink ||
    viaCode ||
    isCreator ||
    isGroupMember ||
    (isParticipant && capFresh);

  if (!hasCredential) {
    // The code was right and the person is not signed in. Worth its own answer
    // rather than a 404: they typed it correctly, and telling them the code is
    // wrong sends them to find a code that does not exist.
    if (codeMatches) return deny('sign_in_required');
    // A participant whose stored capability predates a link rotation gets a
    // distinguishable answer, because the client can act on it: re-present the
    // new link rather than treat the event as gone.
    if (isParticipant && presented.capEpoch !== undefined && !capFresh) {
      return deny('stale_capability');
    }
    return deny('no_credential');
  }

  // Past this point the caller has proved they may know the event exists, so
  // denials can say why without becoming an oracle.

  // Private albums. The link is not a way in — it is a way to ask.
  if (event.accessPolicy === PRIVATE) {
    // Asked first, because "sign in" is the step in front of "ask", and
    // telling someone to wait for approval when they have not yet said who
    // they are sends them to wait for a decision nobody can make.
    if (!signedIn) return deny('sign_in_required');

    // Whatever credential got them this far, being in is a separate fact and
    // the person who made it owns it. `isParticipant` is what both doors
    // write — an accepted invitation and an approved request — so this reads
    // the same column `joins_open` does rather than inventing a second one.
    if (!(isCreator || isGroupMember || isParticipant)) {
      return deny('approval_required');
    }
  }

  // "New people can no longer join; everyone already in keeps access." Without
  // a record of who is already in, this switch cannot be enforced — which is
  // why `event_participant` exists.
  const alreadyIn = isParticipant || isGroupMember || isCreator;
  if (!event.joinsOpen && !alreadyIn) return deny('joins_closed');

  // Taking part names who took part, on every event and whatever its access
  // policy. Viewing a link-open event stays anonymous; contributing does not,
  // because an upload is the one action here that puts someone else's bytes in
  // front of strangers and has to be attributable afterwards — and a message
  // addresses a room.
  if ((capability === 'contribute' || capability === 'upload') && !signedIn) {
    return deny('sign_in_required');
  }

  if (capability === 'upload') {
    /*
     * Fail closed on an unrecognised policy, exactly as the access policy does
     * above: a value nobody has taught this function about must shut the album
     * rather than open it. It is also what makes the migration off
     * `uploads_open` safe in either order.
     */
    if (!KNOWN_CONTRIBUTE.includes(event.contributePolicy)) return deny('uploads_closed');

    if (event.contributePolicy === CONTRIBUTE_NOBODY) return deny('uploads_closed');

    /*
     * `host` is the creator and a group's admins, and nobody else — including
     * people who are otherwise fully in the album. It is the one setting here
     * that denies somebody who can see everything and was invited by name, so
     * it gets a reason of its own: "closed" and "not yours to add to" are
     * different sentences and a client should be able to say which.
     */
    if (event.contributePolicy === CONTRIBUTE_HOST && !(isCreator || isGroupAdmin)) {
      return deny('host_only');
    }
  }

  return ALLOW;
}

/**
 * HTTP status for a denial.
 *
 * Everything that would confirm an event exists to someone without a valid
 * credential answers 404. Only callers who have already proved access get a
 * 403 that distinguishes *why* — otherwise the status code itself becomes an
 * oracle for probing link tokens.
 */
export function denyStatus(reason: DenyReason): 404 | 403 {
  switch (reason) {
    case 'event_deleted':
    case 'no_credential':
    case 'unknown_policy':
      return 404;
    case 'stale_capability':
    case 'joins_closed':
    case 'uploads_closed':
    case 'host_only':
    case 'not_administrator':
    // 403, not 404: every path that reaches this has already presented a real
    // credential, so the event's existence is not being disclosed by saying
    // so — and the client needs to tell these apart from "gone" to know it
    // should offer a sign-in rather than an apology.
    case 'sign_in_required':
    // Also 403 and for the same reason: they hold the link, so the event's
    // existence is not news to them, and the client has to tell "ask the host"
    // apart from "gone" to know it should offer the button rather than an
    // apology.
    case 'approval_required':
      return 403;
  }
}

function secretMatches(
  presented: string | undefined,
  actual: string | null | undefined,
): boolean {
  if (!presented || !actual) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(actual);
  // Length is not secret for fixed-width tokens, and timingSafeEqual throws on
  // a mismatch, so compare lengths first.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
