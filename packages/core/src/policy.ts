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

export type Capability = 'view' | 'contribute' | 'download' | 'administer';

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
  uploadsOpen: boolean;
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
  | 'not_administrator'
  | 'sign_in_required';

export type Decision = { allow: true } | { allow: false; reason: DenyReason };

const ALLOW: Decision = { allow: true };
const deny = (reason: DenyReason): Decision => ({ allow: false, reason });

/** Possession of the link is the access model. Anyone holding it may view. */
export const LINK_OPEN = 'link_open';

/**
 * The link gets you to the door; an account gets you in.
 *
 * Chosen per event by whoever created it. The link token is still required and
 * still not sufficient: a private event handed to someone signed out denies
 * with `sign_in_required` rather than 404, because they hold a real credential
 * and the fix is an action they can take.
 */
export const ACCOUNT_REQUIRED = 'account_required';

const KNOWN_POLICIES: readonly string[] = [LINK_OPEN, ACCOUNT_REQUIRED];

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

  const hasCredential =
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

  // Private events. The link is necessary and not sufficient.
  if (event.accessPolicy === ACCOUNT_REQUIRED && !signedIn) {
    return deny('sign_in_required');
  }

  // "New people can no longer join; everyone already in keeps access." Without
  // a record of who is already in, this switch cannot be enforced — which is
  // why `event_participant` exists.
  const alreadyIn = isParticipant || isGroupMember || isCreator;
  if (!event.joinsOpen && !alreadyIn) return deny('joins_closed');

  // Adding photos names who added them, on every event and whatever its access
  // policy. Viewing a link-open event stays anonymous; contributing does not,
  // because an upload is the one action here that puts someone else's bytes in
  // front of strangers and has to be attributable afterwards.
  if (capability === 'contribute' && !signedIn) {
    return deny('sign_in_required');
  }

  if (capability === 'contribute' && !event.uploadsOpen) {
    return deny('uploads_closed');
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
    case 'not_administrator':
    // 403, not 404: every path that reaches this has already presented a real
    // credential, so the event's existence is not being disclosed by saying
    // so — and the client needs to tell these apart from "gone" to know it
    // should offer a sign-in rather than an apology.
    case 'sign_in_required':
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
