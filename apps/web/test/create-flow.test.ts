/**
 * The shape of making an album, as the screen now asks it.
 *
 * Four switches where there used to be a choice between two named modes, a
 * guest list, and an ending that is the album rather than a page about it.
 * Every one of those is a decision somebody can get wrong on the way back
 * through, and the ones worth pinning are the ones where the screen and the
 * database can disagree without anything looking broken.
 */

import { ACCOUNT_REQUIRED, LINK_OPEN, REQUEST_ACCESS } from '@parea/core';
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

describe('two switches, three policies', () => {
  /*
   * `policyFor` is the only place the switches become a policy, and it is
   * shared with the manage screen. The mapping is not obvious in one
   * direction: "I approve each person" is not a fourth setting sitting beside
   * private, it *is* private plus a step, and the column can only hold one
   * value.
   */
  it('is public until somebody says otherwise', () => {
    expect(policyFor({ isPrivate: false, approve: false })).toBe(LINK_OPEN);
  });

  it('is sign-in-and-you-are-in for private', () => {
    // The setting most people mean, and the one the web form did not offer
    // until now: the link admits, the account names them, nobody queues.
    expect(policyFor({ isPrivate: true, approve: false })).toBe(ACCOUNT_REQUIRED);
  });

  it('is approval whenever approval is asked for', () => {
    expect(policyFor({ isPrivate: true, approve: true })).toBe(REQUEST_ACCESS);
    // Even from a public switch position, because the screen forces private on
    // when this goes on and the two must not be able to disagree.
    expect(policyFor({ isPrivate: false, approve: true })).toBe(REQUEST_ACCESS);
  });

  it('is what the form sends, rather than a second copy of the rule', () => {
    expect(CREATE).toMatch(/accessPolicy: policyFor\(\{ isPrivate, approve \}\)/);
  });

  it('keeps the two switches consistent in both directions', () => {
    // Turning approval on implies private; turning private off cannot leave
    // approval standing, or the screen says one thing and the row says another.
    expect(CREATE).toMatch(/setApprove\(next\);[\s\S]{0,80}if \(next\) setIsPrivate\(true\)/);
    expect(CREATE).toMatch(/setIsPrivate\(next\);[\s\S]{0,120}if \(!next\) setApprove\(false\)/);
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
     * The pool is finite and shared. Every album used to take a phrase whether
     * or not anybody would ever say it out loud, which is a phrase no other
     * album can have — and the panel that displayed it is gone, so nobody
     * would even have seen it.
     */
    expect(CREATE).toMatch(/const \[passPhrase, setPassPhrase\] = useState\(false\)/);
    expect(ROUTE).toMatch(/body\.passPhrase === true \? await claimCode\(/);
  });
});

describe('the questions it asks, and the one it stopped asking', () => {
  it('labels the two text fields as the album says them', () => {
    expect(CREATE).toContain('ALBUM TITLE');
    expect(CREATE).toContain('CAPTION');
    expect(CREATE).not.toContain('WHAT WAS IT?');
  });

  it('has no when section left, in markup or in state', () => {
    expect(CREATE).not.toMatch(/WHEN_OPTIONS|setWhen|windowFor/);
  });

  it('picks members without adding them to anything', () => {
    // The picker holds a choice; the invitations go out once there is an album
    // to be invited to, and they are invitations — being added to somebody
    // else's album is an offer, not a fact.
    expect(CREATE).toMatch(/\/invites`/);
    const invite = CREATE.indexOf('/invites`');
    const created = CREATE.indexOf('const created = (await res.json())');
    expect(created).toBeLessThan(invite);
  });

  it('does not fail the album when the invitations fail', () => {
    // The album is the thing that was asked for. A guest list is one tap away
    // afterwards, on the Members tab.
    const invite = CREATE.slice(CREATE.indexOf('/invites`'));
    expect(invite.slice(0, 320)).toMatch(/\.catch\(\(\) => \{\}\)/);
  });
});

describe('what the share panel promises the person receiving the link', () => {
  /*
   * The sentence under a link somebody is about to paste into a group chat.
   * It said "anybody with this can open the event and add their photos" on
   * every album, which is true of exactly one of the three policies — and the
   * person reading it is deciding, on the strength of it, who to send it to.
   */
  it('is the plain truth for a public album', () => {
    expect(promise(LINK_OPEN, true)).toMatch(/Anybody with this can open the album/);
  });

  it('says what private actually costs the recipient', () => {
    expect(promise(ACCOUNT_REQUIRED, true)).toMatch(/signs in and is straight in/);
  });

  it('does not promise entry when entry has to be granted', () => {
    const said = promise(REQUEST_ACCESS, true);
    expect(said).toMatch(/can ask to come in/);
    expect(said).not.toMatch(/straight in|Anybody with this/);
  });

  it('lets the link switch override all three, because it does', () => {
    // Joins closed means nobody new gets in however the album is set, so this
    // is checked before the policy rather than after.
    for (const policy of [LINK_OPEN, ACCOUNT_REQUIRED, REQUEST_ACCESS]) {
      expect(promise(policy, false), policy).toMatch(/The link is off for this album/);
    }
  });

  it('falls back to the public wording when the field is missing', () => {
    // An older cached payload, or a caller not yet updated. `undefined` means
    // the field was not sent, which only happens on a public-by-default path.
    expect(promise(undefined, true)).toMatch(/Anybody with this/);
  });
});
