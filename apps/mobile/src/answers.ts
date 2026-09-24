/**
 * What the two buttons under an ask are called.
 *
 * This file was a bubble at the top of Home holding everything waiting on an
 * answer — an invitation to an album, an invitation to a group, a friend
 * request, somebody asking into an album you run. It argued that Home is where
 * somebody looks first, and that a fourth tab for a usually-empty list would
 * cost a permanent quarter of the tab bar. Both were right.
 *
 * Lately is what replaced it: the same four asks, with the feed of what has
 * already happened underneath them, behind the envelope in the Groups heading.
 * Keeping the bubble as well would have put the same request on the screen
 * twice — answered in one place and still sitting in the other, which reads as
 * the answer not having taken. `activity.ts` names that failure on the server
 * side; it is why an answered friend request leaves the queue there.
 *
 * What survives is the vocabulary, because it is the half that must not drift:
 * a `Record` over the union rather than a lookup with a default, so a new kind
 * of ask cannot be added without somebody deciding what its two buttons say.
 * That is not hypothetical — `group_invite` reached the client with no entry
 * here and drew a card with no words on its buttons.
 */

import type { PendingRequest } from './api';

/**
 * What the two buttons are called, per kind.
 *
 * Exported because Lately answers the same five asks with the same two words,
 * and a second copy is a screen where declining a group invitation is called
 * something else. A `Record` over the kind rather than a lookup with a default:
 * the type is what caught `group_invite` missing here, which had been arriving
 * from the server since groups gained invitations and drawing a card with no
 * label on either button.
 */
export const ANSWERS: Record<PendingRequest['kind'], { yes: string; no: string }> = {
  invite: { yes: 'Accept', no: 'Decline' },
  group_invite: { yes: 'Accept', no: 'Decline' },
  friend: { yes: 'Accept', no: 'Decline' },
  // A door being opened onto photographs of an evening. "Accept" is the word
  // for agreeing to something, which is not what this is.
  join: { yes: 'Let in', no: 'Not now' },
  // Not "Let in": they are already in. What is being asked for is the ability
  // to add photographs to an album they can already see, so the word is the
  // thing itself rather than a door.
  host: { yes: 'Let them add', no: 'Not now' },
};

