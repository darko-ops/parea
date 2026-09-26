/**
 * Find Friends in the browser, and the promises the page makes in words.
 *
 * `discovery.test.ts` is where the behaviour is tested — who is recommended, who
 * is excluded, what a proved number changes. What is left is the part a query
 * cannot check: that the control exists and points somewhere, that the switch is
 * worded the same on the settings screen as in the legal document that describes
 * it, and that the phone field which used to write the column unchecked is gone
 * rather than quietly still there.
 *
 * Source checks, because there is no renderer in this suite. They stand in for
 * opening the page.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const FIND = read('../app/components/FindView.tsx');
const VIEW = read('../app/components/FindFriendsView.tsx');
const PAGE = read('../app/find/friends/page.tsx');
const SWITCH = read('../app/components/Discoverability.tsx');
const EDIT = read('../app/components/EditProfile.tsx');
const PRIVACY = read('../app/privacy/page.tsx');

describe('the control in the corner of Find', () => {
  it('is there, and it is a link to the page', () => {
    /*
     * A link rather than a button: it is a page, it should open in a new tab if
     * somebody asks for that, and it should work with no JavaScript at all.
     */
    expect(FIND).toMatch(/<a href="\/find\/friends" className="round" aria-label="Find friends">/);
    expect(FIND).toMatch(/<RailIcon glyph="add-person" \/>/);
  });

  it('has something opposite it, so the greeting stays centred', () => {
    // A single control on the right with nothing on the left pushes the word
    // half a disc across — close enough to read as centred and not be, which is
    // the version that looks like a mistake. The app's `PageHead` trick.
    expect(FIND).toMatch(/<span className="find-top-side" \/>/);
    expect(FIND).toMatch(/className="find-top-side find-top-trailing"/);
  });
});

describe('the page', () => {
  it('keeps itself out of the index', () => {
    // It names people somebody may know, which is the one thing on this product
    // worth scraping. `/find/:path*` carries the header as well — see
    // `noindex.test.ts` — and this is the page's own half of it.
    expect(PAGE).toMatch(/robots: \{ index: false, follow: false \}/);
  });

  it('asks for a number before it shows anybody', () => {
    /*
     * The gate is the server's — `/api/people/recommendations` sends no people
     * without a proved number — and the page agrees rather than relying on it.
     * Two halves, one asking for something and the other already doing the
     * thing, is a page arguing with itself.
     */
    expect(VIEW).toMatch(/const verified = state\?\.phone\.verified === true;/);
    expect(VIEW).toMatch(/\{!verified && \(/);
    expect(VIEW).toMatch(/\{verified && \(/);
  });

  it('says it does not read your contacts', () => {
    // Somebody arriving here has met this screen in three other products and is
    // expecting the permission dialog. Not asking is worth saying out loud.
    expect(VIEW).toMatch(/we do not read your contacts/i);
  });

  it('tells "nobody yet" apart from "could not load"', () => {
    // Two different sentences, and only one of them is worth a retry under.
    expect(VIEW).toMatch(/Nobody new to suggest right now/);
    expect(VIEW).toMatch(/Could not load this/);
  });

  it('says what adding a number switched on, and links to the switch', () => {
    // Adding a number made somebody findable. The honest place to say so is the
    // page that did it — and a statement about a switch with no route to the
    // switch is worse than silence.
    expect(VIEW).toMatch(/People who have it can find you/);
    expect(VIEW).toMatch(/<a href="\/account">your account<\/a>/);
  });

  it('never asks the server for the number back', () => {
    // There is nothing to ask for: the column is a keyed hash and two digits.
    // A field prefilled with a number would mean one had been sent.
    expect(VIEW).not.toMatch(/value=\{state[^}]*phone[^}]*\}/);
  });
});

describe('the switch', () => {
  it('is worded identically on the settings screen and the privacy page', () => {
    /*
     * The one drift that matters here. The privacy page is a dated public
     * document describing what a setting does; a settings screen that words it
     * differently is two promises, and the reader has no way to know which one
     * the code implements.
     */
    const sentence = 'let people who have my phone number or email find me on parea';
    const said = (source: string) =>
      source.toLowerCase().replace(/\s+/g, ' ').replace(/&mdash;/g, '');
    expect(said(SWITCH)).toContain(sentence);
    expect(said(PRIVACY)).toContain(sentence);
  });

  it('does not promise to hide anything else', () => {
    // Not general invisibility: the handle search still finds you, and so do the
    // friends of your friends, who can see you on a mutual friend's list
    // already. Both places say so.
    expect(SWITCH).toMatch(/People can still find you by your handle/);
    expect(PRIVACY).toMatch(/Your handle still can/);
  });

  it('goes through the account route rather than one of its own', () => {
    // One column on the row the profile fields live on. A route per switch is a
    // route per switch to get the session check wrong in.
    expect(SWITCH).toMatch(/JSON\.stringify\(\{ discoverable: next \}\)/);
  });
});

describe('the field that used to write the column unchecked', () => {
  it('is gone from the profile sheet', () => {
    /*
     * It PATCHed `/api/account/phone` and the column was set. A hash says two
     * people typed the same digits and nothing about whose digits they are, so
     * that form was one anybody could fill with somebody else's number — and
     * the person harmed is the one who owns it, who is not on this screen.
     *
     * The verb is gone as well as the field: a PATCH left on the route would be
     * the old behaviour still reachable by anything that remembered it.
     */
    expect(EDIT).not.toMatch(/method: 'PATCH'[\s\S]{0,200}account\/phone/);
    expect(EDIT).not.toMatch(/id="edit-phone"/);
    expect(read('../app/api/account/phone/route.ts')).not.toMatch(/export async function PATCH/);
  });

  it('still says which number is on file, and can take it away', () => {
    // What the sheet can honestly do. Removing is not a claim about anybody and
    // needs no code.
    expect(EDIT).toMatch(/••• ••• ••\{last2\}/);
    expect(EDIT).toMatch(/method: 'DELETE'/);
  });

  it('points at the one place a number can be added', () => {
    expect(EDIT).toMatch(/<a href="\/find\/friends">Find friends<\/a>/);
  });
});
