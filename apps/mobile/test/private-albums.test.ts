/**
 * Who can see it, on the phone — the two policies and the door between them.
 *
 * Three access policies became two, `public` and `private`, and the app had
 * three separate holes where the third one used to be assumed:
 *
 *   1. **A link to a private album came back as a lie.** `/api/join` refused
 *      every denial as 404, so the app said "Couldn't find that. Check the
 *      link or the code and try again" to somebody holding exactly the right
 *      link. They check it, find it is right, and try again.
 *   2. **The choice could be made once and never changed.** Two pills on the
 *      create screen, and nothing afterwards — the choice is made in the first
 *      thirty seconds, before anybody has been sent anything.
 *   3. **The app sent a policy the server now refuses.** It posted
 *      `account_required`, which is not one of the two and would come back 400.
 *
 * Source checks, because there is no renderer in this suite. They stand in for
 * the simulator run and they catch the screens being quietly taken apart —
 * which for the door means being taken apart into the 404 it replaced.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const DOOR = read('src/Door.tsx');
const CREATE = read('src/CreateEvent.tsx');
const PERSON = read('src/Person.tsx');
const API = read('src/api.ts');

describe('the two policies, and nothing between them', () => {
  it('sends one of the two the server offers', () => {
    // It sent `account_required`, which is no longer a value the create route
    // accepts — an app store build doing that would refuse every private
    // album with a 400 nobody could read.
    expect(CREATE).toMatch(/accessPolicy: isPrivate \? 'private' : 'public'/);
    expect(CREATE).not.toMatch(/account_required|link_open|request_access/);
    expect(API).not.toMatch(/account_required|link_open|request_access/);
  });

  it('types the field as the two and no more', () => {
    expect(API).toMatch(/accessPolicy\?: 'public' \| 'private'/);
  });
});

describe('the door of a private album', () => {
  it('is a screen, not a message on the join screen', () => {
    /*
     * A deep link can arrive when the join screen is not mounted — the app may
     * be inside another event, or not running at all — so an error string
     * there has nowhere to appear.
     */
    expect(APP).toMatch(/screen: 'door'; eventId: string; name: string/);
    expect(APP).toMatch(/route\.screen === 'door' &&/);
  });

  it('is where a refused link goes, rather than "couldn’t find that"', () => {
    expect(APP).toMatch(/err\.code === 'approval_required'/);
    expect(APP).toMatch(/setRoute\(\{ screen: 'door'/);
    // And the old message is still there for the case it is true of: a token
    // or code that resolves to nothing at all.
    expect(APP).toMatch(/Couldn't find that/);
  });

  it('names the album from the refusal rather than fetching it', () => {
    // The name comes down with the 403 because the link proved they may know
    // it. Asking the server again from this screen would be asking a question
    // it has already answered — and the endpoint that would answer it is the
    // one refusing them.
    expect(APP).toMatch(/err\.body\.event as/);
    expect(DOOR).not.toMatch(/api\.feed|api\.person|api\.myEvents/);
  });

  it('shows a name and nothing that is behind the door', () => {
    // Everything else — photographs, members, counts, the cover — is what is
    // being asked for, and this screen is the moment before the answer.
    expect(DOOR).toMatch(/PRIVATE ALBUM/);
    expect(DOOR).not.toMatch(/photoCount|contributors|coverUrl|thumb/);
  });

  it('says "Asked" over a decline as well as over an open request', () => {
    /*
     * Telling somebody they were refused is the refuser's to do. The endpoint
     * answers a repeat ask with the status it already holds, so a screen that
     * read "Declined" would say it again on every visit.
     *
     * Matched as rendered text rather than anywhere in the file: the header of
     * `Door.tsx` uses the word while explaining why it is not shown, and a
     * test that cannot tell those apart fails on its own documentation. The
     * web side has `stripComments`; one anchored regex is cheaper here than
     * importing it across a workspace.
     */
    expect(DOOR).not.toMatch(/>\s*Declined/i);
    expect(DOOR).toMatch(/Asked\. It is with whoever made the album/);
  });

  it('hands over rather than reporting a pending ask when it comes back approved', () => {
    // Somebody let them in between the link being sent and the button being
    // pressed. There is a room now, so waiting is the wrong thing to say.
    expect(DOOR).toMatch(/status === 'approved'/);
    expect(DOOR).toMatch(/onLetIn\(\)/);
  });
});

describe('who can see it, after the first thirty seconds', () => {
  it('is changeable on the event screen, by whoever can administer', () => {
    expect(APP).toMatch(/Who can see it/);
    expect(APP).toMatch(/api\.setAccessPolicy\(event\.id, value\)/);
  });

  it('answers the press before the server does, and then defers to it', () => {
    // One round trip is long enough for a tap to feel ignored. But a local
    // guess left standing would outrank a change made on another device, so
    // the refresh clears it.
    expect(APP).toMatch(/policy \?\? feed\.event\.accessPolicy/);
    expect(APP).toMatch(/setPolicy\(null\)/);
  });

  it('says that tightening it evicts nobody', () => {
    // "Private" sounds like it should throw people out. It does not —
    // `authorize` reads participation before the policy — and the screen has
    // to say so, because the person reading it is about to press the pill.
    expect(APP).toMatch(/everyone already here stays in/);
  });
});

describe('somebody else’s albums, on their page', () => {
  it('lists the locked ones with the only thing there is to do about them', () => {
    expect(PERSON).toMatch(/Ask to join/);
    expect(PERSON).toMatch(/api\.askToJoin\(album\.id\)/);
  });

  it('draws no picture and no count for a locked one', () => {
    // The server sends neither — see `albumsBy` — and the screen must not
    // invent a placeholder that reads as a photograph either.
    expect(PERSON).toMatch(/album\.locked \? '' :/);
    expect(PERSON).toMatch(/album\.locked\s*\n?\s*\? 'Private'/);
  });
});
