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
/** The icon's field is defined here, and the tile restates it. */
const ICON_SCRIPT = readFileSync(
  fileURLToPath(new URL('../../../scripts/build-icon.mjs', import.meta.url).href),
  'utf8',
);

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const HOME = code(
  EVENTS.slice(EVENTS.indexOf('export function HomeTab'), EVENTS.indexOf('export function ChatsTab')),
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
     * And nothing beside it counts anybody, or dates anything.
     *
     * The tail has lost three things in three passes. First "demetri · You · 1
     * person", which counted one person three ways: the handle names them,
     * "You" says it is theirs, "1 person" says they are the only one. Then the
     * count of people altogether — the circles over the cover *are* the
     * people, drawn as their faces, which is the version of that fact somebody
     * reads. Then "added to 41 min ago", which went onto the photograph it is
     * about; see the mark below.
     *
     * What is left is a handle, which is what a byline is.
     */
    expect(CARD).not.toMatch(/'You'/);
    expect(CARD).not.toMatch(/memberCount, 'person', 'people'/);
    expect(CARD).not.toMatch(/bylineAbout/);
    const byline = CARD.slice(CARD.indexOf('styles.byline}'), CARD.indexOf('styles.cover,'));
    expect(byline).not.toMatch(/\{about\b/);
  });

  it('marks a live album in the corner of its cover, not beside the handle', () => {
    /*
     * It was `· added to 2 minutes ago` hung off the name, then the far end of
     * the same row. Both were a line away from the thing they are about, and
     * both started at a different place on every card because handles are
     * different lengths.
     *
     * On the picture there is no line away and no handle to start after. Top
     * right rather than bottom: the circles come over the cover's bottom edge,
     * and the bottom half of a snapshot is where its subject usually is.
     *
     * `pointerEvents="none"` because the card is one press — a view over the
     * cover that ate touches would make a dead patch in the corner of the one
     * control on the row.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    expect(CARD).toMatch(/<View style=\{styles\.coverMark\} pointerEvents="none">/);
    expect(EVENTS).toMatch(/coverMark: \{[^}]*position: 'absolute',\s*top: 10,\s*right: 10,/);
    // Inside the cover, so it is positioned against the picture.
    expect(CARD.indexOf('styles.coverMark')).toBeGreaterThan(CARD.indexOf('styles.coverShot'));
    expect(CARD.indexOf('styles.coverMark')).toBeLessThan(CARD.indexOf('styles.faces'));
  });

  it('makes the mark out of the photograph rather than laying a chip on it', () => {
    /*
     * A flat dark lozenge is the cheap version of this and it looks the same
     * on every card. The blur takes the picture behind it, so the mark is made
     * of that picture — and `systemUltraThinMaterialDark` rather than `dark`,
     * which washes what is behind it grey. Same reasoning as the album
     * header's; see `CoverGlass.tsx`.
     *
     * The tint underneath is not a fallback for the blur. It is the contrast
     * white text needs on a cover that is a bright sky, and it carries the
     * whole job where the blur does not land.
     */
    expect(EVENTS).toMatch(/tint="systemUltraThinMaterialDark"/);
    expect(EVENTS).toMatch(/coverMark: \{[^}]*backgroundColor: 'rgba\(12,12,14,0\.34\)'/);
    expect(EVENTS).toMatch(/coverMark: \{[^}]*overflow: 'hidden'/);
    expect(EVENTS).toMatch(/coverMarkText: \{ fontSize: 11,[^}]*color: '#ffffff' \}/);
  });

  it('says only the time, because a mark on a cover is about that cover', () => {
    /*
     * "added to 41 min ago" was a sentence because it sat in a column of
     * sentences and had to say which album it was about. The picture says
     * that now.
     */
    expect(EVENTS).toMatch(
      /const about = live \? ago\(new Date\(event\.lastActiveAt\), now\) : '';/,
    );
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
    expect(EVENTS).toMatch(/cardTitle: \{\s*\n\s*marginHorizontal: -4,/);
    expect(EVENTS).toMatch(/faces: \{ flexDirection: 'row', marginTop: -13, marginLeft: -4/);
  });

  it('leads with the album’s name, above the byline and below the rule', () => {
    /*
     * The name has been in three places and this is the second time in this
     * one.
     *
     * Under the cover at 18 points made a wall of pictures you had to scroll
     * past to find out what any of them were. In the corner of the cover at 24
     * put the name where the thing it names is — and cost the card its reading
     * order, because a name in the corner of a photograph is found *after* the
     * photograph, and the point of a name on a wall of evenings is to be read
     * on the way past.
     *
     * So it is a headline in the column: the measurements, the name, then
     * whose evening it was — and the cover is a photograph with nothing over
     * it again.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    const title = CARD.indexOf('styles.cardTitle');
    expect(title).toBeGreaterThan(CARD.indexOf('styles.measured}'));
    expect(title).toBeLessThan(CARD.indexOf('styles.byline}'));
    expect(title).toBeLessThan(CARD.indexOf('<View style={[styles.cover,'));
    // Set like a headline, with the tracking pulled in at this size.
    expect(EVENTS).toMatch(/cardTitle: \{[\s\S]*?fontSize: 24,[\s\S]*?letterSpacing: -0\.4,/);
    /*
     * Two lines rather than one: "Sunday lunch at the Kostas'" is a real name
     * for an album, and cutting it at one line loses the half that
     * distinguishes it.
     */
    expect(CARD).toMatch(/styles\.cardTitle[\s\S]{0,60}numberOfLines=\{2\}/);
    /*
     * And nothing is drawn over the photograph to carry it. The ramp at the
     * foot of the cover existed only to make white type legible; with the type
     * gone, darkening somebody's picture would be the product having an
     * opinion about it for no reason at all.
     */
    expect(CARD).not.toMatch(/LinearGradient/);
    expect(EVENTS).not.toMatch(/import \{ LinearGradient \}/);
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
     * photograph; the recency is a mark in the corner of that photograph, in
     * its own colours, saying the time and no more.
     */
    const CARD = EVENTS.slice(
      EVENTS.indexOf('function EventCard'),
      EVENTS.indexOf('function emptyLine'),
    );
    expect(CARD).not.toMatch(/>\s*live\s*</i);
    expect(CARD).toMatch(/const live = isLive\(event\.lastActiveAt, now\);/);
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
    expect(EVENTS).toMatch(/event\.mosaic\.slice\(1, 4\)/);
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

  it('pours the app icon’s own field behind the count, rather than a grey square', () => {
    /*
     * The "+N" tile was `card` over `line` — white on a white page, and in the
     * dark scheme a dark grey square, which is what a photograph looks like
     * when it has failed to load. The mark's three pastels replaced that and
     * were the same failure one step along: mint under pink under pale blue
     * reads as a washed-out photograph rather than as the product.
     *
     * So it is the icon's background instead — the field `build-icon.mjs`
     * paints behind the mark, which is already on the reader's home screen.
     * Every colour, offset and opacity is that script's stop for stop, which
     * is what this pins: six blooms over the icon's own base, in the icon's
     * order, and no colour in the tile that the icon does not have.
     */
    const GLASS = EVENTS.slice(
      EVENTS.indexOf('const GLASS_BASE'),
      EVENTS.indexOf('function coverHeight'),
    );
    expect(GLASS).toContain("const GLASS_BASE = '#173EA8';");
    expect(ICON_SCRIPT).toContain("const FIELD_BASE = '#173EA8';");

    /* The six, in the icon's order: pink above, violet upper left, blue down
       the left, aqua at the foot, the seam to the right of the pink and the
       teal below it. Named rather than numbered, because the order they are
       painted in is what decides which one shows where two meet. */
    const blooms = [...GLASS.matchAll(/id: '(\w+)'/g)].map((m) => m[1]);
    expect(blooms).toEqual(['pink', 'violet', 'blue', 'aqua', 'seam', 'teal']);

    /*
     * Stop for stop against the script. Not a substring check on the file:
     * every colour in the tile has to be one the icon uses, and every stop in
     * a bloom has to carry the icon's own opacity at the icon's own offset.
     * Four copies of the mark's geometry already drifted apart once; a
     * seventh copy of the palette is worth the same kind of test.
     */
    const stops = [...GLASS.matchAll(/\[([\d.]+), '(#[0-9A-F]{6})', ([\d.]+)\],/g)].map(
      (m) => [Number(m[1]), m[2], Number(m[3])] as const,
    );
    // Twenty-three: the seam has three stops where the others have four, as the
    // icon has it — a gradient holds its last stop out to the edge.
    expect(stops).toHaveLength(23);
    const ICON_STOPS = [...ICON_SCRIPT.matchAll(/\[(\d+), '(#[0-9A-F]{6})', ([\d.]+)\]/g)].map(
      (m) => [Number(m[1]) / 100, m[2], Number(m[3])] as const,
    );
    for (const [offset, colour, opacity] of stops) {
      expect(ICON_STOPS).toContainEqual([offset, colour, opacity]);
    }

    /*
     * What is restated rather than copied is where the six sit. The icon has
     * the white mark in the middle and this has a number there, and verbatim
     * the teal reaches in from the lower right far enough to put white at
     * 2.3:1 over part of the digits. Every centre is pushed toward its own
     * edge instead — outside the square, or within a tenth of its border —
     * so the middle stays the deep blue the base already is.
     */
    const centres = [...GLASS.matchAll(/cx: ([\d.]+),\n\s*cy: ([\d.]+),/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as const,
    );
    expect(centres).toHaveLength(6);
    for (const [cx, cy] of centres) {
      const edge = Math.min(cx, 1 - cx, cy, 1 - cy);
      expect(edge).toBeLessThan(0.15);
    }

    /*
     * Ids unique to the instance, for the reason `Mark` does the same:
     * `react-native-svg` resolves paint references against a registry that is
     * not per-`Svg` on every platform, and there is one of these per card on a
     * scrolling list.
     */
    expect(GLASS).toMatch(/useId\(\)\.replace\(/);
    /*
     * And the ink is fixed rather than following the scheme. The icon's field
     * is the icon's field at midnight, so what reads on it is the same at
     * midnight too — white, which is what the icon itself puts on this
     * surface, on a middle that is the darkest part of the square.
     */
    expect(EVENTS).toMatch(/sheetRestText: \{[^}]*color: '#ffffff' \}/);
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
    expect(APP).toMatch(/active=\{tab === 'chats'\}/);
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
      EVENTS.slice(EVENTS.indexOf('export function ChatsTab'), EVENTS.indexOf('function ConversationLine')),
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
    expect(APP).toMatch(/onCreated=\{\(created, photos, framing\) => \{[\s\S]{0,1400}await open\(/);
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
    /*
     * This was the album's column, where every row carried a pressable
     * handle. The column is gone and the path is not: the viewer's square
     * names the uploader and opens them, which is the one place a photograph
     * now shows you somebody.
     */
    const VIEWER = read('src/PhotoViewer.tsx');
    expect(VIEWER).toMatch(/onOpenPerson\(uploader\.handle!\)/);
    expect(APP).toMatch(/onOpenPerson=\{onOpenPerson\}/);
    expect(APP).toMatch(/<EventScreen[\s\S]{0,1300}onOpenPerson=\{\(handle\) => setRoute\(\{ screen: 'person', handle \}\)\}/);
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
     * Somebody who arrived by a link and added photographs has a name and a
     * face and no profile. A control that does nothing is worse than a label,
     * so both surfaces draw one.
     */
    const VIEWER = read('src/PhotoViewer.tsx');
    expect(VIEWER).toMatch(/disabled=\{!uploader\.handle\}/);
    expect(VIEWER).toMatch(/accessibilityRole=\{uploader\.handle \? 'button' : 'text'\}/);
  });
});

/**
 * One photograph, one picture on the card.
 *
 * `slice(1, …)` skips the entry the card leads with, which is enough when that
 * entry is a photograph. It is not enough when it is a *chosen* cover: a cover
 * is its own object under `ev/<id>/cover.jpg`, so the photograph it was
 * cropped out of is still sitting in the list behind it. An album of one
 * therefore drew that picture twice — large as the cover, and again as the
 * only thumbnail three rows down.
 */
describe('an album of one photograph', () => {
  it('draws nothing in the strip, whatever the cover bookkeeping says', () => {
    /*
     * A floor rather than a refinement of the slice. The server drops the
     * cover's own photograph where it knows which one that was, and it does
     * not always know: covers set before `coverPhotoId` existed recorded none,
     * and a cover uploaded on its own never had a photograph behind it. Both
     * of those still reach this card, so the count has to be what decides.
     */
    expect(EVENTS).toMatch(/event\.photoCount <= 1 \? \[\] : event\.mosaic\.slice\(1, 4\)/);
  });

  it('is not left to the server alone', () => {
    // The server-side half, which is the one that fixes an album of *seven*
    // showing its cover twice. Neither is sufficient; both are cheap.
    const ROUTE = readFileSync(
      fileURLToPath(new URL('../../web/app/api/events/route.ts', import.meta.url).href),
      'utf8',
    );
    expect(ROUTE).toMatch(/mosaic\.filter\(\(photo\) => photo\.id !== coverPhotoId\)/);
    // And the id itself never goes out: it is destructured off the listing.
    expect(ROUTE).toMatch(/const \{ creator, coverKey, coverPhotoId, faces: faceRows, \.\.\.rest \} = listing;/);
  });
});

/**
 * The date on a card is when the album was posted.
 *
 * It read `eventDate ?? startsAt ?? firstPhotoAt`, and the last of those is
 * `min(captured_at)` — so an album posted yesterday out of a roll from 2019
 * was dated 2019, on a screen ordered by recent activity, directly under a
 * card saying yesterday. That does not read as a date being wrong; it reads as
 * the list being out of order.
 */
describe('what a card dates an album by', () => {
  it('leads with when it was posted', () => {
    expect(EVENTS).toMatch(/const date = dateLabel\(event\.createdAt\);/);
    expect(EVENTS).not.toMatch(/dateLabel\(event\.eventDate \?\? event\.startsAt/);
  });

  it('dates every shelf of albums the same way', () => {
    /*
     * The profile's shelf used to answer a different question — "when was
     * this evening" rather than "when did this arrive" — on the argument that
     * a shelf of somebody's albums is about the evenings.
     *
     * It is one question now, and asked for: a shelf is read as a list of
     * things that were started, and `eventDate ?? firstPhotoAt` meant an
     * album posted yesterday out of a roll from 2019 sat on a profile dated
     * 2019 while the card for it on the home screen said yesterday. Two
     * surfaces, one album, two dates.
     *
     * The evening's own date has not gone anywhere: it is what the album's
     * own header says, where the subject *is* the evening.
     */
    const PROFILE = read('src/Profile.tsx');
    expect(PROFILE).toMatch(/const when = dateLabel\(event\.createdAt\);/);
    expect(PROFILE).not.toMatch(/event\.firstPhotoAt/);
    // The same rule on somebody else's, and on a group's archive.
    const PERSON = read('src/Person.tsx');
    expect(PERSON).toMatch(/at: mine\?\.createdAt \?\? event\.lastActiveAt,/);
    expect(PERSON).toMatch(/at: album\.createdAt,/);
    const GROUPS_SERVER = readFileSync(
      fileURLToPath(new URL('../../web/src/groups.ts', import.meta.url).href),
      'utf8',
    );
    expect(GROUPS_SERVER).toMatch(/at: row\.createdAt\.toISOString\(\),/);
    /* The rule that said the opposite is gone as a rule. It survives in the
       note that says why, which is where a reversed decision belongs. */
    expect(GROUPS_SERVER).not.toMatch(/at: \(row\.eventDate/);
  });

  it('is carried the whole way, not derived on the phone', () => {
    const LISTINGS = readFileSync(
      fileURLToPath(new URL('../../web/src/events.ts', import.meta.url).href),
      'utf8',
    );
    expect(LISTINGS).toMatch(/createdAt: schema\.events\.createdAt/);
    expect(LISTINGS).toMatch(/createdAt: row\.createdAt\.toISOString\(\)/);
    expect(read('src/api.ts')).toMatch(/createdAt: string;/);
  });
});


/**
 * What was said, under the photographs it was said about.
 *
 * The card showed what an album holds and nothing about what happened in it,
 * so an evening five people had talked over read exactly like one nobody had
 * opened.
 */
describe('the line under the strip', () => {
  it('leads with somebody’s words, and with their face', () => {
    /*
     * One line of what was actually said does more to show an album is alive
     * than any count of it — and a face says *whose* voice it is, which is
     * the thing the bordered bubble before this never managed. A reply on a
     * card is somebody else's words inside somebody else's evening, and the
     * two are worth telling apart.
     */
    expect(EVENTS).toMatch(
      /<Text style=\{\[styles\.replyWho, \{ color: t\.fg \}\]\}>\{event\.lastMessage\.author\}<\/Text>/,
    );
    expect(EVENTS).toMatch(/\{event\.lastMessage\.body\}/);
    // The words in `dim`, which is the whole of how a reply is set apart from
    // the album's own title and byline above it. Not italic.
    expect(EVENTS).toMatch(/styles\.replyLine, \{ color: t\.dim \}\]\} numberOfLines=\{2\}/);
    expect(EVENTS).not.toMatch(/fontStyle: 'italic'/);
    // Their picture when they have one, their letter on their own colour when
    // they do not — keyed on `authorKey`, never on a display name.
    expect(EVENTS).toMatch(/\{event\.lastMessage\.avatarUrl \? \(/);
    expect(EVENTS).toMatch(/const saidLens = lensFor\(event\.lastMessage\?\.authorKey \?\? event\.id\);/);
    expect(EVENTS).toMatch(/styles\.sayerFace, styles\.replyFace/);
  });

  it('counts the whole album, not the rest of it', () => {
    /*
     * It used to subtract the comment on screen and read `+ 3 comments` — a
     * footnote to the quote above it. The ledger is not about the quote: it
     * is how much conversation this album has, the way the line at the card's
     * head is how many photographs. A reader who counts the one they can see
     * and gets four is reading it correctly.
     */
    expect(EVENTS).toMatch(/const comments = event\.messageCount;/);
    expect(EVENTS).toMatch(/comments === 0 \? null : plural\(comments, 'comment'\)/);
    expect(EVENTS).toMatch(/reactions === 0 \? null : plural\(reactions, 'reaction'\)/);
    expect(EVENTS).toMatch(/\.join\(' · '\)/);
    expect(EVENTS).not.toMatch(/event\.messageCount - \(event\.lastMessage \? 1 : 0\)/);
    expect(EVENTS).not.toMatch(/\+ \$\{parts\.join/);
  });

  it('closes the card on the same kind of line it opens with', () => {
    /*
     * `measured` at the head says when the evening was and how many
     * photographs; this says how much was said about them — the same
     * monospaced numerals and the same hairline to the edge of the column, so
     * a stack of cards reads as entries in a ledger.
     *
     * The chevron is what keeps it from being a label: a rule running off the
     * edge is a boundary, a rule that ends in an arrow is a way through.
     */
    expect(EVENTS).toMatch(/<View style=\{\[styles\.rule, \{ backgroundColor: t\.line \}\]\} \/>/);
    expect(EVENTS).toMatch(/<Glyph name="chevron" size=\{14\} weight=\{2\.2\} color=\{t\.dim\} \/>/);
    expect(EVENTS).toMatch(/ledger: \{ flexDirection: 'row', alignItems: 'center', gap: 10 \}/);
    /* The ledger's face without the tracking: 10.5 monospace, because a
       number in the body face beside a glyph reads as a caption, and the 1.5
       of letter-spacing is for words — a two-digit number carrying trailing
       space sits visibly off its own glyph. */
    const tally = EVENTS.slice(EVENTS.indexOf('  tallyText: {'), EVENTS.indexOf('  rule: {'));
    expect(EVENTS).toMatch(/tallyText: \{\s*fontFamily: Platform\.select/);
    expect(EVENTS).toMatch(/fontSize: 10\.5,\s*fontWeight: '600',\s*\},/);
    expect(tally).not.toMatch(/letterSpacing|textTransform/);
  });

  it('says the two nouns as glyphs, and keeps the numbers', () => {
    /*
     * The tally is two things that never change and never take a third:
     * comments, and reactions. A label that is the same on every card is a
     * label nobody reads twice, and "4 COMMENTS · 12 REACTIONS" spent two
     * thirds of the line saying what the reader already knew.
     *
     * Not a new pair of drawings. The bubble is what this product already
     * draws for an album's comments and the face is the button that opens the
     * emoji picker — the two pictures somebody has already met on the screen
     * this line opens — at 13 against 10.5pt numerals, so the row reads as a
     * line of text with two marks in it rather than as a toolbar, and at the
     * family's own weight rather than the chevron's. The chevron is a single
     * stroke and needs the extra; the face has four inside an 8.5-unit circle
     * and closes up into its own ring at 2.2.
     */
    const LEDGER = EVENTS.slice(EVENTS.indexOf('<View\n              style={styles.ledger}'), EVENTS.indexOf('function emptyLine'));
    expect(LEDGER).toMatch(/<Glyph name="bubble" size=\{13\} weight=\{2\} color=\{t\.dim\} \/>/);
    expect(LEDGER).toMatch(/<Glyph name="face" size=\{13\} weight=\{2\} color=\{t\.dim\} \/>/);
    /* Each half draws only when it has something to say: one comment and no
       reactions is one glyph and one number, not a zero. */
    expect(LEDGER).toMatch(/\{comments > 0 && \(/);
    expect(LEDGER).toMatch(/\{reactions > 0 && \(/);
    expect(LEDGER).toMatch(/\{comments\}<\/Text>/);
    expect(LEDGER).toMatch(/\{reactions\}<\/Text>/);
    /*
     * And hidden from a screen reader, like the head line and for the same
     * reason: `counted` is in the card's accessible name as words, and a
     * glyph beside a digit reads there as "4 12".
     */
    expect(LEDGER).toMatch(/importantForAccessibility="no-hide-descendants"/);
    expect(LEDGER).toMatch(/accessibilityElementsHidden/);
    /* The words still exist, for that name. */
    expect(EVENTS).toMatch(/counted !== '' && `\$\{counted\}\.`/);
  });

  it('drops each half on its own, and the whole thing when there is nothing', () => {
    /*
     * Three states from two independent pieces. A reply with nobody's
     * reactions under it is the row alone; an album somebody has only reacted
     * in is the ledger alone; an album nobody has touched draws neither and
     * ends on the photographs — which is most cards and is the point, since a
     * count of zero under every quiet album is a column of nothing.
     */
    expect(EVENTS).toMatch(/\{\(event\.lastMessage \|\| counted !== ''\) && \(/);
    expect(EVENTS).toMatch(/\{event\.lastMessage && \(/);
    expect(EVENTS).toMatch(/\{counted !== '' && \(/);
  });

  it('is one tap target, into the conversation', () => {
    /*
     * The reply and the counts are the same errand, so they are one
     * `Pressable` with 8 points of padding around the column — a target only
     * as big as its text is one people miss. Nested inside the card's own:
     * the inner takes the touch when it lands here, the outer takes the rest.
     */
    expect(EVENTS).toMatch(/onPress=\{\(\) => onOpen\(undefined, 'talk'\)\}/);
    expect(EVENTS).toMatch(/marginHorizontal: -12,\s*marginTop: 4,/);
    expect(EVENTS).toMatch(/paddingTop: 10,\s*paddingHorizontal: 8,\s*paddingBottom: 8,/);
    /*
     * And a wash rather than a fade. `opacity` takes the whole block down,
     * the face included, which reads as the card dimming rather than as
     * something being pressed.
     */
    expect(EVENTS).toMatch(
      /pressed && \{ backgroundColor: dark \? '#ffffff14' : 'rgba\(20,23,28,0\.06\)' \}/,
    );
    expect(EVENTS).toMatch(/const dark = useColorScheme\(\) === 'dark';/);
  });

  it('is not a hook, because the empty-album return is above it', () => {
    // A hook below an early return is one React refuses outright.
    const card = EVENTS.slice(EVENTS.indexOf('function EventCard'), EVENTS.indexOf('function emptyLine'));
    expect(card).toMatch(/const counted = \[/);
    // Comments stripped: the prose below the return mentions
    // `useWindowDimensions` by name, and the rule is about calls.
    const after = card
      .slice(card.indexOf('if (event.photoCount === 0)'))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(after).not.toMatch(/use[A-Z]\w*\(/);
  });

  it('counts both halves of one conversation, server-side', () => {
    /*
     * A comment on a picture *is* a message with that picture's id on it, so
     * there is one number and one table. Tombstones are not in it: a deleted
     * message leaves a row so the ones either side do not appear to answer
     * each other.
     */
    const LISTINGS = read('../../apps/web/src/events.ts');
    expect(LISTINGS).toMatch(/from "event_message" m[\s\S]{0,120}m\.deleted_at is null/);
    // And a reaction names a picture rather than an album, so this one joins.
    expect(LISTINGS).toMatch(/from "photo_reaction" r\s*\n\s*join "photo" p on p\.id = r\.photo_id/);
  });
});

describe('what the bubble became', () => {
  it('is gone, container and all', () => {
    /*
     * It was a hairline box at three quarters of the screen, centred, with a
     * count under the words. The box was there to say "somebody is talking"
     * by being a speech shape; a person's own face says it without a
     * container, and says which person. What is left is a reply row and a
     * ledger line, and nothing drawn around either.
     */
    expect(EVENTS).not.toMatch(/styles\.bubble/);
    expect(EVENTS).not.toMatch(/TALK_W/);
    expect(EVENTS).not.toMatch(/talkWidth/);
    expect(EVENTS).not.toMatch(/talkLine|talkWho|talkMore/);
  });

  it('opens the conversation rather than the album, all the way down', () => {
    /*
     * A comment on a card is a pointer at a thread; landing at the top of the
     * album leaves the reader to find the tab.
     *
     * Every link in the chain, because the one that was missing was in the
     * middle of it and cost nothing to compile. The card asked for `'talk'`,
     * `App` had taken a pane since panes existed, and `HomeTab` in between
     * typed its handler as `(event, photo)` and called it with two arguments
     * — so the pane was dropped silently and the bubble opened the grid.
     */
    expect(EVENTS).toMatch(/onPress=\{\(\) => onOpen\(undefined, 'talk'\)\}/);
    expect(EVENTS).toMatch(/onOpen: \(photo\?: string, pane\?: 'photos' \| 'talk' \| 'people'\) => void;/);
    // The link that was broken: the tab's own type, and the handler it hands
    // each card.
    expect(EVENTS).toMatch(
      /onOpen: \(event: EventListing, photo\?: string, pane\?: 'photos' \| 'talk' \| 'people'\) => void;/,
    );
    expect(EVENTS).toMatch(/onOpen=\{\(photo, pane\) => onOpen\(event, photo, pane\)\}/);
    const APP2 = read('App.tsx');
    expect(APP2).toMatch(/\(event: EventListing, photo\?: string, pane\?: Pane\)/);
    // And the far end: the route's pane is what the album screen starts on.
    expect(APP2).toMatch(/initialPane=\{route\.pane\}/);
    expect(APP2).toMatch(/useState<Pane>\(initialPane \?\? 'photos'\)/);
  });

  it('leaves the card opening the album, as it always did', () => {
    // Nested inside the `Pressable` that was already there: the inner one
    // takes the touch on the bubble, the outer one takes everything else.
    const card = EVENTS.slice(EVENTS.indexOf('function EventCard'), EVENTS.indexOf('function emptyLine'));
    expect(card).toMatch(/<Pressable onPress=\{\(\) => onOpen\(\)\}/);
  });
});

describe('a photograph with something new on it', () => {
  it('wears a ring, drawn inside its own tile', () => {
    /*
     * A border on the tile would move every picture beside it by a point and
     * a half the moment somebody commented. This is laid over the photograph
     * instead, so the grid's geometry never changes.
     */
    const APP2 = read('App.tsx');
    expect(APP2).toMatch(/\{item\.unseen && \(/);
    expect(APP2).toMatch(/gridNew: \{\s*position: 'absolute',\s*top: 0,/);
    expect(APP2).toMatch(/borderColor: '#fff'/);
  });

  it('counts somebody else’s, since the reader last opened the thread', () => {
    /*
     * A mark that lights up on your own comment teaches people the mark means
     * nothing. And no marker at all means everything counts, which is right:
     * somebody who has never opened the conversation has seen none of it.
     */
    const FEED = read('../../apps/web/app/api/events/[id]/photos/route.ts');
    expect(FEED).toMatch(/m\.author_actor_id <> \$\{viewerId\}/);
    expect(FEED).toMatch(/r\.actor_id <> \$\{viewerId\}/);
    expect(FEED).toMatch(/coalesce\(\(select read_at from mark\), 'epoch'::timestamptz\)/);
  });

  it('is one marker for comments and reactions, because they share a thread', () => {
    // Comments on photographs are messages with a photo id, and the read
    // marker is the album's. There is no second thing to have read.
    const FEED = read('../../apps/web/app/api/events/[id]/photos/route.ts');
    expect(FEED).toMatch(/from "event_thread_read"/);
    expect(FEED).toMatch(/union/);
  });
});

describe('an album somebody has just added to', () => {
  it('is fetched again when the upload queue goes quiet, not when a screen closes', () => {
    /*
     * `/api/events` comes back most-recently-added-to first, and adding a
     * photograph is what moves an album up it — so an album somebody has just
     * posted into belongs at the top of the home list, the same as a new one.
     *
     * It was not getting there. Every refresh on this screen hung off leaving
     * somewhere — `leaveEvent` asks for the list on the way out of an album —
     * and on the way out of an album the photographs are still going up. The
     * list that arrived was the order from before the upload, and it stood
     * until the next pull-to-refresh, which is the one moment somebody is not
     * looking for what they just did.
     */
    expect(APP).toMatch(/if \(wasUploading\.current && pending === 0\) void refreshEvents\(\);/);
    /*
     * Counted over what is still on its way, not over the queue.
     *
     * `prune` drops finished items and keeps failures and stale ones forever,
     * so a count of `items` sits above zero for good on a phone that ever
     * failed an upload — and this would never fire again on that phone.
     */
    expect(APP).toMatch(/item\.status !== 'done' && item\.status !== 'failed' && item\.status !== 'stale'/);
  });

  it('is what the server means by first, so the client never re-sorts', () => {
    // One order, decided in one place. A second sort on the phone is a second
    // answer to "what is newest" that drifts from the web's the day either
    // changes.
    const LISTING = read('../../apps/web/src/events.ts');
    expect(LISTING).toMatch(/\.orderBy\(desc\(schema\.events\.lastActiveAt\)\)/);
    // And `lastActiveAt` is stamped where a photograph lands, which is what
    // makes "added to" and "at the top" the same event rather than two.
    const COMPLETE = read('../../apps/web/app/api/uploads/[id]/complete/route.ts');
    expect(COMPLETE).toMatch(/\.set\(\{ lastActiveAt: new Date\(\) \}\)/);
    expect(HOME).not.toMatch(/\.sort\(/);
  });
});
