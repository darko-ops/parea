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

  it('gets its mosaic shape from the shared function, wherever one is drawn', () => {
    /*
     * The tile arrangement existed twice — once in the web card, once in the
     * native events tab — each with a comment saying the other one had to
     * agree. Two copies and a comment is not a mechanism.
     *
     * The web card no longer draws a mosaic at all: Home leads with one cover
     * per event, so there is one image and nothing to arrange. That leaves the
     * phone as the only drawer, and this keeps the rule pointed at whoever is
     * drawing rather than deleting it — the day the web grows a mosaic back,
     * it imports the shared one like everybody else.
     */
    const drawers = ['../../../apps/mobile/src/Events.tsx'];
    for (const path of drawers) {
      const source = read2(path);
      expect(source, `${path} does not use the shared layout`).toMatch(/mosaicLayout\(/);
      // A locally declared one is the failure mode this is here to catch: it
      // would compile, render, and silently disagree with the other clients.
      expect(source, `${path} declares its own layout`).not.toMatch(
        /function layout\([^)]*\)\s*:\s*\{\s*groups/,
      );
      expect(source, `${path} declares its own layout`).not.toMatch(
        /switch \(photos\.length\)/,
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
    expect(RAIL).toMatch(/aria-label="Create an event"/);
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
