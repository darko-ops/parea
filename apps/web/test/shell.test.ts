/**
 * Navigation is a property of the product, not of where you happened to land.
 *
 * The rail was on three pages out of ten. Open an event, a group, the privacy
 * page or your own account and the way back to anything disappeared — and the
 * pages it was missing from are exactly the ones you arrive at from somebody
 * else's link, where the back button has nothing behind it.
 *
 * The fix is a component, and the failure mode of a component is a new page
 * that does not use it. That is not a thing typechecking can see and not a
 * thing anyone notices while building the page they are building, because
 * they navigated to it from a page that had a rail. So the list of pages is
 * read off the filesystem rather than kept by hand, and a new route joins this
 * test by existing.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = fileURLToPath(new URL('../app', import.meta.url));
const read = (path: string) => readFileSync(path, 'utf8');

/** Every `page.tsx` under `app/`, which is every route Next will serve. */
function routes(dir = APP): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routes(path);
    return entry === 'page.tsx' ? [path] : [];
  });
}

/**
 * Pages that render the rail somewhere other than in the page file.
 *
 * `/account` is the whole reason this is a list rather than a rule: it is one
 * route serving two things, and which one depends on a session only the client
 * has resolved. Signed in it is the You page and gets the rail; signed out it
 * is the sign-in screen, which is a white page with one card in the middle and
 * no way out that is not signing in, and three navigation links beside it all
 * lead back to itself.
 */
const DELEGATED: Record<string, string> = {
  'account/page.tsx': '../app/components/AccountView.tsx',
  // The old home path, which re-exports the new one rather than redirecting —
  // see `app/albums/page.tsx` for the 308 that makes a redirect unsafe. It is
  // the same page by definition, so it is the same rail.
  'albums/page.tsx': '../app/events/page.tsx',
};

describe('the rail reaches every page', () => {
  const found = routes();

  it('found the routes at all', () => {
    // A resolution bug here would empty the loop below and pass silently,
    // which is the one way this file could report on nothing and look green.
    expect(found.length).toBeGreaterThanOrEqual(10);
  });

  it('is on all of them', () => {
    for (const path of found) {
      const route = path.slice(APP.length + 1);
      const delegate = DELEGATED[route];
      const source = delegate ? read(fileURLToPath(new URL(delegate, import.meta.url))) : read(path);
      expect(source, `${route} has no rail`).toContain('<Shell');
    }
  });

  it('is reached through Shell and not imported around it', () => {
    // `Shell` is `<div className="shell">` plus the rail, and the div is the
    // half that would go missing: a rail with no flex parent renders as a
    // full-width band above the content, which looks deliberate.
    for (const path of routes()) {
      expect(read(path), `${path} imports Rail directly`).not.toMatch(
        /from ['"].*\/Rail['"]/,
      );
    }
  });
});

describe('the sign-in screen keeps its white page', () => {
  const account = read(fileURLToPath(new URL('../app/components/AccountView.tsx', import.meta.url)));

  it('returns before the rail exists', () => {
    // Order is the mechanism, so order is what is asserted. `LoginScreen` is
    // returned from a branch above the point `page()` is defined; moving the
    // definition up would compile, pass a "does it render a Shell" check, and
    // put a navigation rail beside the sign-in card.
    const login = account.indexOf('<LoginScreen>');
    const shell = account.indexOf('<Shell');
    expect(login).toBeGreaterThan(-1);
    expect(shell).toBeGreaterThan(-1);
    expect(login, 'the sign-in branch must come first').toBeLessThan(shell);
  });

  it('does not render one while the session is still resolving', () => {
    // A rail that appears and then vanishes as the fetch lands is worse than
    // one that arrives late, and half the people hitting this route are
    // signed out.
    expect(account).toMatch(/stage === 'loading'\) return <main className="wrap" \/>/);
  });
});

describe('an event looks like an event wherever it is listed', () => {
  const read2 = (p: string) => read(fileURLToPath(new URL(p, import.meta.url)));
  const ACCOUNT = read2('../app/components/AccountView.tsx');

  it('is the card, wherever a grid of events is drawn', () => {
    // The You page drew its own list of names with a dot-separated tail while
    // Events drew the card. Two ways of showing one object is two things to
    // keep in step, and the list had already fallen behind — it never grew the
    // relative "added to" line the card has.
    //
    // Home is back in this list. It briefly drew its own dense rows, which was
    // a second drawing of the same object and lost to exactly the argument
    // above — a 58px strip of an evening is not enough to recognise it by. The
    // hero above the grid is a different thing and stays its own component.
    //
    // Activity is not in this list: it stopped being a grid of events when it
    // became a list of things that happened, and the one place it still shows
    // an event is a row in a sentence.
    //
    // Two files per screen, because Home hands its grid to `HomeView` —
    // the cards are still `EventCard` and the container is still `.cards`,
    // they are just declared one component apart. Asserting both against the
    // page would only prove the grid had not moved, which is not the property
    // worth holding.
    const screens = [
      { name: 'events', cards: '../app/events/page.tsx', grid: '../app/components/HomeView.tsx' },
      { name: 'account', cards: '../app/components/AccountView.tsx', grid: '../app/components/AccountView.tsx' },
    ];
    for (const screen of screens) {
      expect(read2(screen.cards), `${screen.name} does not use EventCard`).toMatch(
        /<EventCard\b/,
      );
      expect(read2(screen.grid), `${screen.name} does not use the cards grid`).toMatch(
        /className="cards"/,
      );
    }
  });

  it('has nobody drawing a mosaic by hand, now that nobody draws one', () => {
    /*
     * The tile arrangement existed twice — once in the web card, once in the
     * native events tab — each with a comment saying the other one had to
     * agree. Two copies and a comment is not a mechanism, so it became
     * `mosaicLayout` in `@parea/cards` and this test pointed at whoever drew.
     *
     * Neither client draws one now. The web card led with a single cover
     * first; the phone's card followed it, for the same reason — four
     * thumbnails too small to recognise anybody in, under a panel of chrome,
     * made a wall of evenings look like a wall of listings.
     *
     * So the rule inverts rather than being deleted. `mosaicLayout` stays
     * exported as the one implementation to import, and what is checked is
     * that neither client has quietly grown a second one: a local arrangement
     * would compile, render, and disagree with nothing visible until the day
     * the other client draws tiles again.
     */
    const clients = [
      '../app/components/EventCard.tsx',
      '../../../apps/mobile/src/Events.tsx',
    ];
    for (const path of clients) {
      const source = read2(path);
      expect(source, `${path} declares its own layout`).not.toMatch(
        /function layout\([^)]*\)\s*:\s*\{\s*groups/,
      );
      expect(source, `${path} declares its own layout`).not.toMatch(
        /switch \(photos\.length\)/,
      );
      // And if either does draw tiles again, it is the shared shape or none:
      // a `mosaic` in a client that never imports the layout is the copy this
      // test exists to catch.
      if (/\bmosaicLayout\b/.test(source)) continue;
      expect(source, `${path} arranges tiles without the shared layout`).not.toMatch(
        /styles\.mosaic\b|className="card-mosaic"/,
      );
    }
  });

  it('rounds the relative time with the shared function, not by hand', () => {
    /*
     * `ago` is shared with the native client precisely so "2 days ago" rounds
     * the same way everywhere. A locally assembled string would drift without
     * anything failing.
     *
     * It used to be `metaFor`, which built a whole sentence — people, then
     * place or recency. The card says those separately now, so what is left to
     * share is the rounding, which is the part that could ever disagree.
     */
    expect(ACCOUNT).toMatch(/\bago\(/);
    expect(ACCOUNT).not.toMatch(/person' : 'people'/);
    // Not a second implementation of the same rounding.
    expect(ACCOUNT).not.toMatch(/days ago`|hours ago`|minutes ago`/);
  });
});

/**
 * Making an event, on a phone.
 *
 * The rows go behind a hamburger below tablet, which is right for
 * destinations and was wrong for the create button that went with them: it
 * left the one action the product exists for two taps down, at the bottom of
 * a panel as tall as the screen. It is a pill in the bar now, beside the menu
 * rather than inside it.
 */
/**
 * The head is the name, centred, and nothing else.
 *
 * It was the mark and the word as a lockup at the leading edge. The app's own
 * head has never carried the mark: the top of a screen says whose product this
 * is, and the mark says in a picture what the wordmark is already saying in
 * letters — and the one of the two carrying colour onto a page whose subject
 * is somebody else's photographs is the one to drop.
 */
describe('the head of the shell', () => {
  const RAIL = read(join(APP, 'components/Rail.tsx'));
  const CSS = read(join(APP, 'globals.css'));
  const MOBILE = CSS.slice(CSS.indexOf('@media (max-width: 720px)'));

  it('is the wordmark alone, with no mark beside it', () => {
    const lockup = RAIL.slice(
      RAIL.indexOf('className="rail-mark"'),
      RAIL.indexOf('className="rail-create"'),
    );
    expect(lockup).toMatch(/className="wordmark">Parea</);
    expect(lockup).not.toMatch(/<Mark/);
    // Gone from the file, not merely from the row.
    expect(RAIL).not.toMatch(/import \{ Mark \}/);
    /*
     * And still the mark everywhere it is the only thing saying what this is:
     * the icon on a home screen, the face of the sign-in card, the figure
     * over an empty thread.
     */
    expect(read(join(APP, 'components/LoginScreen.tsx'))).toMatch(/<Mark size=\{72\}/);
    expect(read(join(APP, 'components/Thread.tsx'))).toMatch(/<Mark size=\{48\}/);
  });

  it('centres it, on the rail and in the bar', () => {
    /*
     * `1fr auto 1fr` below tablet rather than `margin-right: auto` on the
     * lockup: the app's head flexes both sides equally so the word sits in
     * the middle of the screen rather than in the middle of what the controls
     * leave. The menu is 40 points and Create is a pill, and a row centred on
     * their average is close enough to centred to read as a mistake.
     */
    expect(CSS).toMatch(/\.rail-mark \{[^}]*justify-content: center/);
    expect(MOBILE).toMatch(/grid-template-columns: 1fr auto 1fr/);
    /* Gone as a rule. It survives in the note that says why, which is where
       a reversed decision belongs. */
    expect(MOBILE).not.toMatch(/^\s*margin-right: auto;/m);
    /*
     * Placed rather than auto-placed, and the first track is deliberately
     * empty — the hamburger used to sit in it. The app's head has the same
     * empty slot: what keeps the word in the middle of the screen is that
     * both sides are a track wide whether or not anything is in them.
     */
    expect(MOBILE).toMatch(/\.rail-mark \{ padding: 0; grid-column: 2; justify-self: center; \}/);
    expect(MOBILE).toMatch(/\.rail-create \{[^}]*grid-column: 3; justify-self: end/);
  });

  it('reads the name, then the one thing it makes', () => {
    // The order a screen reader gets. The menu that used to come first is
    // gone: the rows are a bar along the bottom now.
    expect(RAIL).not.toMatch(/rail-burger/);
    expect(RAIL.indexOf('className="rail-mark"')).toBeLessThan(
      RAIL.indexOf('className="rail-create"'),
    );
  });
});

/**
 * Below tablet the rows are a bar along the bottom.
 *
 * Three shapes in three versions of this: sideways first, which fitted at four
 * rows and stopped at six; then behind a hamburger, which made every
 * destination two taps and hid the one row that ever carries a number. Now
 * where the app puts them.
 */
describe('the bar along the bottom', () => {
  const RAIL = read(join(APP, 'components/Rail.tsx'));
  const CSS = read(join(APP, 'globals.css'));
  const MOBILE = CSS.slice(CSS.indexOf('@media (max-width: 720px)'));

  it('is the same markup the rail is, reshaped', () => {
    /*
     * One list, two shapes: a column on a laptop and a capsule on a phone.
     * The labels are hidden rather than deleted, so what a screen reader
     * announces is the same word in both — a glyph-only bar that dropped them
     * would be six unlabelled links.
     */
    expect(MOBILE).toMatch(/\.rail-nav \{[\s\S]{0,200}flex-direction: row/);
    expect(MOBILE).toMatch(/\.rail-label \{[^}]*clip-path: inset\(50%\)/);
    expect(RAIL).toMatch(/<span className="rail-label">\{row\.label\}<\/span>/);
    /*
     * And Settings joins the row rather than hanging under it. The foot is a
     * box on a laptop and nothing at all here — which is what keeps the only
     * route to signing out reachable on a phone.
     */
    expect(MOBILE).toMatch(/\.rail-foot \{ display: contents; \}/);
    expect(RAIL).toMatch(/className="rail-row rail-settings"/);
  });

  it('floats clear of the bottom edge rather than reaching it', () => {
    /*
     * The app's argument: a bar that reaches the edge has to reserve a strip
     * inside itself for the home indicator, and a constant standing in for a
     * safe area is a guess. Floating needs no allowance — and where a browser
     * reports one, it is added rather than assumed.
     */
    expect(MOBILE).toMatch(/\.rail-nav \{[\s\S]{0,240}position: fixed/);
    expect(MOBILE).toMatch(/bottom: calc\(14px \+ env\(safe-area-inset-bottom, 0px\)\)/);
    expect(MOBILE).toMatch(/border-radius: 999px/);
    // Glass, with a fallback that is not transparent: a bar you can read the
    // page through is a bar you cannot read.
    expect(MOBILE).toMatch(/backdrop-filter: saturate\(180%\) blur\(14px\)/);
    expect(MOBILE).toMatch(/@supports not \(backdrop-filter: blur\(1px\)\)/);
    // And the page leaves room for it to float over.
    expect(MOBILE).toMatch(/\.shell \{ padding-bottom: calc\(76px/);
  });

  it('seats the page you are on rather than colouring it', () => {
    /*
     * A capsule inside the capsule, in a wash of the page's own value. Colour
     * here would be the only colour in the chrome, and the photographs
     * underneath are the things entitled to one — the app's note, and its
     * rule.
     */
    expect(MOBILE).toMatch(/\.rail a\.rail-row\[aria-current='page'\] \{/);
    expect(MOBILE).toMatch(/background: color-mix\(in srgb, var\(--fg\) 8%, transparent\)/);
    /* Where the rail's own selected row uses the accent, the bar does not:
       on a laptop that row is in a column of chrome, and on a phone the bar
       sits over the photographs. */
    expect(MOBILE).not.toMatch(/\.rail a\.rail-row\[aria-current='page'\] \{[^}]*var\(--accent\)/);
    expect(CSS).toMatch(/\.rail a\.rail-row\[aria-current='page'\] \{\s*background: var\(--accent-soft\)/);
  });

  it('renders on the server again', () => {
    // The hamburger was the only state in here and `'use client'` was the
    // price of it. The count beside Activity owns its own boundary, which is
    // why it could be paid back.
    /* As a directive. It survives in the note that says why it went, which
       is where a reversed decision belongs. */
    expect(RAIL).not.toMatch(/^'use client';/m);
    expect(RAIL).not.toMatch(/useState|useEffect|useRef/);
    expect(read(join(APP, 'components/InvitesBadge.tsx'))).toMatch(/'use client'/);
  });
});

/**
 * Nothing on the shelf yet.
 *
 * A line and the one stroke that answers it, in the app's words — replacing a
 * `Create Album` panel that was rendered into every grid of albums whether or
 * not there was anything beside it.
 */
describe('an empty shelf', () => {
  const CSS = read(join(APP, 'globals.css'));
  const HOME = read(join(APP, 'components/HomeView.tsx'));
  const ACCOUNT = read(join(APP, 'components/AccountView.tsx'));

  it('says the same seven words the app says', () => {
    const APP_EVENTS = read(
      fileURLToPath(new URL('../../mobile/src/Events.tsx', import.meta.url)),
    );
    for (const source of [HOME, ACCOUNT, APP_EVENTS]) {
      expect(source).toMatch(/No Albums Yet\. Create One Now\./);
    }
  });

  it('draws only when the shelf is empty, and not under a filter', () => {
    /*
     * The card was "the affordance, not a result" and so was always there;
     * with nothing else in the grid it was the whole page. Making one is a
     * control in the head on both clients, and a second button for it at the
     * foot of a scrolling grid is furniture rather than affordance.
     *
     * Not under a search or a person filter either: "create an album" is not
     * an answer to "which of these has Priya in it".
     */
    expect(HOME).toMatch(/\{!searching && !person && shown\.length === 0 && \(/);
    expect(ACCOUNT).toMatch(/\{lens !== 'joined' && shown\.length === 0 && \(/);
    // Gone, not hidden.
    expect(HOME).not.toMatch(/CreateCard/);
    expect(ACCOUNT).not.toMatch(/CreateCard/);
    expect(CSS).not.toMatch(/^\.card-new \{/m);
  });

  it('is a line and a stroke rather than a panel', () => {
    // A bordered box on a page whose every other row is a photograph draws
    // more attention empty than the cards draw full.
    expect(CSS).toMatch(/\.blank-note \{[^}]*color: var\(--dim\)/);
    expect(CSS).toMatch(/\.blank-do \{[^}]*border-radius: 50%/);
    expect(CSS).toMatch(/\.blank-do \{[^}]*border: 1px solid var\(--line\)/);
  });
});

describe('the create button on a narrow screen', () => {
  const RAIL = read(join(APP, 'components/Rail.tsx'));
  const CSS = read(join(APP, 'globals.css'));
  /** The rules that only apply below tablet. */
  const MOBILE = CSS.slice(CSS.indexOf('@media (max-width: 720px)'));

  it('is in the bar, not inside the panel the hamburger opens', () => {
    // Before `.rail-nav`, which is the block that becomes the dropdown — a
    // create button inside it is one the menu hides.
    const create = RAIL.indexOf('className="rail-create"');
    const panel = RAIL.indexOf('className="rail-nav"');
    expect(create).toBeGreaterThan(-1);
    expect(create).toBeLessThan(panel);
  });

  it('says what it makes, for anyone who cannot see the pill', () => {
    // The `+` is decorative and the word carries the meaning, so the label has
    // to name the thing rather than leave a screen reader reading "plus".
    expect(RAIL).toMatch(/aria-label="Create an album"/);
    expect(RAIL).toMatch(/aria-hidden="true">\+</);
  });

  it('exists only below tablet, where the rows are hidden', () => {
    // On a laptop the rows are the page's left edge and the create button is
    // already among them; a second one in the corner would be two.
    expect(CSS).toMatch(/\.rail-create \{ display: none; \}/);
    expect(MOBILE).toMatch(/\.rail-create \{[^}]*display: flex/);
  });

  it('is the only one of itself at that width', () => {
    // The full-width button in the panel goes when the pill arrives. Two links
    // to the same place is two tab stops and two announcements, and the one in
    // the panel is the one nobody reaches.
    expect(MOBILE).toMatch(/\.rail-foot > a:first-child \{ display: none; \}/);
  });
});
