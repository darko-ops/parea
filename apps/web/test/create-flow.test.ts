/**
 * The shape of making an event, as the screen now asks it.
 *
 * Three switches where there used to be four, a guest list, and an ending that
 * is the event rather than a page about it.
 * Every one of those is a decision somebody can get wrong on the way back
 * through, and the ones worth pinning are the ones where the screen and the
 * database can disagree without anything looking broken.
 */

import { PRIVATE, PUBLIC } from '@parea/core';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { policyFor } from '../app/components/AccessChoice';
import { promise } from '../app/components/ShareEvent';
import { stripComments } from './support/source';

const read = (path: string) =>
  stripComments(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

const CREATE = read('../app/page.tsx');
const ROUTE = read('../app/api/events/route.ts');

describe('one switch, two policies', () => {
  /*
   * `policyFor` is the only place the switch becomes a policy, and it is
   * shared with the manage screen. There used to be a second switch — "I
   * approve each person" — and the mapping was the un-obvious part: approval
   * was not a fourth setting beside private, it was private plus a step. It is
   * gone, because approval is what private does now.
   */
  it('is public until somebody says otherwise', () => {
    expect(policyFor({ isPrivate: false })).toBe(PUBLIC);
  });

  it('is added-or-let-in for private', () => {
    expect(policyFor({ isPrivate: true })).toBe(PRIVATE);
  });

  it('offers nothing between the two', () => {
    // The regression this file exists to catch: a third value creeping back in
    // as a special case somewhere other than here.
    expect(new Set([policyFor({ isPrivate: false }), policyFor({ isPrivate: true })]).size)
      .toBe(2);
  });

  it('is what the form sends, rather than a second copy of the rule', () => {
    expect(CREATE).toMatch(/accessPolicy: policyFor\(\{ isPrivate \}\)/);
  });

  it('has no approval switch left to disagree with the policy', () => {
    // Two switches writing one column is how "private" came to mean two
    // different things. There is one switch now, and this is what says so.
    expect(CREATE).not.toMatch(/setApprove|Manually approve/);
  });
});

describe('the other two switches are their own facts', () => {
  it('the link switch is the join switch, and defaults open', () => {
    // `joinsOpen` is the only thing `authorize` can actually enforce a "not by
    // link" with — it is read before the policy and after participation, so it
    // stops new people without evicting anybody.
    expect(CREATE).toMatch(/const \[linkJoins, setLinkJoins\] = useState\(true\)/);
    expect(CREATE).toContain('linkJoins,');
    expect(ROUTE).toMatch(/joinsOpen: body\.linkJoins === false \? false : true/);
  });

  it('the phrase is claimed only when it is asked for', () => {
    /*
     * The pool is finite and shared. Every event used to take a phrase whether
     * or not anybody would ever say it out loud, which is a phrase no other
     * event can have — and the panel that displayed it is gone, so nobody
     * would even have seen it.
     */
    expect(CREATE).toMatch(/const \[passPhrase, setPassPhrase\] = useState\(false\)/);
    expect(ROUTE).toMatch(/body\.passPhrase === true \? await claimCode\(/);
  });
});

describe('the questions it asks, and the one it stopped asking', () => {
  it('labels the two text fields as the event says them', () => {
    expect(CREATE).toContain('EVENT TITLE');
    expect(CREATE).toContain('CAPTION');
    expect(CREATE).not.toContain('WHAT WAS IT?');
  });

  it('has no when section left, in markup or in state', () => {
    expect(CREATE).not.toMatch(/WHEN_OPTIONS|setWhen|windowFor/);
  });

  it('picks members without adding them to anything', () => {
    // The picker holds a choice; the invitations go out once there is an event
    // to be invited to, and they are invitations — being added to somebody
    // else's event is an offer, not a fact.
    expect(CREATE).toMatch(/\/invites`/);
    const invite = CREATE.indexOf('/invites`');
    const created = CREATE.indexOf('const created = (await res.json())');
    expect(created).toBeLessThan(invite);
  });

  it('does not fail the event when the invitations fail', () => {
    // The event is the thing that was asked for. A guest list is one tap away
    // afterwards, on the Members tab.
    const invite = CREATE.slice(CREATE.indexOf('/invites`'));
    expect(invite.slice(0, 320)).toMatch(/\.catch\(\(\) => \{\}\)/);
  });
});

describe('what the share panel promises the person receiving the link', () => {
  /*
   * The sentence under a link somebody is about to paste into a group chat.
   * It said "anybody with this can open the event and add their photos" on
   * every event, which is true of exactly one of the policies — and the person
   * reading it is deciding, on the strength of it, who to send it to.
   */
  it('is the plain truth for a public event', () => {
    expect(promise(PUBLIC, true)).toMatch(/Anybody with this can open the event/);
  });

  it('does not promise entry when entry has to be granted', () => {
    const said = promise(PRIVATE, true);
    expect(said).toMatch(/can ask to come in/);
    expect(said).not.toMatch(/straight in|Anybody with this/);
  });

  it('lets the link switch override both, because it does', () => {
    // Joins closed means nobody new gets in however the event is set, so this
    // is checked before the policy rather than after.
    for (const policy of [PUBLIC, PRIVATE]) {
      expect(promise(policy, false), policy).toMatch(/The link is off for this event/);
    }
  });

  it('does not put the spoken phrase beside the link', () => {
    /*
     * They are two different doors and were being shown as one act. A phrase
     * is for somebody across a room whose phone you are not holding; printing
     * it under a URL somebody is about to paste into a chat offers a second
     * secret nobody asked for, on the event's weakest one. It lives on the
     * manage screen, beside the switch that decides whether there is one.
     */
    const panel = read('../app/components/ShareEvent.tsx');
    expect(panel).not.toMatch(/Or say/);
    expect(panel).not.toMatch(/\bcode\b/);
  });

  it('falls back to the public wording when the field is missing', () => {
    // An older cached payload, or a caller not yet updated. `undefined` means
    // the field was not sent, which only happens on a public-by-default path.
    expect(promise(undefined, true)).toMatch(/Anybody with this/);
  });
});
