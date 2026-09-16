/**
 * Albums with nothing in them are not on the home page.
 *
 * An empty album is a card that asks to be opened and then has nothing to
 * show, and most of them were never this person's doing: somebody made an
 * evening, added people, and the evening has not happened yet. A column of
 * those was the first thing the product's main screen said, on the tab whose
 * whole subject is photographs.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const EVENTS = read('src/Events.tsx');
const APP = read('App.tsx');
const PROFILE = read('src/Profile.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HOME = code(
  EVENTS.slice(EVENTS.indexOf('export function HomeTab'), EVENTS.indexOf('export function GroupsTab')),
);

describe('the card the home list draws', () => {
  it('runs the photograph to both edges of the screen', () => {
    /*
     * A rounded card inset from both sides is an object on a page, with the
     * page showing around it. The subject of this screen is the photograph,
     * so it is the card — which is what the note at the top of `EventCard`
     * has always claimed and the 18pt radius was quietly contradicting.
     *
     * The scroll keeps its gutter for the words; the cover steps back out of
     * it, which is one number to keep in step rather than four.
     */
    expect(EVENTS).toMatch(/scroll: \{ padding: 20,/);
    expect(EVENTS).toMatch(/cover: \{ marginHorizontal: -20, overflow: 'hidden'/);
    // No radius on it at all, rather than a smaller one.
    expect(EVENTS).not.toMatch(/cover: \{[^}]*borderRadius/);
  });

  it('names the creator above the photograph, by handle, in bold', () => {
    /*
     * The handle rather than the display name: it is the half of somebody that
     * is unique and the half they can be found by, which is what a wall of
     * evenings needs to tell two people called Ana apart.
     */
    expect(EVENTS).toMatch(/styles\.byline\b/);
    expect(EVENTS).toMatch(/const by = event\.creator\.handle \?\? event\.creator\.name/);
    expect(EVENTS).toMatch(/bylineName: \{[^}]*fontWeight: '700'/);
    /*
     * And without the `@`. The sigil tells a handle from a name when the two
     * sit together in a sentence; a face and the word beside it is a byline,
     * which reads as a name whether or not it is punctuated like one.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    expect(CARD).not.toMatch(/`@\$\{event\.creator\.handle\}`/);
    // Above the cover, not under it.
    expect(EVENTS.indexOf('styles.byline}')).toBeLessThan(EVENTS.indexOf('<View style={[styles.cover,'));
  });

  it('draws a letter rather than a silhouette where there is no picture', () => {
    // The rule every other face in this product follows.
    expect(EVENTS).toMatch(/styles\.bylineBlank/);
    expect(EVENTS).toMatch(/const byLens = lensFor\(/);
  });

  it('says the handle once, not twice', () => {
    /*
     * The card names the creator in exactly one place: the byline. The line
     * beside it is about the album — how many people, and whether anything is
     * still arriving — and the line above the title is about the album too, so
     * neither of them repeats a name.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    /*
     * Drawn, which is narrower than "mentioned": the byline is a control and
     * its accessible name is built from the same value — "maya, see their
     * profile" — which is a string a screen reader speaks rather than a second
     * copy on the card. Counting every `{by}` would fail on that and pass on a
     * real duplicate rendered from a different expression.
     */
    expect(CARD.match(/>\s*\{by\}\s*</g) ?? []).toHaveLength(1);
    /*
     * And nothing beside it counts anybody.
     *
     * The tail has lost two things in two passes, for the same reason both
     * times. First "demetri · You · 1 person", which counted one person three
     * ways: the handle names them, "You" says it is theirs, "1 person" says
     * they are the only one. Then the count of people altogether — the circles
     * over the cover *are* the people, drawn as their faces, which is the
     * version of that fact somebody reads, and a number beside the handle was
     * the same thing again in a worse form on every card.
     *
     * What is left is the one thing nothing else on the card says: that
     * somebody added to it half an hour ago, and only while that is true.
     */
    expect(CARD).toMatch(
      /const about = live \? `added to \$\{ago\(new Date\(event\.lastActiveAt\), now\)\}` : '';/,
    );
    expect(CARD).not.toMatch(/'You'/);
    expect(CARD).not.toMatch(/memberCount, 'person', 'people'/);
    /*
     * And the separator goes with it. Most cards have nothing to say here — an
     * album stops being live within a day — and a `·` on its own after a
     * handle reads as a line that failed to load.
     */
    expect(CARD).toMatch(/\{about !== '' && \(/);
  });

  it('leaves the host out of the circles and scales them to 70%', () => {
    /*
     * The host is named and pictured in the byline directly above, so the
     * first circle was the same person twice on one card.
     *
     * Filtered rather than sliced off the front: the server orders the host
     * first, so dropping `[0]` looks identical right up until an event whose
     * creator never turned up to it — and then the card quietly stops showing
     * a real guest.
     */
    expect(EVENTS).toMatch(/event\.faces\.filter\(\(face\) => !face\.isCreator\)/);
    expect(EVENTS).not.toMatch(/event\.faces\.slice\(0, CARD_FACES\)/);
    // And the "+N" does not count them either, when they were in it at all.
    expect(EVENTS).toMatch(/const hostCounted = event\.faces\.length > others\.length \? 1 : 0/);

    // 70% of 34, with the ring, the overlap and the letter scaled with it.
    expect(EVENTS).toMatch(/width: 24,\s*\n\s*height: 24,\s*\n\s*borderRadius: 12,\s*\n\s*borderWidth: 1\.5,\s*\n\s*marginRight: -6,/);
    expect(EVENTS).toMatch(/faceLetter: \{ fontSize: 8\.5/);
  });

  it('measures the text column from the glass, not from the scroll', () => {
    /*
     * Everything in the card's column sat at the scroll's 20 plus 4 of its
     * own — 24 from the screen, which was right while the photograph was an
     * inset card and its corner was the thing being aligned to. The picture
     * runs to the edge now, so the only edge left to measure from is the
     * screen's, and 24 read as a wide margin beside one with none at all.
     *
     * `-4` against the scroll's 20 is 16, and the three blocks must agree.
     */
    expect(EVENTS).toMatch(/scroll: \{ padding: 20,/);
    expect(EVENTS).toMatch(/measured: \{[^}]*marginHorizontal: -4,/);
    expect(EVENTS).toMatch(/byline: \{[^}]*marginHorizontal: -4,/);
    /*
     * The name is on the photograph now rather than in the column, so it
     * measures from the screen directly — 16, which is the same edge the two
     * lines above it sit on, reached by a different sum.
     */
    expect(EVENTS).toMatch(/cardTitle: \{[\s\S]*?right: 16,/);
    expect(EVENTS).toMatch(/faces: \{ flexDirection: 'row', marginTop: -13, marginLeft: -4/);
  });

  it('puts the album’s name in the corner of its own photograph', () => {
    /*
     * The name is *about* the picture, so it goes on it.
     *
     * It has now been in three places. Under the cover at 18 points, which
     * made a wall of pictures you had to scroll past to find out what any of
     * them were; above the byline at 24, which fixed that and left the top of
     * every card as three stacked lines before the photograph arrived — a
     * rule, a headline, a face and a handle. On the cover there is one quiet
     * measurement and the person whose evening it was, and the name is where
     * the thing it names is.
     *
     * Bottom right, because the faces overlap the opposite corner: the two
     * ends of that edge are already spoken for separately.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    const title = CARD.indexOf('styles.cardTitle');
    expect(title).toBeGreaterThan(CARD.indexOf('<View style={[styles.cover,'));
    expect(title).toBeLessThan(CARD.indexOf('styles.faces}'));
    expect(EVENTS).toMatch(/cardTitle: \{[\s\S]*?position: 'absolute',[\s\S]*?textAlign: 'right',/);
    /*
     * White with a shadow rather than a bar behind it: a block of chrome
     * across the foot of somebody's photograph is a caption that has become
     * furniture, and the gradient does the work of making white legible.
     */
    expect(EVENTS).toMatch(/cardTitle: \{[\s\S]*?color: '#fff',/);
    expect(CARD).toMatch(/colors=\{\['rgba\(0,0,0,0\)', 'rgba\(0,0,0,0\.42\)'\]\}/);
    // Clear through the top two-thirds, which is most of the picture.
    expect(CARD).toMatch(/locations=\{\[0\.62, 1\]\}/);
    // Set like a headline, with the tracking pulled in at this size.
    expect(EVENTS).toMatch(/cardTitle: \{[\s\S]*?fontSize: 24,[\s\S]*?letterSpacing: -0\.4,/);
    /*
     * Two lines rather than one: "Sunday lunch at the Kostas'" is a real name
     * for an album, and cutting it at one line loses the end that tells it
     * from every other Sunday lunch.
     */
    expect(CARD).toMatch(/styles\.cardTitle[\s\S]{0,60}numberOfLines=\{2\}/);
    // The 18pt one survives on the card with nothing in it, which has no
    // photograph to be a headline over.
    expect(EVENTS).toMatch(/eventName: \{ fontSize: 18, fontWeight: '700' \}/);
  });

  it('dates and measures the album on a rule above the title', () => {
    /*
     * Two numbers and a date — the label on the outside of the box — set in
     * the one monospaced face in the product, with a hairline running from
     * where the words stop to the edge of the column. The rule is what makes a
     * stack of these read as entries rather than as a feed: every card gets
     * the same top edge whatever length its date is.
     */
    expect(EVENTS).toMatch(
      /const measured = \[date, plural\(event\.photoCount, 'photo'\)\]/,
    );
    expect(EVENTS).toMatch(/measuredText: \{[\s\S]*?ios: 'Menlo', default: 'monospace'/);
    expect(EVENTS).toMatch(/measuredText: \{[\s\S]*?textTransform: 'uppercase',/);
    expect(EVENTS).toMatch(/rule: \{ flex: 1, height: 1 \}/);
    /*
     * And no live chip on the end of it. A coloured dot and the word beside it
     * is the loudest thing on a card whose subject is somebody else's
     * photograph, and the byline already says "added to 20 min ago" in words
     * the reader was going to read anyway.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    expect(CARD).not.toMatch(/>\s*live\s*</i);
    expect(CARD).toMatch(/live \? `added to \$\{ago\(/);
  });

  it('shows what is inside as a row of three, and counts what it leaves out', () => {
    /*
     * The card led with one photograph and stopped, which asks somebody to
     * open an album to find out whether it is worth opening.
     *
     * `slice(1, 4)` because the first entry of `mosaic` is always the picture
     * the card is already leading with — the server prepends a chosen cover to
     * it, and where there is none the lead is `mosaic[0]` drawn larger — and
     * because three is as many as a row that does not scroll can hold without
     * every tile becoming too small to recognise anybody in.
     */
    expect(EVENTS).toMatch(/const sheet = event\.mosaic\.slice\(1, 4\);/);
    /*
     * Four photographs are on the card: the cover and the three beside it. An
     * album of seven therefore ends "+3", and counting only the strip would
     * have said "+4 more" while showing four of them — arithmetic a reader
     * does by eye and catches.
     */
    expect(EVENTS).toMatch(
      /const rest = Math\.max\(0, event\.photoCount - 1 - sheet\.length\);/,
    );
    /*
     * And it does not scroll sideways.
     *
     * It sits inside the vertical scroll that *is* the home page, and a
     * horizontal drag starting on a photograph is within a few degrees of the
     * vertical one that moves the page. Two scrollers competing for the same
     * gesture means the page sometimes does not move when somebody flicks it.
     */
    expect(EVENTS).toMatch(/sheet: \{ flexDirection: 'row', gap: SHEET_GAP, marginHorizontal: -20/);
    /*
     * And the tiles are measured rather than flexed. Equal flex would draw the
     * two tiles of a four-photograph album half a screen tall each; a card's
     * strip has to be the same height on every card or a column of them stops
     * scanning.
     */
    expect(EVENTS).toMatch(
      /const sheetTile = \(width: number\) =>\s*\(width - SHEET_GAP \* \(SHEET_TILES - 1\)\) \/ SHEET_TILES;/,
    );
    expect(EVENTS).toMatch(/style=\{\{ width: tile, height: tile \}\}/);
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    // Comments stripped: the note beside the row explains why it is not one.
    expect(code(CARD)).not.toMatch(/ScrollView/);
  });

  it('pours the mark’s colours behind the count, rather than a grey square', () => {
    /*
     * The "+N" tile was `card` over `line` — white on a white page, and in the
     * dark scheme a dark grey square, which is what a photograph looks like
     * when it has failed to load. The one tile in the row that is not a
     * photograph was reading as the one that had broken.
     *
     * The mark's own three colours instead, poured rather than drawn: mint
     * underneath, a pink bloom where the mark's top circle sits and a blue one
     * where its lower-left circle sits, each fading out so the three meet in
     * the middle the way the logo's lenses do. Stained glass rather than a
     * logo — the shapes are gone and only the colour is left, which is the
     * most the product may say in a slot that belongs to somebody else's
     * photographs.
     */
    const GLASS = EVENTS.slice(
      EVENTS.indexOf('function SheetGlass'),
      EVENTS.indexOf('function coverHeight'),
    );
    for (const fill of ['MARK_FILLS.pink', 'MARK_FILLS.blue', 'MARK_FILLS.mint']) {
      expect(GLASS).toContain(fill);
    }
    expect(EVENTS).toMatch(/import \{ MARK_FILLS \} from '\.\/Mark';/);
    /*
     * The mint is the ground rather than a third bloom: three fades over
     * nothing leave the corners empty, and an empty corner on a tile in a row
     * of photographs is the broken-image look this replaced.
     */
    expect(GLASS).toMatch(/<Rect width="100%" height="100%" fill=\{MARK_FILLS\.mint\} \/>/);
    /*
     * Ids unique to the instance, for the reason `Mark` does the same:
     * `react-native-svg` resolves paint references against a registry that is
     * not per-`Svg` on every platform, and there is one of these per card on a
     * scrolling list.
     */
    expect(GLASS).toMatch(/useId\(\)\.replace\(/);
    /*
     * And the ink is fixed rather than following the scheme. The mark's
     * colours are the mark's colours at midnight, so what reads on them is the
     * same at midnight too.
     */
    expect(EVENTS).toMatch(/sheetRestText: \{[^}]*color: '#2f2440' \}/);
  });

  it('sends a thumbnail to its own photograph and the count to the grid', () => {
    /*
     * A tile is a picture of a specific thing, and pressing a picture of a
     * specific thing should arrive at it — landing on the grid instead asks
     * somebody to find again what they had already found and pointed at. The
     * "+N" tile is the one control on the card that is about the photographs
     * it is *not* showing, so that one goes where they all are.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    expect(CARD).toMatch(/onPress=\{\(\) => onOpen\(photo\.id!\)\}/);
    expect(CARD).toMatch(/\{rest > 0 && \([\s\S]{0,500}onPress=\{\(\) => onOpen\(\)\}/);
    // And the card itself still opens the album, as everything else on it does.
    expect(CARD).toMatch(/<Pressable onPress=\{\(\) => onOpen\(\)\} accessibilityRole="button"/);

    /*
     * The id reaches the album screen as a route field and is spent on the
     * first feed that lands — whether or not the photograph was in it. An id
     * that names nothing is a thumbnail the album no longer has, and the right
     * answer there is the grid rather than a viewer that springs open two polls
     * later when something else happens to match.
     */
    expect(APP).toMatch(/initialPhoto=\{route\.photo\}/);
    expect(APP).toMatch(/if \(!feed \|\| landed\.current\) return;\s*\n\s*landed\.current = true;/);
    expect(APP).toMatch(/feed\.photos\.find\(\(p\) => p\.id === initialPhoto\)/);
  });
});

describe('switching tabs', () => {
  it('keeps a tab alive rather than unmounting it', () => {
    /*
     * Each tab was `{tab === 'profile' && <ProfileScreen …>}`, which destroys it
     * the moment somebody looks at something else — so switching back threw away
     * what it had fetched, asked again, and sat on a spinner. It also lost the
     * scroll position, which is the part nobody reports and everybody notices.
     */
    expect(APP).toMatch(/visited\.has\('profile'\)/);
    expect(APP).toMatch(/<Pane showing=\{tab === 'profile'\}>/);
    expect(APP).not.toMatch(/\{tab === 'profile' && \(/);
    // Hidden, not laid out: four panes in a column would each get a quarter of
    // the screen.
    expect(APP).toMatch(/paneHidden: \{ display: 'none' \}/);
    expect(APP).toMatch(/pane: \{ position: 'absolute'/);
  });

  it('mounts them lazily, so a cold start fetches one tab and not four', () => {
    expect(APP).toMatch(/useState<ReadonlySet<Tab>>\(\(\) => new Set\(\['home'\]\)\)/);
  });

  it('still refreshes the ones that can go stale, without a spinner', () => {
    /*
     * A kept-alive tab never refetches on its own. Returning to it re-reads
     * quietly: `load` does not clear what it holds first, so the old answer
     * stays on screen until the new one lands.
     */
    expect(APP).toMatch(/active=\{tab === 'profile'\}/);
    expect(APP).toMatch(/active=\{tab === 'groups'\}/);
    for (const source of [PROFILE, EVENTS]) {
      expect(source).toMatch(/if \(active\) void load\(\);/);
    }
    // And neither resets to the empty state before fetching, which is what
    // would put the spinner back on every visit.
    expect(PROFILE).not.toMatch(/setAccount\(undefined\)/);
    expect(EVENTS).not.toMatch(/setGroups\(null\)/);
  });
});

describe('the heading row', () => {
  it('is a title and one `+`, not two words', () => {
    /*
     * The same 36pt bordered circle the Groups tab makes a group with and the
     * album screen adds photographs with. Three tabs, one shape for "make
     * something here".
     */
    expect(HOME).toMatch(/accessibilityLabel="New album or group"/);
    // The product's one piece of round chrome, shared rather than restyled per
    // corner — see `RoundButton`.
    expect(HOME).toMatch(/<RoundButton/);
    expect(HOME).toMatch(/<Glyph name="plus" size=\{20\}/);
    expect(HOME).not.toMatch(/Start one/);
    /*
     * And it offers the same two things the profile's `+` does. One glyph
     * meaning two things in one place and one thing in another is a difference
     * nobody can learn.
     */
    expect(HOME).toMatch(/<StartSomething/);
    expect(HOME).toMatch(/onAlbum=\{onCreate\}/);
    expect(HOME).toMatch(/onGroup=\{onCreateGroup\}/);
  });

  it('no longer sends anybody to a button that is not there', () => {
    // `Open a link` is gone, and so is the empty card's instruction to use it.
    expect(HOME).not.toMatch(/Open a link/);
    expect(HOME).not.toMatch(/onOpenLink/);
    expect(APP).not.toMatch(/onOpenLink=/);
  });
});

describe('the home list', () => {
  it('leaves out the ones with no photographs', () => {
    expect(HOME).toMatch(
      /const filled = events\.filter\(\s*\(event\) => event\.photoCount > 0 \|\| event\.arrivingCount > 0,\s*\);/,
    );
  });

  it('counts what is still being processed as full', () => {
    /*
     * Without `arrivingCount`, adding the first photograph to an album makes
     * it vanish for the minute or so the derivatives take and then come back —
     * which is worse than either state on its own.
     */
    expect(HOME).toMatch(/event\.arrivingCount > 0/);
  });

  it('draws the filtered list, not the whole one', () => {
    // Including the empty state and the spinner: "you have nothing" has to
    // mean the same thing as what the list below it is showing.
    expect(HOME).toMatch(/\{filled\.map\(\(event\) => \(/);
    expect(HOME).toMatch(/\{loading && filled\.length === 0 &&/);
    expect(HOME).toMatch(/\{!loading && filled\.length === 0 && \(/);
    expect(HOME).not.toMatch(/\{events\.map\(/);
  });

  it('is the home tab only', () => {
    /*
     * The groups tab reads the same `events` for the three covers under each
     * group's name, and a group whose evenings have not happened yet should
     * still be a room you can walk into.
     */
    const GROUPS = code(
      EVENTS.slice(EVENTS.indexOf('export function GroupsTab'), EVENTS.indexOf('function GroupBlock')),
    );
    expect(GROUPS).not.toMatch(/photoCount > 0/);
  });

  it('still lands you inside an album you have just made', () => {
    /*
     * This hides your own empty albums too, so the create flow must not depend
     * on the list: `onCreated` opens the event rather than returning to it —
     * and hands it the photographs the form is holding, so the album it lands
     * on is filling rather than empty.
     */
    expect(APP).toMatch(/onCreated=\{\(created, photos\) => \{[\s\S]{0,260}void open\(/);
    expect(APP).toMatch(/photos\.map\(\(photo\) => photo\.id\)/);
  });
});

/**
 * A byline is a person, so pressing one opens them.
 *
 * Two of them: the face and handle above a card on the home list, which is
 * whoever made the album, and the one on each photograph inside an album, which
 * is whoever added that picture. Both were the only things in the product that
 * named somebody and could not be pressed.
 */
describe('pressing a byline', () => {
  it('opens the person on a home card', () => {
    expect(EVENTS).toMatch(/onOpenPerson\(event\.creator\.handle!\)/);
    expect(APP).toMatch(/<HomeTab[\s\S]{0,600}onOpenPerson=\{\(handle\) => setRoute\(\{ screen: 'person', handle \}\)\}/);
  });

  it('opens the person on a photograph', () => {
    expect(APP).toMatch(/onOpenPerson\(who\.handle!\)/);
    expect(APP).toMatch(/<EventScreen[\s\S]{0,900}onOpenPerson=\{\(handle\) => setRoute\(\{ screen: 'person', handle \}\)\}/);
  });

  it('leaves the rest of each surface doing what it did', () => {
    /*
     * Nested inside the `Pressable` that was already there, which is what makes
     * both work: the inner one takes the touch when it lands on the face or the
     * name, the outer one takes everything else. The card still opens the
     * album and the row still opens the photograph.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    // Comments stripped: the prose between the two explains the nesting, and
    // 400 characters of it is longer than the markup being checked.
    expect(code(CARD)).toMatch(/<Pressable onPress=\{\(\) => onOpen\(\)\}[\s\S]{0,900}<Pressable/);
    // And the photograph's byline stopped being untouchable for exactly this.
    const tile = APP.slice(APP.indexOf('style={styles.tileBy}') - 400, APP.indexOf('style={styles.tileBy}'));
    expect(tile).not.toMatch(/pointerEvents="none"[\s\S]{0,40}tileBy/);
  });

  it('offers nothing where there is no profile to open', () => {
    /*
     * Somebody who arrived by link has a name and a face and no handle. A
     * control that does nothing is worse than a label that never offered, so
     * both are disabled and neither claims to be a button.
     */
    expect(EVENTS).toMatch(/disabled=\{!event\.creator\.handle\}/);
    expect(APP).toMatch(/disabled=\{!who\.handle\}/);
    expect(EVENTS).toMatch(/accessibilityRole=\{event\.creator\.handle \? 'button' : 'text'\}/);
    expect(APP).toMatch(/accessibilityRole=\{who\.handle \? 'button' : 'text'\}/);
  });
});
