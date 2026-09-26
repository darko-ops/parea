/**
 * The app calls itself what the product is called.
 *
 * The home tab said "Events", which is the software's word for what is
 * underneath it rather than the name of the thing somebody opened. The web has
 * set `parea` in Garet at the top of every page for as long as it has had a
 * rail, and a client that names itself differently is a second product wearing
 * the same icon.
 *
 * Source checks because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const EVENTS = read('src/Events.tsx');
const MARK = read('src/Wordmark.tsx');
/** The row every tab opens with, which used to be four different rows. */
const HEAD = read('src/PageHead.tsx');

/* The wordmark's prose names `fontWeight` as the thing it refuses, so the
   assertion that it is not used has to look at code rather than at commentary
   about it — the mistake this suite has made three times. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const APP_JSON = JSON.parse(read('app.json')) as {
  expo: { plugins: (string | [string, Record<string, unknown>])[] };
};
const WEB_CSS = read('../web/app/globals.css');

describe('the name', () => {
  it('is the product’s, not the screen’s contents', () => {
    expect(HEAD).toMatch(/<Wordmark color=\{color\}/);
    const home = EVENTS.slice(
      EVENTS.indexOf('export function HomeTab'),
      EVENTS.indexOf('export function ChatsTab'),
    );
    expect(home).not.toMatch(/>Events</);
  });

  it('opens every tab, in the same place on each', () => {
    /*
     * Four tabs used to open four ways: the wordmark between a slot and a `+`
     * on Home, "Your Parea" at 30 points beside two discs on Groups, "Find"
     * above a search field, and two discs with nothing between them on the
     * profile.
     *
     * Two of those were page titles, and a page title on a tab bar's own
     * destination names the thing you just pressed — the bar already says
     * where you are, in a picture nobody has to read. What was worth keeping
     * is the half that is not a title: the name of the product.
     */
    for (const [name, source] of [
      ['Home', EVENTS.slice(EVENTS.indexOf('export function HomeTab'), EVENTS.indexOf('export function ChatsTab'))],
      ['Chats', EVENTS.slice(EVENTS.indexOf('export function ChatsTab'), EVENTS.indexOf('function ConversationLine'))],
      ['Find', EVENTS.slice(EVENTS.indexOf('export function SearchTab'), EVENTS.indexOf('function Result('))],
    ] as const) {
      expect(source, `${name} should open with the wordmark`).toMatch(/<PageHead/);
    }
    /*
     * Three of four, and the profile is the exception on purpose.
     *
     * Its picture hangs from the top edge of the screen now, filling the
     * space the head occupied — and a wordmark over it is a second thing
     * claiming that space. The corners keep their discs, so nothing the head
     * carried has been lost except the word, which the other three still say
     * on the way in.
     */
    const PROFILE = read('src/Profile.tsx');
    expect(PROFILE).not.toMatch(/<PageHead/);
    expect(PROFILE).toMatch(/accessibilityLabel="Settings"/);
    expect(PROFILE).toMatch(/accessibilityLabel="New album or group"/);
    // And neither of the two titles survives.
    expect(EVENTS).not.toMatch(/>Your Parea</);
    expect(EVENTS).not.toMatch(/\}\]}>Find</);
  });

  it('is read aloud as the proper noun, however it is drawn', () => {
    /*
     * The same split the web makes with `text-transform`: the type is
     * lowercase, and the accessible name is "Parea". SVG text has no
     * `textTransform`, so the word is lowercase in the markup and the name is
     * declared beside it — which is the half that matters, and the half that is
     * easy to drop.
     */
    expect(MARK).toMatch(/accessibilityLabel="Parea"/);
    expect(MARK).toMatch(/>\s*parea\s*</);
    expect(WEB_CSS).toMatch(/text-transform: lowercase/);
  });
});

describe('the face it is set in', () => {
  it('is the web’s font, embedded rather than loaded', () => {
    /*
     * At build time by the config plugin, so the family is there on the first
     * frame. `useFonts` would mean a gate in front of the whole app while one
     * word's typeface arrives.
     */
    const font = APP_JSON.expo.plugins.find(
      (p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === 'expo-font',
    );
    expect(font).toBeDefined();
    expect(font![1].fonts).toEqual(['./assets/fonts/Garet-Book.ttf']);
  });

  it('is named so that one string works on both platforms', () => {
    /*
     * iOS resolves an embedded font by its PostScript name and Android by the
     * file name, so the file is called after the PostScript name — `Garet-Book`
     * — and one `fontFamily` satisfies both.
     */
    expect(MARK).toMatch(/fontFamily="Garet-Book"/);
  });

  it('gains its weight from a stroke, never from a synthetic bold', () => {
    /*
     * Garet ships as one face and its `usWeightClass` is 300, so there is no
     * heavier cut to ask for. Synthetic bold smears the outlines horizontally
     * and fills the counters of a geometric face — on a lowercase `a` and `e`
     * that is the first thing you see, and "parea" has both, twice. A stroke
     * grows the whole outline evenly, which is much closer to what a heavier
     * cut is. The web reached the same conclusion and says so in `globals.css`.
     */
    expect(MARK).toMatch(/strokeWidth=\{STROKE \* size\}/);
    expect(code(MARK)).not.toMatch(/fontWeight/);
    expect(WEB_CSS).toMatch(/-webkit-text-stroke: 0\.045em currentColor/);
  });

  it('keeps the same stroke the web settled on', () => {
    /*
     * 0.045em, judged there against this word at this size: below it there is
     * no difference in weight, above it the counters begin to close. A fraction
     * of the size rather than a number of points, for the same reason it is in
     * `em` there — a stroke that looks right at 32 is a blob at 13.
     */
    expect(MARK).toMatch(/const STROKE = 0\.045;/);
  });
});

describe('where it sits', () => {
  it('is centred on the screen, not on what the buttons leave', () => {
    /*
     * With the name simply pushed to the left of a 36pt `+`, the middle of the
     * word sat 18 points left of the middle of the screen — close enough to
     * read as centred and not be, which is the version that looks like a
     * mistake rather than a decision.
     *
     * Home fixed that by holding a slot exactly the width of its button. That
     * works for one control and stops at two: Groups has an envelope *and* a
     * `+`, and a single-disc slot opposite them would be the same half-disc
     * error in the other direction. Equal flex on both sides centres it
     * whatever each side holds, with no caller measuring anything.
     */
    expect(HEAD).toMatch(/side: \{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 \}/);
    expect(HEAD).toMatch(/<View style=\{styles\.side\}>\{left\}<\/View>/);
    expect(HEAD).toMatch(/<View style=\{\[styles\.side, styles\.trailing\]\}>\{right\}<\/View>/);
    /*
     * And the word is given a width. `Wordmark` is an SVG and cannot size
     * itself to its content, so the default `100%` would fill a flex parent
     * and re-centre inside that instead of sitting between two equal sides.
     */
    expect(HEAD).toMatch(/const WORD = \d+;/);
    expect(HEAD).toMatch(/width=\{WORD\}/);
    // The word centres itself inside that space: SVG has no intrinsic width,
    // so `textAlign` has nothing to act on and `textAnchor` does the job.
    expect(MARK).toMatch(/textAnchor="middle"/);
    expect(MARK).toMatch(/x="50%"/);
  });

  it('does not hang the buttons off the name’s baseline', () => {
    /*
     * Baseline alignment is right for a title beside a button and wrong here:
     * the name is set in a face with its own metrics, so a disc aligned to its
     * baseline sits visibly low.
     */
    expect(HEAD).toMatch(/alignItems: 'center', minHeight: ROUND/);
  });

  it('starts every tab’s content at the same height', () => {
    /*
     * The row is as tall as a disc whether or not it holds one, so a tab that
     * loses a control does not begin its content higher up the screen than one
     * that keeps both.
     */
    expect(HEAD).toMatch(/minHeight: ROUND/);
    expect(HEAD).toMatch(/import \{ ROUND, RoundButton \} from '\.\/RoundButton'/);
  });
});

describe('what left the home screen with it', () => {
  it('no longer answers invitations in two places', () => {
    /*
     * The bubble held the same four asks Lately holds, with the same two
     * buttons. Answered in one and still sitting in the other reads as the
     * answer not having taken — which is the failure `activity.ts` names, and
     * the reason an answered friend request leaves the queue there.
     *
     * What replaces it is the badge on the envelope: a smaller claim, in a
     * place that is always there.
     */
    expect(EVENTS).not.toMatch(/<RequestBubble/);
    expect(EVENTS).not.toMatch(/import \{ RequestBubble \}/);
  });
});

/**
 * The product's word for the thing is "album".
 *
 * It was "event", on a rule worth keeping: the interface should say whatever
 * the schema says, because a second word costs a paragraph of explanation in
 * every file that touches it. The rule holds and the word was wrong — "event"
 * is what the row is called and what somebody building this thinks about;
 * "album" is what it is to everybody else.
 *
 * So the split is deliberate and it is the only one: the schema, the routes and
 * the types say `event`, and every word a person reads says album. Renaming the
 * tables and the URLs to match would be a migration, a set of dead links in
 * everybody's messages, and no improvement to anything anybody sees.
 */
/*
 * Every screen, rather than the nine somebody listed once.
 *
 * Four of the strings this suite missed were in files that were not on the
 * old list at all — `AutoSelect`, `DetectedEvents`, `NewGroup`, `PageHead` —
 * which is the failure mode of a hand-kept list of things to check: it is
 * right on the day it is written and silently narrows every time the app
 * grows a screen.
 *
 * Shared by both copy rules below, for the same reason.
 */
const SCREENS = [
    'App.tsx',
    ...[
      'AutoSelect.tsx', 'CoverFramer.tsx', 'CreateEvent.tsx', 'CreateGroup.tsx',
      'DetectedEvents.tsx', 'Door.tsx', 'Events.tsx', 'GroupThread.tsx', 'Groups.tsx',
      'InvitePeople.tsx', 'Lately.tsx', 'NewGroup.tsx', 'PageHead.tsx', 'Person.tsx',
      'PhotoViewer.tsx', 'PickPhotos.tsx', 'Profile.tsx', 'StartSomething.tsx',
      'Thread.tsx',
  ].map((name) => `src/${name}`),
];

/**
 * Every phrase a person reads in one of those files, in the two shapes copy
 * comes in here: a quoted string, and the text between two tags.
 *
 * One line at a time for the strings, because a pattern allowed to cross
 * newlines runs from one code quote to the next and swallows the file between
 * them. Newlines *are* allowed between tags, because JSX wraps its prose —
 * which is why an earlier version of this missed nine sentences.
 */
function copy(source: string, word: RegExp): string[] {
  const body = word.source;
  const strings = [...source.matchAll(new RegExp(`'([^'\n]*${body}[^'\n]*)'`, 'g'))]
    .map((m) => m[1]!)
    .filter((text) => / /.test(text))
    .filter((text) => !/^[a-z]+$/.test(text));
  const nodes = [...source.matchAll(new RegExp(`>([^<>{}]*${body}[^<>{}]*)<`, 'g'))]
    .map((m) => m[1]!.split(/\s+/).filter(Boolean).join(' '))
    .filter(Boolean)
    /*
     * And not the code between two tags.
     *
     * `{a ? (<A/>) : pane === 'talk' ? (<B/>)}` puts `) : pane === 'talk' ? (`
     * between a `>` and a `<`, which is the shape this reads as prose. The
     * tells are reliable: this app's copy is set with curly quotation marks,
     * so a straight apostrophe is a string literal, and no sentence anybody
     * reads contains `===` or `=>`.
     */
    .filter((text) => !/['`]|===|=>/.test(text));
  return [...strings, ...nodes];
}

describe('what the product calls an album', () => {
  it('says album in every word a person reads', () => {
    /*
     * Text a person reads comes in two shapes and this used to check one.
     *
     * Quoted strings were covered. JSX text nodes — the words between two tags
     * — were not, and that is where most of the copy in this app actually
     * lives. So the home screen's empty state read "Nothing here yet. Events
     * you are sent open when you tap the link" for as long as anybody cared to
     * look at it, with eight more like it elsewhere in the app.
     *
     * Identifiers stay exempt in both: `eventId`, `EventListing` and
     * `/api/events` are the schema's word doing the schema's job, and renaming
     * those is a different and much larger thing than renaming a label.
     */
    for (const name of SCREENS) {
      const source = code(read(name));

      // One line at a time: a pattern allowed to cross newlines runs from one
      // code quote to the next and swallows the file between them.
      const strings = [...source.matchAll(/'([^'\n]*\b[Ee]vents?\b[^'\n]*)'/g)]
        .map((m) => m[1]!)
        .filter((text) => / /.test(text))
        // `screen: 'event'` and friends are route names, not sentences.
        .filter((text) => !/^[a-z]+$/.test(text));

      /*
       * And the words between two tags. No brace and no angle inside, which is
       * what keeps this to text and off `pointerEvents="none"` and every prop
       * and identifier in the file. Newlines *are* allowed, because JSX wraps
       * its prose — which is the other half of why the nine were missed.
       *
       * No semicolon and no `=` either, and those two are here for a false
       * positive rather than a true one. `a.length > b` and `n <= 1` are a
       * `>` and a `<` like any other, so a run of ordinary statements between
       * two comparisons reads to this as a very long line of prose — and it
       * says "event" constantly, because the identifiers are exempt precisely
       * so they can. A statement carries a `;` or an `=` and a sentence on a
       * card carries neither, which is the cheapest thing that tells them
       * apart without teaching this test to parse.
       */
      const nodes = [...source.matchAll(/>([^<>{};=]*\b[Ee]vents?\b[^<>{};=]*)</g)]
        .map((m) => m[1]!.split(/\s+/).filter(Boolean).join(' '))
        .filter(Boolean);

      expect([...strings, ...nodes], `${name} still says "event" to somebody`).toEqual([]);
    }
  });

  it('says it on the tab bar, and wherever a screen names the things', () => {
    expect(read('App.tsx')).toMatch(/\['home', 'photos', 'Albums'\]/);
    /*
     * `Person.tsx` lost its `Albums` heading with its bordered cards: the
     * shelf is a wall of covers now, the way the viewer's own profile draws
     * one, and a heading over the only thing on the screen labels nothing.
     * The word still has to be the one people read.
     */
    const PERSON = read('src/Person.tsx');
    expect(PERSON).toMatch(/'album' : 'albums'/);
    expect(PERSON).toMatch(/No albums to show yet/);
    expect(PERSON).not.toMatch(/>\s*Events?\s*</);
    /*
     * `Groups.tsx` lost its `Albums` heading when the room's archive stopped
     * being a card with a title on it — the months head the runs now, and a
     * section heading over them would be a label for a thing already labelled.
     * The word still has to be the one people read.
     */
    const GROUPS = read('src/Groups.tsx');
    expect(GROUPS).toMatch(/New album in this group/);
    /*
     * Said through `plural` now rather than a ternary per call site. The group
     * screen counts albums, photographs and people in five places, and five
     * copies of `n === 1 ? 'album' : 'albums'` is five chances for one of them
     * to read "1 albums".
     */
    expect(GROUPS).toMatch(/const plural = \(n: number, one: string, many = `\$\{one\}s`\)/);
    expect(GROUPS).toMatch(/plural\([^)]*, 'album'\)/);
    /*
     * And never the schema's word where somebody reads it.
     *
     * Checked against the shapes a label actually takes rather than by hunting
     * the word between any `>` and `<`: in TSX those two characters bound
     * arrow functions and JSX tags as readily as text, so a loose pattern
     * matches `onOpenEvent` and `group.events` and fails on the prop names the
     * routes are deliberately still called.
     */
    expect(GROUPS).not.toMatch(/>\s*Events?\s*</);
    expect(GROUPS).not.toMatch(/label="[^"]*\bevent\b/i);
  });

  it('leaves the schema’s word where the schema uses it', () => {
    // The guard cuts both ways: a well-meaning sweep that renamed these would
    // be a migration and a set of dead links, for no visible gain.
    expect(read('App.tsx')).toMatch(/screen: 'event'/);
    expect(read('src/api.ts')).toMatch(/\/api\/events/);
  });
});

/**
 * Two threads, two words — and the second word changed.
 *
 * A photo comment is not a third conversation. It is a line in the album's
 * thread carrying a `photo_id` — the same table, the same unread count,
 * filtered to one picture. Two threads, which were being called three things:
 * the album's was `Talk` on its own tab, `ALBUM CHATS` on the Chats tab, and
 * `comments` under a photograph.
 *
 * The first attempt at this made them all say *talk*, on the grounds that the
 * album's own tab had said it longest. That was the wrong one to keep. The
 * album's thread is a board of remarks about photographs — most of its lines
 * are written under a picture and carry it — and the word for a remark about
 * a picture is a comment. `Talk` was the name that had to move.
 *
 *   **chat** is the one you have with people — a group's.
 *   **comments** are what an album collects about its photographs, whether a
 *   line was written on the board or under one picture.
 *
 * So `talk` is now the word to keep away from readers, and `comment` is the
 * word that had to come back. Identifiers stay exempt in both directions:
 * `talk.get(id)` counting comments per photograph and the `'talk'` pane id are
 * variables doing a variable's job.
 */
describe('what the product calls a conversation', () => {
  it('says nothing to anybody about talk', () => {
    for (const name of SCREENS) {
      expect(
        copy(code(read(name)), /\b[Tt]alk(?:s|ing)?\b/),
        `${name} still says "talk" to somebody`,
      ).toEqual([]);
    }
  });

  it('keeps chat for a group and comments for an album', () => {
    const EVENTS_SOURCE = read('src/Events.tsx');
    // The Chats tab holds chats. Comments are on the album they belong to,
    // and the album's own pane is what calls them comments.
    expect(EVENTS_SOURCE).toMatch(/placeholder="Search chats"/);
    expect(read('App.tsx')).toMatch(/\['talk', 'bubble', 'Comments'\]/);
    // The album's own tab, which is where the word `Talk` had lived longest.
    expect(read('App.tsx')).toMatch(/\['talk', 'bubble', 'Comments'\]/);
    // And a group's own tab says Chat, where the album's says Comments. The
    // button that used to carry the word is that tab now.
    expect(read('src/Groups.tsx')).toContain("['chat', 'bubbles', 'Chat']");
  });

  it('gives the album one bubble and the Chats tab two', () => {
    /*
     * Two ideas, two pictures, and the difference between them is the count.
     * One bubble is a remark about a thing — an album's comments, which mostly
     * hang off individual photographs. Two overlapping is people going back
     * and forth, which is a chat.
     */
    const APP_SOURCE = read('App.tsx');
    expect(APP_SOURCE).toMatch(/\['chats', 'bubbles', 'Chats'\]/);
    expect(APP_SOURCE).toMatch(/\['talk', 'bubble', 'Comments'\]/);
    const GLYPH_SOURCE = read('src/Glyph.tsx');
    expect(GLYPH_SOURCE).toMatch(/case 'bubble':/);
    expect(GLYPH_SOURCE).toMatch(/case 'bubbles':/);
  });
});
