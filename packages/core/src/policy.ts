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

export type PolicyActor = { id: string } | null;

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
  | 'not_administrator';

export type Decision = { allow: true } | { allow: false; reason: DenyReason };

const ALLOW: Decision = { allow: true };
const deny = (reason: DenyReason): Decision => ({ allow: false, reason });

/** The only policy in v1. `event.access_policy` exists so there can be others. */
export const LINK_OPEN = 'link_open';

export function authorize(
  actor: PolicyActor,
  capability: Capability,
  resource: { event: PolicyEvent },
  presented: Presented = {},
): Decision {
  const { event } = resource;

  if (event.deletedAt) return deny('event_deleted');

  // Fail closed on an unrecognised policy. When `paid_gallery` arrives it
  // branches here; until then an unexpected value must never fall through to
  // the permissive path.
  if (event.accessPolicy !== LINK_OPEN) return deny('unknown_policy');

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
  const viaCode = secretMatches(presented.code, presented.eventCode);
  const capFresh =
    presented.capEpoch !== undefined && presented.capEpoch === event.capEpoch;

  const hasCredential =
    viaLink ||
    viaCode ||
    isCreator ||
    isGroupMember ||
    (isParticipant && capFresh);

  if (!hasCredential) {
    // A participant whose stored capability predates a link rotation gets a
    // distinguishable answer, because the client can act on it: re-present the
    // new link rather than treat the event as gone.
    if (isParticipant && presented.capEpoch !== undefined && !capFresh) {
      return deny('stale_capability');
    }
    return deny('no_credential');
  }

  // "New people can no longer join; everyone already in keeps access." Without
  // a record of who is already in, this switch cannot be enforced — which is
  // why `event_participant` exists.
  const alreadyIn = isParticipant || isGroupMember || isCreator;
  if (!event.joinsOpen && !alreadyIn) return deny('joins_closed');

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
