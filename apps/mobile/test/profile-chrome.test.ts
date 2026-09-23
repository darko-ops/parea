/**
 * The two corners of the profile, and what moved to make room for them.
 *
 * The screen had one row of chrome — `Edit profile` and `Settings`, under the
 * bio — and nothing in either corner. So the quietest thing on the page sat
 * beside the loudest at the same size, there was no way to hand somebody your
 * own profile, and the tab whose subject is everything you have made was the
 * one tab with no way to make anything.
 *
 * Settings is a `⋯` in the top-left now, the `+` opposite it makes an album or
 * a group, and the half-row Settings vacated is `Share profile`.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const PROFILE = read('src/Profile.tsx');
const APP = read('App.tsx');
const EVENTS = read('src/Events.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SCREEN = code(
  PROFILE.slice(PROFILE.indexOf('export function ProfileScreen'), PROFILE.indexOf('function Settings(')),
);

describe('the two corners', () => {
  it('puts settings behind the same glyph an album uses', () => {
    /*
     * The two discs are the same controls in the same corners; what has gone
     * is the row that used to hold them. `PageHead` draws the wordmark
     * between them, and over a picture hanging from the top edge that is a
     * second thing claiming the same space — so this screen places them
     * itself and the other tabs keep the head.
     */
    expect(SCREEN).not.toMatch(/<PageHead/);
    expect(SCREEN).toMatch(/accessibilityLabel="Settings"/);
    expect(SCREEN).toMatch(/<More color=\{t\.fg\} \/>/);
    expect(read('src/RoundButton.tsx')).toMatch(/⋯/);
    // Fixed above the page rather than scrolling with it.
    expect(PROFILE).toMatch(/corner: \{ position: 'absolute', top: 62, left: 20, zIndex: 3 \}/);
    expect(PROFILE).toMatch(/cornerRight: \{ left: undefined, right: 20 \}/);
  });

  it('is the only place settings is reached from', () => {
    // It was half of the row under the bio. Two doors to one sheet is one
    // door too many, and the row is worth more to something else.
    expect(SCREEN).not.toMatch(/<Text style=\{\[styles\.actionText[^\]]*\]\}>Settings<\/Text>/);
    expect(SCREEN.match(/setSettings\(true\)/g) ?? []).toHaveLength(1);
  });

  it('draws the `+` as a stroke rather than a labelled button', () => {
    // The third `+` somebody meets in this app; the other two taught it.
    expect(SCREEN).toMatch(/<Glyph name="plus"/);
    expect(SCREEN).toMatch(/accessibilityLabel="New album or group"/);
  });
});

describe('the friends', () => {
  it('keeps the people, not only how many', () => {
    /*
     * `/api/friends` has always answered with the people — the screen threw all
     * but the length away. Keeping them is what lets the count be something to
     * press, and costs no extra request.
     */
    expect(PROFILE).toMatch(/useState<InvitablePerson\[\] \| null>\(null\)/);
    expect(PROFILE).toMatch(/api\.friends\(\)\.catch\(\(\) => null\)/);
    expect(PROFILE).not.toMatch(/\.then\(\(list\) => list\.length\)/);
  });

  it('makes only the friends half of the line a button', () => {
    /*
     * Albums and photographs are already reachable — the shelf below is the
     * albums, and a photograph lives in one. A friend was the one thing this
     * line counted that the app could not then show you.
     */
    expect(SCREEN).toMatch(/onPress=\{friends\?\.length \? \(\) => setShowFriends\(true\) : undefined\}/);
    expect(PROFILE).toMatch(/countsLink: \{ textDecorationLine: 'underline' \}/);
  });

  it('still says "—" rather than "0" before the answer is back', () => {
    // "0 friends" is a claim, and the wrong one to make about somebody whose
    // request is still in flight.
    expect(SCREEN).toMatch(/friends === null \? '—' : friends\.length/);
  });

  it('opens somebody’s own profile, by handle', () => {
    expect(SCREEN).toMatch(/onOpenPerson\(friend\.handle\)/);
    expect(APP).toMatch(/onOpenPerson=\{\(handle\) => setRoute\(\{ screen: 'person', handle \}\)\}/);
    // And closes the sheet on the way, so there is no list behind the profile.
    expect(SCREEN).toMatch(/setShowFriends\(false\);\s*if \(friend\.handle\)/);
  });

  it('lists somebody with no handle without pretending to be a way through', () => {
    // A profile is reached by handle, and not everybody has chosen one. They
    // are still a friend.
    expect(SCREEN).toMatch(/const reachable = friend\.handle != null/);
    expect(SCREEN).toMatch(/disabled=\{!reachable\}/);
  });
});

describe('the profile details', () => {
  it('sit below the tab rather than under the clock', () => {
    // Derived from the tab rather than typed — and the tab is the picture and
    // nothing else now, so there is one number rather than a sum.
    expect(PROFILE).toMatch(/scroll: \{ paddingTop: TAB_H \+ 22,/);
    expect(PROFILE).not.toMatch(/headLower/);
    expect(PROFILE).toMatch(/const TAB_H = PHOTO_H;/);
  });
});

describe('the page arrives in one piece', () => {
  it('asks for the account and the friend count together', () => {
    /*
     * These were two `await`s in a row, so the screen arrived in three stages:
     * the album grid from an already-loaded prop, then the name and picture a
     * round trip later, then a dash turning into a number a round trip after
     * that. One wave, and both `set`s in the same tick so React batches them
     * into a single render.
     */
    expect(PROFILE).toMatch(/const \[account, friends\] = await Promise\.all\(\[/);
    expect(PROFILE).not.toMatch(/setAccount\(await api\.account\(\)/);
  });

  it('holds the body until there is a body to draw', () => {
    /*
     * A page that builds itself downwards while somebody watches looks broken
     * even when every piece is right. The corners are exempt because they are
     * the same two glyphs before and after — and so is the tab, which does
     * not draw at all until there is an account: an empty tab dropping in
     * before there is anything to put in it is the page arriving twice.
     */
    const gate = SCREEN.indexOf('{account === undefined ? (');
    expect(gate).toBeGreaterThan(-1);
    expect(SCREEN.indexOf('styles.head,')).toBeGreaterThan(gate);
    expect(SCREEN.indexOf('styles.grid')).toBeGreaterThan(gate);
    expect(SCREEN).toMatch(/\{account !== undefined && \(/);
  });
});

describe('share profile', () => {
  it('took the half-row settings vacated', () => {
    expect(SCREEN).toMatch(/<Text style=\{\[styles\.actionText, \{ color: t\.fg \}\]\}>Share profile<\/Text>/);
    expect(SCREEN).toMatch(/onPress=\{shareProfile\}/);
  });

  it('hands out the handle, on the address the web already answers', () => {
    expect(SCREEN).toMatch(/Share\.share\(\{ message: `\$\{webBase\}\/u\/\$\{account\.handle\}` \}\)/);
    expect(APP).toMatch(/webBase=\{API_BASE\}/);
  });

  it('is dimmed rather than hidden before there is a handle', () => {
    // A row that changes shape depending on whether you have picked a handle
    // is a row nobody learns.
    expect(SCREEN).toMatch(/disabled=\{!account\.handle\}/);
    expect(SCREEN).toMatch(/if \(!account\?\.handle\) return;/);
  });
});

describe('what the `+` makes', () => {
  it('offers both, and creates neither by itself', () => {
    /*
     * The sheet itself lives in `StartSomething` now, because the Events tab's
     * `+` opens the same two choices — written twice they would be two sheets
     * agreeing today and disagreeing the first time somebody rewrote a line.
     */
    const SHEET = read('src/StartSomething.tsx');
    expect(SHEET).toMatch(/New album/);
    expect(SHEET).toMatch(/New group/);
    expect(SHEET).toMatch(/onAlbum\(\);/);
    expect(SHEET).toMatch(/onGroup\(\);/);
    // And the profile hands it the two destinations rather than drawing it.
    expect(SCREEN).toMatch(/onAlbum=\{onCreateEvent\}/);
    expect(SCREEN).toMatch(/onGroup=\{onCreateGroup\}/);
  });

  it('hands the album off to the photographs, which come first now', () => {
    /*
     * `pick` rather than `create`: making an album begins with choosing the
     * pictures, and the form is the second step. Every entry point goes to the
     * same place, so there is no route into the form without a selection behind
     * it — which is where its window and its cover come from.
     */
    expect(APP).toMatch(/onCreateEvent=\{\(\) => setRoute\(\{ screen: 'pick' \}\)\}/);
    expect(APP).not.toMatch(/setRoute\(\{ screen: 'create' \}\)/);
  });

  it('draws something for somebody without an account', () => {
    /*
     * The button did nothing, and this is why: the gate was written on
     * `create`, which is the second step, and the first step drew only for
     * `signedIn === true`. Nobody signed out could reach the gate, because
     * reaching it meant passing the screen that refused them — so pressing
     * "Create album" set the route to a screen no branch drew. No picker, no
     * gate, no tabs. A blank page with nothing on it and no way back.
     *
     * The gate covers every step now, so the first one answers for the flow —
     * through one predicate rather than a disjunction rewritten at each of its
     * three call sites, which is how the steps came to disagree in the first
     * place.
     */
    expect(APP).toMatch(/making\(route\) && signedIn !== true/);
    expect(APP).toMatch(/route\.screen === 'pick' \|\| route\.screen === 'create'/);
  });

  it('waits rather than accusing somebody who is signed in', () => {
    // `null` is the moment before the account request lands. A gate that
    // flashed there would tell somebody signed in that they are not — so it
    // waits, which is the one thing it must not do silently on a blank page.
    const at = APP.indexOf("signedIn !== true");
    expect(APP.slice(at, at + 600)).toMatch(/signedIn === null \? \(/);
    expect(APP.slice(at, at + 600)).toMatch(/<Waiting size=\{40\} \/>/);
  });

  it('hands the group off through the tab that holds the suggestions', () => {
    /*
     * It still goes by way of the Groups tab rather than opening the page from
     * the profile, and the reason has outlived the form it was written for: the
     * clusters live on that tab, and landing there means somebody who pressed
     * `+` meaning "a group with these people" sees them.
     *
     * The tab no longer unfolds a form; it opens the page, which is the one
     * place a group is made from any entry point.
     */
    expect(APP).toMatch(/setTab\('search'\);\s*setMakeGroup\(\(n\) => n \+ 1\);/);
    expect(APP).toMatch(/openCreate=\{makeGroup\}/);
    expect(EVENTS).toMatch(/if \(openCreate > 0\) onCreateGroup\(\);/);
  });

  it('opens again on a second press', () => {
    // A counter, not a flag: a flag already `true` cannot say "again".
    expect(APP).toMatch(/const \[makeGroup, setMakeGroup\] = useState\(0\)/);
    expect(EVENTS).toMatch(/openCreate\?: number/);
  });

  it('leaves the Groups tab the only place the form is written', () => {
    // One form, not two that drift.
    expect(PROFILE).not.toMatch(/CreateGroupForm/);
  });
});

/**
 * The hanging tab.
 *
 * The profile led with a row: a picture bleeding off the right edge, the name
 * beside it, and the product's wordmark above both. The picture hangs from
 * the top of the screen now, centred, and everything else reads down the
 * middle underneath it.
 */
describe('the tab that hangs from the top', () => {
  it('does not scroll — it retracts', () => {
    /*
     * Drawn outside the scroll view and above it, so the page passes
     * underneath. A picture that scrolled away would be the first row of the
     * content; one that shrinks in place is part of the screen.
     */
    expect(PROFILE).toMatch(/inputRange: \[0, 170\]/);
    expect(PROFILE).toMatch(/outputRange: \[TAB_W, TAB_W - 56\]/);
    expect(PROFILE).toMatch(/extrapolate: 'clamp'/);
  });

  it('retracts to the island’s band plus a little picture', () => {
    /*
     * The island is the same height however far the page has been scrolled,
     * so what is left at the end of the retract is its band and a sliver of
     * photograph — and the scrim over that band is pinned to the top rather
     * than laid out above the picture, so it does not retract with it.
     */
    expect(PROFILE).toMatch(/outputRange: \[TAB_H, CAP_H \+ PHOTO_MIN\]/);
    expect(PROFILE).toMatch(/shade: \{ position: 'absolute', top: 0, left: 0, right: 0, height: CAP_H/);
  });

  it('runs the picture to the top edge, all of it visible', () => {
    /*
     * The strip at the top has cost a picture twice. First it was opaque over
     * the photograph, which hid a hundred points of it. Then the photograph
     * started underneath it instead, which hid nothing and bought the strip
     * seventy-two points of screen — pushing everybody's face down into the
     * middle of the tab. The top of the screen is where somebody's answer to
     * who they are should be.
     *
     * So the picture is the whole tab: `TAB_H` is `PHOTO_H` is `TAB_W`, the
     * square the picker actually returns, drawn from the physical top edge
     * with nothing above it and nothing trimmed off it.
     */
    expect(PROFILE).toMatch(/const TAB_W = 172;/);
    expect(PROFILE).toMatch(/const PHOTO_H = TAB_W;/);
    expect(PROFILE).toMatch(/const TAB_H = PHOTO_H;/);
    expect(PROFILE).toMatch(/aspect: \[1, 1\]/);
    // The picture fills the tab rather than sitting in a box below a strip.
    expect(PROFILE).toMatch(/styles\.tabFill, \{ backgroundColor: tabBack \}/);
    expect(PROFILE).not.toMatch(/photo: \{ position: 'absolute'/);
    // And no corner on the image to announce a frame.
    expect(PROFILE).not.toMatch(/borderTopLeftRadius: 14/);
  });

  it('quiets the island’s band rather than covering it', () => {
    /*
     * What the island needs is somewhere calm to sit, which is a far smaller
     * ask than a strip of its own. The photograph carries on underneath at
     * full strength; the scrim only takes the brightness out of the band,
     * strongest at the very top and gone by the foot of it, so there is no
     * line anywhere.
     *
     * Dark rather than a blur: a `BlurView` is uniform and stops dead at its
     * own edge, which over the middle of a photograph is a seam — the reason
     * the cover's glass covers a whole header or nothing.
     */
    expect(PROFILE).toMatch(/const CAP_H = 72;/);
    expect(PROFILE).toMatch(
      /colors=\{\['rgba\(0,0,0,0\.5\)', 'rgba\(0,0,0,0\.3\)', 'rgba\(0,0,0,0\)'\]\}/,
    );
    expect(PROFILE).toMatch(/locations=\{\[0, 0\.5, 1\]\}/);
    // The comment above `shade` says why; this is that there is no import.
    expect(code(PROFILE)).not.toMatch(/BlurView/);
    // The picture first, the scrim over it.
    const tab = PROFILE.slice(PROFILE.indexOf('{account !== undefined && ('));
    expect(tab.indexOf('uri: account.avatarUrl')).toBeLessThan(tab.indexOf('styles.shade'));
    // And only over a photograph: a letter on a flat colour is quiet already.
    expect(PROFILE).toMatch(/\{account\?\.avatarUrl && \(\s*<LinearGradient/);
  });

  it('keeps its two animations on two nodes', () => {
    /*
     * The retract is width and height, which are layout and JS-driven; the
     * entrance is a transform and runs natively. On one view React Native
     * refuses the pair outright — so the outer view carries the size and the
     * inner one carries the drop.
     */
    expect(PROFILE).toMatch(/useNativeDriver: false,/);
    const tab = PROFILE.slice(PROFILE.indexOf('{account !== undefined && ('));
    const outer = tab.slice(0, tab.indexOf('<Pressable'));
    expect(outer).toMatch(/width: tabWidth, height: tabHeight/);
    expect(outer).toMatch(/translateY: drop\.interpolate/);
  });

  it('drops once, not on every return to the tab', () => {
    // `active` flips whenever somebody comes back, and a screen that replays
    // its entrance every time is one that never settles.
    expect(PROFILE).toMatch(/const dropped = useRef\(false\);/);
    expect(PROFILE).toMatch(/if \(account === undefined \|\| dropped\.current\) return;/);
  });

  it('centres without re-measuring on every frame', () => {
    // `alignSelf` would depend on the animated width, so the centring would
    // be recomputed for each step of the retract.
    expect(PROFILE).toMatch(/left: '50%',\s*marginLeft: -TAB_W \/ 2,/);
  });

  it('draws nothing until there is an account to draw', () => {
    // An empty tab dropping in before there is anything to put in it is the
    // page arriving twice.
    expect(PROFILE).toMatch(/\{account !== undefined && \(/);
  });
});

describe('the tab is one object', () => {
  it('paints the ribbon and what is behind the picture from one value', () => {
    /*
     * One value behind the whole tab, for the two people there is no
     * photograph to show: somebody whose picture has not decoded yet, and
     * somebody who has not set one. A tab that is two colours is two objects.
     */
    expect(PROFILE).toMatch(/const tabBack = account\?\.avatarUrl \? t\.line : lens\.fill;/);
    expect(PROFILE).toMatch(/styles\.tabFill, \{ backgroundColor: tabBack \}/);
  });
});
