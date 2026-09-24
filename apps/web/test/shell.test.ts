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

  it('reads leading control, name, trailing control', () => {
    /*
     * The order the app's head has and the order a screen reader gets: the
     * button that opens everything else, then whose product this is, then the
     * one thing it makes. Leading rather than trailing, which is where the
     * button was — a control that opens the rest belongs ahead of the rest.
     */
    expect(RAIL.indexOf('className="rail-burger"')).toBeLessThan(
      RAIL.indexOf('className="rail-mark"'),
    );
    expect(RAIL.indexOf('className="rail-mark"')).toBeLessThan(
      RAIL.indexOf('rail-create"'),
    );
    expect(MOBILE).toMatch(/\.rail-burger \{[^}]*grid-column: 1; justify-self: start/);
  });
});

/**
 * Below tablet the rows go behind a button in the leading corner.
 *
 * Four shapes in four versions of this: sideways, which stopped at six rows;
 * behind a hamburger in the trailing corner; a capsule floating at the foot,
 * the shape the app's tab bar has; and now the button again, on the other
 * side. Six glyphs in a capsule is a row nobody reads, and the two that would
 * have to go to make four are the two the web has and the app does not.
 */
describe('the menu on a narrow screen', () => {
  const RAIL = read(join(APP, 'components/Rail.tsx'));
  const CSS = read(join(APP, 'globals.css'));
  const MOBILE = CSS.slice(CSS.indexOf('@media (max-width: 720px)'));

  it('is the same markup the rail is, hung under the head', () => {
    /*
     * One list, two shapes: a column on a laptop and that same column in a
     * panel on a phone — not a phone copy of it. Full width, because a panel
     * narrower than the screen invites a tap on the half of the row that is
     * not the panel.
     */
    expect(MOBILE).toMatch(/\.rail-nav \{ display: none; \}/);
    expect(MOBILE).toMatch(/\.rail-open \.rail-nav \{[\s\S]{0,200}flex-direction: column/);
    expect(MOBILE).toMatch(/\.rail-open \.rail-nav \{[\s\S]{0,260}left: 0; right: 0; top: 100%/);
    expect(RAIL).toMatch(/<span className="rail-label">\{row\.label\}<\/span>/);
  });

  it('carries the one number the menu would otherwise hide', () => {
    // A menu that conceals the row with the count is a menu somebody opens to
    // learn there was nothing in it.
    expect(RAIL).toMatch(/\{!open && current !== 'invites' && <InvitesBadge \/>\}/);
    expect(MOBILE).toMatch(/\.rail-burger \.badge \{/);
  });

  it('closes on a tap away and on Escape', () => {
    // The two rules `Menu` applies to its panel, for the same reason: a panel
    // whose only exit is choosing something makes you navigate to be rid of
    // it. `mousedown` rather than `click`, or the panel closes between a link
    // being pressed and the navigation starting.
    expect(RAIL).toMatch(/document\.addEventListener\('mousedown', away\)/);
    expect(RAIL).toMatch(/e\.key === 'Escape'/);
  });

  it('exists only below tablet, where the rows are hidden', () => {
    // On a wide screen the rows are the page's left edge, and a button that
    // hides visible navigation adds a step to everything.
    expect(CSS).toMatch(/\.rail-burger \{ display: none; \}/);
    expect(MOBILE).toMatch(/\.rail-burger \{[^}]*display: flex/);
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

describe('the create button', () => {
  const RAIL = read(join(APP, 'components/Rail.tsx'));
  const HOME = read(join(APP, 'components/HomeView.tsx'));
  const CSS = read(join(APP, 'globals.css'));
  /** The rules that only apply below tablet. */
  const MOBILE = CSS.slice(CSS.indexOf('@media (max-width: 720px)'));

  it('is in the bar, not inside the panel the hamburger opens', () => {
    // Before `.rail-nav`, which is the block that becomes the dropdown — a
    // create button inside it is one the menu hides.
    const create = RAIL.indexOf('rail-create"');
    const panel = RAIL.indexOf('className="rail-nav"');
    expect(create).toBeGreaterThan(-1);
    expect(create).toBeLessThan(panel);
  });

  it('is in the page head on a laptop, and not in the rail at all', () => {
    /*
     * It was at the foot of the rail: a column of five places to go with the
     * one thing to *do* under them, which is the last corner the eye reaches.
     * Home's head is where the other control on that page already is, and it
     * is the corner the phone's bar has always put create in.
     *
     * The rail keeps only the bar's copy, which exists at phone width. A
     * `.rail-foot` create is the regression this asserts against.
     */
    expect(HOME).toMatch(/className="round home-create"/);
    expect(HOME).toMatch(/aria-label="Create an album"/);
    const foot = RAIL.slice(RAIL.indexOf('className="rail-foot"'));
    expect(foot, 'the rail foot is destinations only now').not.toMatch(/rail-create|"round/);
  });

  it('says what it makes, for anyone who cannot see it', () => {
    // It draws a `+` and nothing else now, so the whole of its meaning is in
    // the label: without this a screen reader announces a link called "plus",
    // or the URL.
    expect(RAIL).toMatch(/aria-label="Create an album"/);
    // And the `+` is the drawn glyph rather than a typed character, which is
    // what stops it being the one shape in the rail at somebody else's stroke
    // weight. See `RailIcon`.
    expect(RAIL).toMatch(/<RailIcon glyph="plus" \/>/);
    expect(RAIL).not.toMatch(/aria-hidden="true">\+</);
  });

  it('carries no fill, on either screen', () => {
    /*
     * The rule this is really about: the accent belongs to the photographs.
     * A blue pill in the bar and a blue slab under the rows made chrome the
     * loudest thing on a page whose subject is somebody else's evening, and
     * both of them are the app's card-coloured disc now.
     *
     * Asserted on the declaration rather than on the colour it resolves to,
     * because `--accent` moving is not what would break this — somebody
     * reaching for it here again is. The focus ring is the exception and is
     * meant to be: a ring is the one thing on the page that has to be found.
     */
    const rule = CSS.slice(CSS.indexOf('.round {'), CSS.indexOf('.round:focus'));
    expect(rule).not.toBe('');
    expect(rule).toMatch(/background: var\(--card\)/);
    expect(rule).not.toMatch(/var\(--accent/);
    expect(MOBILE).not.toMatch(/\.rail-create[^}]*var\(--accent[^-]/);
  });

  it('is the only one of itself at every width', () => {
    /*
     * Two of them exist in the markup — one in Home's head, one in the bar —
     * and exactly one is ever drawn. Two links to the same place is two tab
     * stops and two things for a screen reader to announce.
     *
     * The bar's is the phone's, because there the rows are behind a menu and
     * the head is a greeting, a title and a search control on 375px. The
     * head's is the laptop's, because there the corner is free and the rail
     * is the far side of the screen from where the eye finishes reading.
     */
    expect(CSS).toMatch(/\.rail-create \{ display: none; \}/);
    expect(MOBILE).toMatch(/\.rail-create \{[^}]*display: inline-flex/);
    expect(MOBILE).toMatch(/\.home-create \{ display: none; \}/);
  });

  it('is the same control as search, not a louder one beside it', () => {
    /*
     * They share `.round` rather than each carrying their own shape. A
     * bordered disc next to a bare glyph reads as one control and one
     * decoration, and the bare one was search — the thing on this page people
     * press more. One class, so the hover, the hairline and the glyph weight
     * cannot drift apart into two kinds of button in one corner.
     */
    expect(HOME).toMatch(/className="home-actions"/);
    expect(HOME).toMatch(/className="round home-create"/);
    expect(HOME).toMatch(/className="round search-go"/);
    // And the disc gives up its edge inside the open pill, or the field is a
    // circle drawn inside a pill.
    expect(CSS).toMatch(/\.search-open \.search-go \{[^}]*border-color: transparent/);
  });
});

describe('the rail and the app point at the same product', () => {
  /*
   * The drift this is here to stop, stated as it actually happened.
   *
   * The phone's tab bar said Albums, Chats, Find, You over a photo stack, two
   * bubbles, a magnifier and a head. The rail said Home, Activity, Groups,
   * Search, Profile over a house, an envelope and two people. Nothing was
   * wrong with either list on its own, which is why it survived four rewrites
   * of the rail — and somebody who uses both clients was being asked to learn
   * one product twice, with the two readings disagreeing about what the thing
   * they make is called.
   *
   * Both lists are read off the source here rather than written down, because
   * a copy of the answer in a test file is a fourth list to keep in step.
   */
  const RAIL = read(join(APP, 'components/Rail.tsx'));
  const BAR = readFileSync(
    fileURLToPath(new URL('../../mobile/App.tsx', import.meta.url)),
    'utf8',
  );

  /** `['home', 'photos', 'Albums'],` — the app's tab bar, as it is written. */
  const TABS = [...BAR.matchAll(/\['(home|chats|search|profile)', '(\w+)', '(\w+)'\]/g)].map(
    ([, tab, glyph, label]) => ({ tab, glyph, label }),
  );

  /** The rail's rows, likewise. */
  const ROWS = [...RAIL.matchAll(/label: '([\w ]+)', page: '(\w+)', glyph: '(\w+)'/g)].map(
    ([, label, page, glyph]) => ({ label, page, glyph }),
  );

  /** The four destinations both clients have. The app's id, then the rail's. */
  const SHARED: [string, string][] = [
    ['home', 'events'],
    ['chats', 'groups'],
    ['search', 'find'],
    ['profile', 'you'],
  ];

  it('reads both lists, so a rename cannot pass by making one unreadable', () => {
    // The assertions below are all `find`, and a regex that stopped matching
    // would make every one of them vacuous rather than failing.
    expect(TABS).toHaveLength(4);
    expect(ROWS).toHaveLength(5);
  });

  it('draws the same picture for the same place', () => {
    for (const [tab, page] of SHARED) {
      expect(ROWS.find((r) => r.page === page)?.glyph).toBe(
        TABS.find((t) => t.tab === tab)?.glyph,
      );
    }
  });

  it('uses the app words, except where the web is saying something else', () => {
    /*
     * Find and You match outright. The other two are deliberately apart, and
     * the exceptions are listed here rather than left to be discovered —
     * "it is allowed to differ" is a weaker claim than "it differs in these
     * two ways", and only the second fails when a third drifts in.
     *
     * Both differ for one reason. A phone's bar is four glyphs with a word
     * under each and nothing else on the row, so Albums and Chats name
     * themselves against their three neighbours. A rail is a column beside a
     * page: its first row is where somebody goes to start again, which is
     * Home, and its third goes to the groups rather than to every
     * conversation there is, which is Groupchats.
     */
    for (const [tab, page] of SHARED.filter(([t]) => t === 'search' || t === 'profile')) {
      expect(ROWS.find((r) => r.page === page)?.label).toBe(
        TABS.find((t) => t.tab === tab)?.label,
      );
    }
    expect(ROWS.find((r) => r.page === 'events')?.label).toBe('Home');
    const chats = TABS.find((t) => t.tab === 'chats')?.label ?? '';
    expect(chats).not.toBe('');
    expect(ROWS.find((r) => r.page === 'groups')?.label).toBe(`Group${chats.toLowerCase()}`);
  });

  it('spells the two rows the app has no tab for', () => {
    // Notifications on a tray, and it was Activity on an envelope: the page
    // stopped being invitations a while ago, and an envelope kept saying
    // somebody had asked you to something. The tray is the app's drawing for
    // the general case, borrowed for a row the app's bar does not carry.
    expect(ROWS.find((r) => r.page === 'invites')).toEqual({
      label: 'Notifications',
      page: 'invites',
      glyph: 'tray',
    });
    expect(RAIL).toMatch(/glyph="settings"/);
  });

  it('keeps the ids, because the routes and the markup hang off them', () => {
    // A label is what a reader sees; `page` is what `aria-current` is matched
    // on and what every route underneath is named. Renaming the rows must not
    // rename the product's own vocabulary — and the order is asserted here as
    // well, because this is the one list that has all five in it.
    expect(ROWS.map((r) => r.page)).toEqual(['events', 'find', 'groups', 'invites', 'you']);
  });
});
