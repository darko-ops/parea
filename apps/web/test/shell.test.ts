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
  const EVENTS = read2('../app/events/page.tsx');
  const ACCOUNT = read2('../app/components/AccountView.tsx');

  it('is the same card on both screens', () => {
    // The You page drew its own list of names with a dot-separated tail while
    // Events drew the card. Two ways of showing one object is two things to
    // keep in step, and the list had already fallen behind — it never grew the
    // relative "added to" line the card has.
    for (const [name, source] of [['events', EVENTS], ['account', ACCOUNT]] as const) {
      expect(source, `${name} does not use EventCard`).toMatch(/<EventCard\b/);
      expect(source, `${name} does not use the cards grid`).toMatch(/className="cards"/);
    }
  });

  it('builds the meta line from the shared function, not by hand', () => {
    // `metaFor` is shared with the native client precisely so "2 days ago"
    // rounds the same way everywhere. A locally assembled string would drift
    // without anything failing.
    expect(ACCOUNT).toMatch(/metaFor\(/);
    expect(ACCOUNT).not.toMatch(/person' : 'people'/);
  });
});
