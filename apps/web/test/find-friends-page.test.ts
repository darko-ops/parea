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

import { stripComments } from './support/source';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const FIND = read('../app/components/FindView.tsx');
const VIEW = read('../app/components/FindFriendsView.tsx');
const PAGE = read('../app/find/friends/page.tsx');
const SWITCH = read('../app/components/Discoverability.tsx');
const EDIT = read('../app/components/EditProfile.tsx');
const PRIVACY = read('../app/privacy/page.tsx');
/* The app's copy of the same card. One campaign covers both clients. */
const APP_SCREEN = read('../../mobile/src/FindFriends.tsx');
/**
 * The public page a carrier reviewer is given instead of the screen.
 *
 * `/find/friends` is behind a sign-in and has to be — a number belongs to an
 * account, not a browser — so a reviewer handed that URL meets a login wall,
 * which reads as evidence that does not exist. `/texts` is the reachable copy.
 */
const TEXTS = read('../app/texts/page.tsx');

/**
 * Source reduced to the words a reader would actually see.
 *
 * Three transformations and each earned its place on a failing assertion.
 * Comments go, because the header on `FindFriendsView` quotes the *rejected*
 * wording in order to explain why it changed — so a scan for the old phrase
 * found the warning against it and called that the mistake. Adjacent string
 * literals are joined, because `/texts` builds its consent line with `+` across
 * three lines and "from Parea" is split across two of them. Whitespace collapses
 * last, because JSX wraps prose wherever the line runs out.
 */
const flat = (source: string) =>
  stripComments(source)
    .replace(/'\s*\+\s*'/g, '')
    .replace(/\s+/g, ' ');

describe('the control in the corner of Find', () => {
  it('is there, and it is a link to the page', () => {
    /*
     * A link rather than a button: it is a page, it should open in a new tab if
     * somebody asks for that, and it should work with no JavaScript at all.
     */
    expect(FIND).toMatch(/<a href="\/find\/friends" className="round" aria-label="Find friends">/);
    expect(FIND).toMatch(/<RailIcon glyph="add-person" \/>/);
  });

  it('has a side opposite it, so the mark between them stays centred', () => {
    // Equal sides either way of the middle — the app's `PageHead` trick. The
    // middle is the mark now, on a laptop; the greeting is in the leading
    // side, and a single control on the right with no counterweight would
    // push the mark half a disc across.
    expect(FIND).toMatch(/<span className="find-top-side find-top-leading">/);
    expect(FIND).toMatch(/<PageMark \/>/);
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
    expect(VIEW).toMatch(/const asking = state !== null && !verified && sentTo === null;/);
    expect(VIEW).toMatch(/\{asking && \(/);
    expect(VIEW).toMatch(/\{!verified && !asking && \(/);
    expect(VIEW).toMatch(/\{verified && \(/);
  });

  it('asks with the whole page, the country code as its own control', () => {
    expect(VIEW).toContain('Let people who have your number find you');
    expect(VIEW).toMatch(/<RailIcon glyph="add-person" \/>/);
    expect(VIEW).toMatch(/JSON\.stringify\(\{ phone: fullNumber\(country\.code, phone\) \}\)/);
    expect(VIEW).toContain('<a href="/find?scope=people">Search on Find</a>');
    // Only the countries the server texts — the app offers the same three.
    expect(VIEW).toMatch(/region: 'US'.*\n.*region: 'CA'.*\n.*region: 'GB'/);
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

  it('asks for consent rather than describing what the button does', () => {
    /*
     * A carrier rejected the earlier wording for exactly this. "Tapping this
     * sends you one text…" states a fact about the button — true, and not
     * consent. What has to be shown is somebody *agreeing to receive text
     * messages*, which is a different sentence and the one this asserts.
     *
     * Pinned in both clients and on the public page, because all three are read
     * by the same reviewer: a screenshot of one, and the text of another.
     */
    for (const [name, source] of [
      ['web', VIEW],
      ['app', APP_SCREEN],
      ['page', TEXTS],
    ] as const) {
      const said = flat(source);
      expect(said, name).toMatch(/I agree to receive one text/);
      expect(said, name).toMatch(/each time I tap \S*Send me a code/);
      // And never the old phrasing, which passed review nowhere.
      expect(said, name).not.toMatch(/Tapping this sends you one text/);
    }
  });

  it('says a text is coming, before the button that sends it', () => {
    /*
     * Five things, and this is the one assertion in the file protecting something
     * outside the product: a US A2P campaign is approved or refused on whether
     * the screen asking for a number tells somebody they are about to be texted,
     * and the screenshot of this paragraph is the evidence submitted for it.
     *
     * Checked in both clients, because the campaign covers both and a carrier
     * reviewing one of them has no way to know the other differs.
     */
    for (const [name, source] of [
      ['web', VIEW],
      ['app', APP_SCREEN],
      ['page', TEXTS],
    ] as const) {
      const said = flat(source);
      // Who texts you, and what arrives.
      expect(said, name).toMatch(/one text message from Parea containing a verification code/);
      // How often.
      expect(said, name).toMatch(/One message per request, not a subscription/);
      // Who pays, in the words every carrier checklist names literally.
      expect(said, name).toMatch(/Message and data rates may apply/);
      // And where the rules are.
      expect(said, name).toMatch(/Terms/);
      expect(said, name).toMatch(/Privacy/);
    }
  });

  it('is a box to tick, unticked, that the button waits for', () => {
    /*
     * The third refusal: the reviewer asked to see "the checkbox area". Being
     * told a text is coming under a button was not enough — an opt-in has to be
     * an act, off until the person does it. So in both clients the consent is a
     * checkbox, it starts unticked, it sits between the number and the button,
     * and the button is disabled until it is ticked.
     */
    for (const [name, source, control, box, gate] of [
      ['web', VIEW, 'className="ff-send"', 'type="checkbox"', /disabled=\{busy \|\| !smsAgreed/],
      ['app', APP_SCREEN, 'label="Send me a code"', 'accessibilityRole="checkbox"', /disabled=\{busy \|\| !smsAgreed/],
    ] as const) {
      const said = flat(source);
      expect(source, name).toMatch(/const \[smsAgreed, setSmsAgreed\] = useState\(false\)/);
      expect(source, name).toMatch(gate);
      const tick = said.indexOf(box);
      const consent = said.indexOf('I agree to receive one text');
      expect(tick, name).toBeGreaterThan(-1);
      expect(consent, name).toBeGreaterThan(tick);
      expect(said.indexOf(control), name).toBeGreaterThan(consent);
    }
  });

  it('shows it while the number is still being asked for', () => {
    // Inside the unverified card, not somewhere further down the page: consent
    // has to be on screen at the moment it is given, and the rest of this page
    // does not exist yet for somebody who has no number on file.
    const card = VIEW.slice(VIEW.indexOf('{asking && ('), VIEW.indexOf('{!verified && !asking && ('));
    expect(flat(card)).toMatch(/I agree to receive one text/);
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

describe('the public page a reviewer can actually open', () => {
  it('exists, and is not hidden from crawlers like the rest of the product', () => {
    /*
     * Almost every route here is noindex, because possession of a link is the
     * access model and a crawled album is somebody's evening in a search index.
     * This page contains nothing about anybody and its whole purpose is being
     * reachable by somebody who has not signed in — so it must be in neither
     * exclusion list, and a well-meaning sweep that added it would quietly break
     * the campaign months later.
     */
    expect(TEXTS).toMatch(/export default function TextsPage/);
    expect(TEXTS).not.toMatch(/robots:/);
    const robots = read('../app/robots.ts');
    expect(robots).not.toMatch(/'\/texts/);
    const config = read('../next.config.ts');
    expect(config).not.toMatch(/'texts'/);
  });

  it('is linked from the public site, not only from a form field', () => {
    /*
     * A URL typed into a registration form is evidence a reviewer cannot confirm
     * belongs to the site, and an unlinked page is one no crawler ever sees. The
     * footer is on `/`, which is the single indexable page here, so this link is
     * what makes the page part of the product.
     */
    expect(read('../app/components/SiteFooter.tsx')).toMatch(
      /<a href="\/texts">Text messages<\/a>/,
    );
    // And from both documents it restates, so somebody reading either can get to
    // the message itself.
    expect(read('../app/terms/page.tsx')).toMatch(/href="\/texts"/);
    expect(read('../app/privacy/page.tsx')).toMatch(/href="\/texts"/);
  });

  it('quotes the consent wording the screens show, not a paraphrase of it', () => {
    /*
     * The reviewer compares this page against a screenshot. Two wordings of one
     * sentence is a product describing itself inaccurately, which is the thing
     * being checked for — so the page holds the string and a test holds them
     * together.
     */
    const words = flat(TEXTS).replace(/[“”]/g, '"');
    expect(words).toMatch(/I agree to receive one text message from Parea containing a verification code each time I tap "Send me a code"/);
    expect(words).toMatch(/Message and data rates may apply/);
  });

  it('quotes the message that actually gets sent', () => {
    // Same argument, for the body rather than the consent: a sample submitted to
    // a carrier is compared against real traffic.
    expect(flat(TEXTS)).toMatch(
      /123456 is your Parea code\. It works once and expires in ten minutes\./,
    );
  });

  it('carries the six things a messaging disclosure has to carry', () => {
    const said = flat(TEXTS);
    expect(said, 'what is sent').toMatch(/one kind of text message/);
    expect(said, 'frequency').toMatch(/One message per request/);
    expect(said, 'cost').toMatch(/message and data rates may apply/i);
    expect(said, 'how to stop').toMatch(/STOP/);
    expect(said, 'help').toMatch(/a person will answer/);
    expect(said, 'the documents').toMatch(/privacy page/);
  });
});
