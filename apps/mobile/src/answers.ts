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
 * A second vocabulary has joined it at the foot of this file — `reasonFor`,
 * which is the words a Find Friends row says about why somebody is on it. Here
 * rather than on that screen for two reasons, and the first is the ordinary one:
 * this file is platform-free, so its words can be tested without a simulator,
 * which is exactly the boundary `api.test.ts` describes. The second is that both
 * halves of this file are the same kind of thing — the sentences the product
 * uses about other people, in the one place a new case cannot be added without
 * somebody deciding what it says.
 *
 * What survives is the vocabulary, because it is the half that must not drift:
 * a `Record` over the union rather than a lookup with a default, so a new kind
 * of ask cannot be added without somebody deciding what its two buttons say.
 * That is not hypothetical — `group_invite` reached the client with no entry
 * here and drew a card with no words on its buttons.
 */

import type { PendingRequest, Recommendation } from './api';

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

/**
 * Why somebody is on the list, in the words the row will use.
 *
 * Strongest reason first and one reason only. A row reading "2 mutual friends ·
 * 1 album together · 1 group together" is three facts about a stranger before
 * anybody has decided whether they recognise the name — and the first of them
 * is already the whole argument. The others are why the ordering is what it is,
 * not something to print.
 *
 * Mutual friends lead because they are other people having already vouched. An
 * album is "we were in the same room". A group is only "we are both on a list",
 * which is the weakest of the three and still worth saying, because it names a
 * room the reader can go and look at.
 */
export function reasonFor(person: Recommendation): string {
  const mutuals = person.mutuals ?? 0;
  const albums = person.albums ?? 0;
  const groups = person.groups ?? 0;
  if (mutuals > 0) {
    return `${mutuals} mutual ${mutuals === 1 ? 'friend' : 'friends'}`;
  }
  if (albums > 0) {
    return albums === 1 ? 'In a roll with you' : `In ${albums} rolls with you`;
  }
  if (groups > 0) {
    return groups === 1 ? 'In a group with you' : `In ${groups} groups with you`;
  }
  /*
   * Nothing to say, which the server will not produce — a row is on the list
   * because one of the three is non-zero. It exists because this build can be
   * talking to a deploy from before those fields shipped, and the alternative
   * on that day is a row reading "0 mutual friends".
   */
  return 'You may know them';
}
