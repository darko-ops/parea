/**
 * Hosts of an album, on a phone.
 *
 * The app's half of the change the server describes in `event-hosts.test.ts`:
 * "Only me" now means one person and "Hosts" means a set that somebody can be
 * added to or ask to join. Source checks, because there is no renderer here.
 *
 * What they guard is the pair of rules that stop the two clients drifting: the
 * words come from one place and match the website's, and every decision about
 * who may do what is read off the server rather than re-derived from
 * `contributePolicy`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const API = read('src/api.ts');
const THREAD = read('src/Thread.tsx');

describe('asking to be a host', () => {
  it('says why the `+` is dim, and offers the one thing to do', () => {
    /*
     * A disabled button with no sentence beside it is the app looking broken:
     * the reader can see the album, can talk in it, and cannot work out why
     * the one control they came for is greyed.
     */
    expect(APP).toMatch(/Hosts add the photographs here\./);
    expect(APP).toMatch(/Ask to be a host/);
  });

  it('draws it off the server’s answer, not off the policy', () => {
    /*
     * `canAsk` is decided once, beside `canAdd`, for the same reason `canAdd`
     * is: re-deriving it here from `contributePolicy` would be the policy
     * written a third time, and the day it drifts the app offers a button the
     * server refuses. An album set to "Only me" therefore says its piece and
     * offers nothing, which is correct — there is no set to join.
     */
    expect(APP).toMatch(/feed && !feed\.canAdd && feed\.hosting\.canAsk/);
    expect(API).toMatch(/hosting: \{/);
    expect(API).toMatch(/canAsk: boolean;/);
  });

  it('takes the server’s status rather than assuming an open one', () => {
    // A repeat ask on something already declined comes back `declined` rather
    // than reopening it, and a line that said "Asked" over that would be
    // pressing past somebody's no on their behalf.
    expect(APP).toMatch(/setHostAsk\(\(body\.status as/);
    // And the local guess is dropped the moment a feed lands, like the
    // visibility pills' — left standing it would outrank another device.
    expect(APP).toMatch(/setAdding\(null\);\s*\n\s*setHostAsk\(null\);/);
  });
});

describe('handing the camera over', () => {
  it('offers the promotion only where it means something', () => {
    /*
     * Somebody already in — an open invitation has no participant row and so
     * no role to set. Not the creator, who is a host by being the creator and
     * whose row the server refuses to write. And only on an album set to
     * `host`: on `everyone` they can already add, and on `creator` the point
     * is that there is no set to join.
     */
    expect(THREAD).toMatch(/canAdminister &&\s*\n\s*hosted &&/);
    expect(THREAD).toMatch(/item\.role !== 'creator'/);
    expect(THREAD).toMatch(/Make a host/);
  });

  it('follows the live setting rather than a poll behind it', () => {
    // `adding` is the local guess the pills answer with; the feed is the truth
    // once it lands. So the control appears the moment the sheet above changes
    // the setting, and goes again if it is changed back.
    expect(APP).toMatch(/hosted=\{\(adding \?\? feed\?\.event\.contributePolicy\) === 'host'\}/);
  });

  it('re-reads the roster rather than flipping the row locally', () => {
    // The roster is the server's list and this writes to it, so the honest
    // thing for the row to show is what came back.
    expect(APP).toMatch(/await api\.setEventHost\(event\.id, actorId, host\);\s*\n\s*await refresh\(\)/);
  });
});

describe('the ask, once it is sent', () => {
  it('arrives in the one queue that answers everything', () => {
    /*
     * There is no push for a host request, deliberately — it is somebody
     * already inside asking for a little more. So Lately and the envelope
     * badge are the whole of how it reaches anybody, and a client that did not
     * know the kind would drop it on the floor rather than merely draw it
     * plainly. That is not hypothetical: `group_invite` reached this app with
     * no entry in `ANSWERS` and drew a card with no words on its buttons.
     */
    expect(API).toMatch(/\| 'host';/);
    expect(API).toMatch(/case 'host':/);
    expect(read('src/answers.ts')).toMatch(/host: \{ yes: 'Let them add', no: 'Not now' \}/);
  });
});
