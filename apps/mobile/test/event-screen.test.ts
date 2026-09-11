/**
 * The album view, after the slabs came off it.
 *
 * Opening an event used to show, in order: a back link, the name, a count, an
 * Add photos button, a Save all button, a "who can see it" card, a cover row,
 * an invite card and an offer to start a group — eight full-width things
 * before the first photograph, on the screen whose entire subject is
 * photographs. And the conversation that shipped on the web was not reachable
 * from here at all.
 *
 * Now the cover is the screen's head, everything that was a slab is behind one
 * `⋯`, and the thread is one of three panes. Nothing it *does* changed: the
 * checks below are mostly that the same calls are still made by the same
 * people, from somewhere else.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const GLYPH = read('src/Glyph.tsx');

/**
 * Comments out.
 *
 * Several assertions below are that a phrase is no longer *drawn* on the
 * screen, and every one of those phrases is also named in a comment explaining
 * where it went — which is exactly the note that should survive the move.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The screen, without the rest of the file. */
const SCREEN = code(
  APP.slice(APP.indexOf('function EventScreen'), APP.indexOf('function Segmented')),
);
/** The sheet everything moved into. */
const SHEET = code(
  APP.slice(APP.indexOf('function HostSheet'), APP.indexOf('/** One action in the sheet')),
);

describe('what is above the first photograph', () => {
  it('found both slices at all', () => {
    // Every assertion below is over one of these, and a rename upstream would
    // empty it and pass all of them silently.
    expect(SCREEN).not.toBe('');
    expect(SHEET).not.toBe('');
  });

  it('is the cover, the name and the tabs — nothing else', () => {
    // The grid starts 248 points down, under a 232pt cover and a row of tabs.
    expect(SCREEN).toMatch(/styles\.cover\b/);
    expect(SCREEN).toMatch(/styles\.coverTitle/);
    expect(APP).toMatch(/page: \{ position: 'absolute', top: 248/);
    expect(APP).toMatch(/cover: \{ position: 'absolute', top: 0, left: 0, right: 0, height: 232 \}/);
  });

  it('keeps no slab where a setting used to be', () => {
    /*
     * The point of the redesign: none of these is on the screen any more. They
     * are asserted against the screen's own slice rather than the file, because
     * every one of them still exists — in the sheet, doing the same thing.
     */
    for (const gone of [
      'Save all to my camera roll',
      'Who can see it',
      // The cover's row, not its handler: `editCover` still lives on the
      // screen, because the sheet calls it and the screen owns the refresh.
      'styles.coverRow',
      '<InviteCard',
      'Start a group from this event',
    ]) {
      expect(SCREEN).not.toContain(gone);
      expect(SHEET).toContain(gone);
    }
  });

  it('says who can see it as a padlock, in the line before the link is sent', () => {
    /*
     * It used to be a paragraph three slabs down, which is not where somebody
     * is looking when they are about to hand the link on. Open and closed are
     * the same drawing with the shackle moved.
     */
    expect(SCREEN).toMatch(/name=\{visible === 'private' \? 'locked' : 'unlocked'\}/);
    expect(GLYPH).toMatch(/case 'unlocked'/);
    expect(GLYPH).toMatch(/case 'locked'/);
  });
});

describe('the three panes', () => {
  it('is one screen, not three routes', () => {
    /*
     * Client state rather than a route: an event's link must open on its
     * photographs, never on its roster or halfway down somebody's
     * conversation. And the thread pushed as its own screen would give the
     * conversation a back button to the album it is already inside.
     */
    expect(APP).toMatch(/type Pane = 'photos' \| 'talk' \| 'people'/);
    expect(SCREEN).toMatch(/useState<Pane>\('photos'\)/);
    expect(APP).not.toMatch(/screen: 'thread'/);
  });

  it('carries the count on the tab rather than only in a banner', () => {
    // A banner takes itself away; a count on a tab is the thing that is still
    // true a minute later.
    expect(APP).toMatch(/id === 'talk' && unread > 0/);
  });
});

describe('somebody said something while you were looking at the photographs', () => {
  it('does not call the history you arrived with new', () => {
    // The mark is set to whatever was already there on the first feed, so
    // opening an event cannot announce the whole conversation.
    expect(SCREEN).toMatch(/if \(feed && seen === null\) setSeen\(feed\.messages\.length\)/);
  });

  it('takes itself away', () => {
    // A notification, not the conversation: it drops in and goes, and the
    // count stays on the Talk tab.
    expect(SCREEN).toMatch(/setTimeout\(\(\) => setBannerGone\(true\), 6000\)/);
    expect(SCREEN).toMatch(/unread > 0 && !bannerGone/);
  });

  it('dismissing it does not mark the thread read', () => {
    // Only reaching the bottom of the list does that.
    expect(SCREEN).not.toMatch(/setBannerGone\(true\)[\s\S]{0,80}setSeen\(/);
  });
});

describe('the account', () => {
  it('is asked for when somebody reaches for what needs one, not in front of it', () => {
    /*
     * The card used to sit permanently above the grid for anybody not signed
     * in — a sign-in form in front of the photographs, which are the thing
     * that needs no account at all. It opens on pressing `+` now.
     */
    expect(SCREEN).toMatch(/if \(signedIn === false\) return setGateOpen\(true\)/);
    expect(SCREEN).toMatch(/gate\s*\n\s*why="Adding photos needs an account/);
  });
});
