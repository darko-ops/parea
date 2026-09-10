/**
 * The authorization matrix — docs/design.md §16.2.
 *
 * "This is the file that will be wrong in a year." Table-driven over actor kind
 * × capability × switch state × credential, so a change in the policy shows up
 * as a diff in expected outcomes rather than as a quiet behaviour change.
 */

import { describe, expect, it } from 'vitest';

import {
  authorize,
  denyStatus,
  type Capability,
  type DenyReason,
  type PolicyEvent,
  type Presented,
} from '../src/policy';

const CREATOR = 'actor-creator';
const GUEST = 'actor-guest';
const LINK = 'aaaaaaaaaaaaaaaaaaaaaa';
const WRONG_LINK = 'bbbbbbbbbbbbbbbbbbbbbb';
const CODE = 'amber-fox';

function event(overrides: Partial<PolicyEvent> = {}): PolicyEvent {
  return {
    id: 'event-1',
    linkToken: LINK,
    capEpoch: 1,
    accessPolicy: 'public',
    joinsOpen: true,
    uploadsOpen: true,
    createdBy: CREATOR,
    groupId: null,
    deletedAt: null,
    ...overrides,
  };
}

type Case = {
  name: string;
  actor: string | null;
  /** Whether that actor has claimed an account. Absent means signed out. */
  signedIn?: boolean;
  capability: Capability;
  event?: Partial<PolicyEvent>;
  presented?: Presented;
  expect: true | DenyReason;
};

const CASES: Case[] = [
  // --- public: anyone can see it ---------------------------------------------
  // The link is how somebody finds a public album, not what unlocks it. All
  // four of these were `no_credential` when the policy was called `link_open`.
  { name: 'a stranger with nothing at all can view a public album', actor: null,
    capability: 'view', expect: true },
  { name: 'and can download from it', actor: GUEST, capability: 'download', expect: true },
  { name: 'a wrong link is no worse than no link on a public album', actor: GUEST,
    capability: 'view', presented: { linkToken: WRONG_LINK }, expect: true },
  { name: 'rotating the link does not shut anyone out of a public album', actor: GUEST,
    capability: 'view', event: { capEpoch: 2 },
    presented: { isParticipant: true, capEpoch: 1 }, expect: true },
  { name: 'stranger with the link can view', actor: null, capability: 'view',
    presented: { linkToken: LINK }, expect: true },
  { name: 'the link plus an account can contribute', actor: GUEST, signedIn: true,
    capability: 'contribute', presented: { linkToken: LINK }, expect: true },
  { name: 'the link alone can no longer contribute', actor: GUEST, capability: 'contribute',
    presented: { linkToken: LINK }, expect: 'sign_in_required' },
  { name: 'looking stays anonymous, adding does not', actor: GUEST,
    capability: 'contribute', expect: 'sign_in_required' },

  // --- credentials, which is now a question only private albums ask ----------
  { name: 'no credential at all is refused on a private album', actor: GUEST,
    signedIn: true, capability: 'view', event: { accessPolicy: 'private' },
    expect: 'no_credential' },
  { name: 'a wrong link is not a credential', actor: GUEST, signedIn: true,
    capability: 'view', event: { accessPolicy: 'private' },
    presented: { linkToken: WRONG_LINK }, expect: 'no_credential' },

  // --- codes -----------------------------------------------------------------
  { name: 'the event code grants access to someone signed in', actor: GUEST,
    signedIn: true, capability: 'contribute',
    presented: { code: CODE, eventCode: CODE }, expect: true },
  { name: 'the right code signed out asks for sign-in, not a better code', actor: GUEST,
    capability: 'view', event: { accessPolicy: 'private' },
    presented: { code: CODE, eventCode: CODE }, expect: 'sign_in_required' },
  { name: 'a wrong code signed out is still just wrong', actor: GUEST, capability: 'view',
    event: { accessPolicy: 'private' },
    presented: { code: 'silver-otter', eventCode: CODE }, expect: 'no_credential' },
  { name: 'a code against an event holding none does not', actor: GUEST, capability: 'view',
    event: { accessPolicy: 'private' }, presented: { code: CODE, eventCode: null },
    expect: 'no_credential' },

  // --- stored capabilities and rotation --------------------------------------
  { name: 'participant with a fresh capability needs no link', actor: GUEST, signedIn: true,
    capability: 'view', event: { accessPolicy: 'private' },
    presented: { isParticipant: true, capEpoch: 1 }, expect: true },
  { name: 'rotation invalidates a stored capability', actor: GUEST, signedIn: true,
    capability: 'view', event: { accessPolicy: 'private', capEpoch: 2 },
    presented: { isParticipant: true, capEpoch: 1 },
    expect: 'stale_capability' },
  { name: 'after rotation the new link still works', actor: GUEST, signedIn: true,
    capability: 'view',
    event: { accessPolicy: 'private', capEpoch: 2, linkToken: WRONG_LINK },
    presented: { isParticipant: true, capEpoch: 1, linkToken: WRONG_LINK }, expect: true },
  { name: 'a non-participant cannot bluff a fresh epoch', actor: GUEST, signedIn: true,
    capability: 'view', event: { accessPolicy: 'private' },
    presented: { capEpoch: 1 }, expect: 'no_credential' },

  // --- switch: joins ---------------------------------------------------------
  { name: 'joins closed refuses a new person holding the link', actor: GUEST, capability: 'view',
    event: { joinsOpen: false }, presented: { linkToken: LINK }, expect: 'joins_closed' },
  { name: 'joins closed refuses a new person on a public album too', actor: GUEST,
    capability: 'view', event: { joinsOpen: false }, expect: 'joins_closed' },
  { name: 'joins closed keeps existing participants in', actor: GUEST, capability: 'view',
    event: { joinsOpen: false }, presented: { isParticipant: true, capEpoch: 1 }, expect: true },
  { name: 'joins closed keeps group members in', actor: GUEST, capability: 'download',
    event: { joinsOpen: false, groupId: 'g1' }, presented: { isGroupMember: true }, expect: true },
  { name: 'joins closed never locks out the creator', actor: CREATOR, capability: 'view',
    event: { joinsOpen: false }, expect: true },

  // --- switch: uploads -------------------------------------------------------
  { name: 'uploads closed blocks contribution', actor: GUEST, signedIn: true,
    capability: 'contribute', event: { uploadsOpen: false },
    presented: { linkToken: LINK }, expect: 'uploads_closed' },
  { name: 'uploads closed leaves viewing alone', actor: GUEST, capability: 'view',
    event: { uploadsOpen: false }, presented: { linkToken: LINK }, expect: true },
  { name: 'uploads closed leaves downloading alone', actor: GUEST, capability: 'download',
    event: { uploadsOpen: false }, presented: { linkToken: LINK }, expect: true },
  { name: 'uploads closed applies to the creator too', actor: CREATOR, signedIn: true,
    capability: 'contribute', event: { uploadsOpen: false }, expect: 'uploads_closed' },

  // --- administration --------------------------------------------------------
  { name: 'the creator administers', actor: CREATOR, capability: 'administer', expect: true },
  { name: 'a group admin administers', actor: GUEST, capability: 'administer',
    event: { groupId: 'g1' }, presented: { isGroupAdmin: true }, expect: true },
  { name: 'a plain group member does not', actor: GUEST, capability: 'administer',
    event: { groupId: 'g1' }, presented: { isGroupMember: true }, expect: 'not_administrator' },
  { name: 'holding the link does not confer administration', actor: GUEST,
    capability: 'administer', presented: { linkToken: LINK }, expect: 'not_administrator' },
  { name: 'a public album is still not administered by whoever opens it', actor: GUEST,
    signedIn: true, capability: 'administer', expect: 'not_administrator' },
  { name: 'an anonymous visitor does not administer', actor: null, capability: 'administer',
    presented: { linkToken: LINK }, expect: 'not_administrator' },

  // --- private: added, or let in ---------------------------------------------
  // The distinguishing property, and the whole reason the policy exists:
  // holding the link is not the last step, the creator is.
  { name: 'private refuses a signed-in link holder until approved', actor: GUEST,
    signedIn: true, capability: 'view', event: { accessPolicy: 'private' },
    presented: { linkToken: LINK }, expect: 'approval_required' },
  { name: 'private asks for sign-in before it asks for approval', actor: GUEST,
    capability: 'view', event: { accessPolicy: 'private' },
    presented: { linkToken: LINK }, expect: 'sign_in_required' },
  { name: 'being in is a participant row, and it lets them in', actor: GUEST,
    signedIn: true, capability: 'view', event: { accessPolicy: 'private' },
    presented: { linkToken: LINK, isParticipant: true, capEpoch: 1 }, expect: true },
  { name: 'a private album does not trap a signed-out participant either',
    actor: GUEST, capability: 'view', event: { accessPolicy: 'private' },
    presented: { isParticipant: true, capEpoch: 1 }, expect: 'sign_in_required' },
  { name: 'the creator never has to ask themselves', actor: CREATOR, signedIn: true,
    capability: 'view', event: { accessPolicy: 'private' }, expect: true },
  { name: 'a group member is already in', actor: GUEST, signedIn: true, capability: 'view',
    event: { accessPolicy: 'private', groupId: 'g1' },
    presented: { isGroupMember: true }, expect: true },
  // The code is the weakest secret in the system; it must not be a way around
  // the one policy whose point is that the creator decides.
  { name: 'the spoken code does not skip approval', actor: GUEST, signedIn: true,
    capability: 'view', event: { accessPolicy: 'private' },
    presented: { code: CODE, eventCode: CODE }, expect: 'approval_required' },
  { name: 'nor does download', actor: GUEST, signedIn: true, capability: 'download',
    event: { accessPolicy: 'private' }, presented: { linkToken: LINK },
    expect: 'approval_required' },
  { name: 'nor does contribute', actor: GUEST, signedIn: true, capability: 'contribute',
    event: { accessPolicy: 'private' }, presented: { linkToken: LINK },
    expect: 'approval_required' },

  // --- deletion and unknown policies -----------------------------------------
  { name: 'a deleted event is gone for the creator too', actor: CREATOR, capability: 'view',
    event: { deletedAt: new Date() }, expect: 'event_deleted' },
  { name: 'a deleted event cannot be administered', actor: CREATOR, capability: 'administer',
    event: { deletedAt: new Date() }, expect: 'event_deleted' },
  { name: 'an unknown policy fails closed, even for the creator', actor: CREATOR,
    capability: 'view', event: { accessPolicy: 'paid_gallery' }, expect: 'unknown_policy' },
  { name: 'the policies this replaced are unknown, and so fail closed', actor: CREATOR,
    capability: 'view', event: { accessPolicy: 'account_required' },
    expect: 'unknown_policy' },
  { name: 'an unknown policy blocks administration', actor: CREATOR, capability: 'administer',
    event: { accessPolicy: 'paid_gallery' }, expect: 'unknown_policy' },
];

describe('authorize', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const decision = authorize(
        c.actor ? { id: c.actor, hasAccount: c.signedIn === true } : null,
        c.capability,
        { event: event(c.event) },
        c.presented,
      );
      if (c.expect === true) {
        expect(decision).toEqual({ allow: true });
      } else {
        expect(decision).toEqual({ allow: false, reason: c.expect });
      }
    });
  }
});

describe('denyStatus', () => {
  it('does not confirm an event exists to someone without a credential', () => {
    // Otherwise the status code is an oracle for probing link tokens.
    expect(denyStatus('no_credential')).toBe(404);
    expect(denyStatus('event_deleted')).toBe(404);
    expect(denyStatus('unknown_policy')).toBe(404);
  });

  it('explains itself to callers who already proved access', () => {
    expect(denyStatus('joins_closed')).toBe(403);
    expect(denyStatus('uploads_closed')).toBe(403);
    expect(denyStatus('not_administrator')).toBe(403);
    expect(denyStatus('stale_capability')).toBe(403);
    expect(denyStatus('sign_in_required')).toBe(403);
  });
});

describe('invariants', () => {
  const capabilities: Capability[] = ['view', 'contribute', 'download', 'administer'];

  it('never allows anything on a deleted event', () => {
    for (const capability of capabilities) {
      for (const actor of [
        null,
        { id: CREATOR, hasAccount: true },
        { id: GUEST, hasAccount: true },
      ]) {
        const decision = authorize(actor, capability, {
          event: event({ deletedAt: new Date() }),
        }, { linkToken: LINK, isGroupAdmin: true, isParticipant: true, capEpoch: 1 });
        expect(decision.allow, `${capability}`).toBe(false);
      }
    }
  });

  it('never allows anything under an unrecognised policy', () => {
    for (const capability of capabilities) {
      const decision = authorize({ id: CREATOR, hasAccount: true }, capability, {
        event: event({ accessPolicy: 'something_new' }),
      }, { linkToken: LINK, isGroupAdmin: true });
      expect(decision.allow, `${capability}`).toBe(false);
    }
  });

  /*
   * The invariant that used to read "grants nothing without some credential",
   * now said about the policy that still means it. A public album deliberately
   * grants view, download and contribute to somebody holding nothing — that is
   * what the word promises — so the property worth pinning is that a private
   * one grants none of the four.
   */
  it('grants nothing on a private album without some credential', () => {
    for (const capability of capabilities) {
      const decision = authorize(
        { id: GUEST, hasAccount: true },
        capability,
        { event: event({ accessPolicy: 'private' }) },
        {},
      );
      expect(decision.allow, `${capability}`).toBe(false);
    }
  });

  it('never lets a public album be administered by a passer-by', () => {
    const decision = authorize(
      { id: GUEST, hasAccount: true },
      'administer',
      { event: event() },
      { linkToken: LINK },
    );
    expect(decision.allow).toBe(false);
  });
});
