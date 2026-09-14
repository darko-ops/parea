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
const API = read('src/api.ts');
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
    /*
     * The grid starts where the header ends, under a row of tabs. It was 248
     * under a 232pt header, with sixteen points of background showing between
     * the two — which on a screen whose header is a flat panel reads as a gap
     * somebody forgot to close rather than as air.
     *
     * One number now, and the page is pinned to it: two literals that have to
     * agree is a pair that eventually does not.
     */
    expect(SCREEN).toMatch(/styles\.cover\b/);
    expect(SCREEN).toMatch(/styles\.coverTitle/);
    expect(APP).toMatch(/const COVER = \d+;/);
    expect(APP).toMatch(/const PAGE_TOP = COVER;/);
    expect(APP).toMatch(/cover: \{ position: 'absolute', top: 0, left: 0, right: 0, height: COVER \}/);
    expect(APP).toMatch(/page: \{ position: 'absolute', top: PAGE_TOP,/);
  });

  it('leaves room for a two-line name under the corner discs', () => {
    /*
     * The discs are at 52 and 36 tall, so they end at 88. The title sits below
     * that and a two-line name has to reach the bottom edge and no further:
     * 104 + 60 of name + a 6pt gap + the meta row is the header's height.
     * Shortening the panel without moving the title is how a name ends up
     * hanging over the tabs.
     */
    expect(APP).toMatch(/coverTitle: \{ position: 'absolute', top: 104,/);
    expect(APP).toMatch(/coverBack: \{ position: 'absolute', top: 52,/);
  });

  it('puts the photograph behind glass', () => {
    /*
     * The header asked one image to be both the picture of the evening and the
     * surface four white words sit on, and a photograph is bad at the second —
     * a white tablecloth and the title is gone. Behind glass it is present,
     * coloured, and not legible as a picture, which is what the album
     * underneath is for.
     *
     * Above the image so it has something to blur, below the scrim because the
     * gradient is what makes the title legible in the cases the glass does not.
     */
    const cover = APP.slice(APP.indexOf('<View style={styles.cover}>'));
    const glass = cover.indexOf('<CoverGlass uri={cover} />');
    const scrim = cover.indexOf('<LinearGradient');
    expect(glass).toBeGreaterThan(-1);
    expect(glass).toBeLessThan(scrim);

    const GLASS = readFileSync(
      fileURLToPath(new URL('../src/CoverGlass.tsx', import.meta.url).href),
      'utf8',
    );
    /*
     * One blur, no mask, no stack — and that is only safe because it covers the
     * whole header. An earlier version softened the bottom forty points, where
     * a single uniform BlurView drew a seam where it ended. Here it ends where
     * the header ends, which is a boundary the layout already has.
     */
    expect(GLASS.match(/<BlurView/g) ?? []).toHaveLength(1);
    expect(GLASS).not.toMatch(/MaskedView/);
    // Glass rather than frost: the one material that keeps the colour of what
    // is behind it. A light or dark tint makes it a grey header.
    expect(GLASS).toMatch(/tint="systemUltraThinMaterial"/);
    expect(GLASS).toMatch(/pointerEvents="none"/);

    /*
     * And one sheet of it: no lights, no came, no tint.
     *
     * It had all three, and each came off for the same reason — they were drawn
     * for a forty-point band along the bottom edge and carried to a header 196
     * points tall without their numbers being reconsidered. A 0.04 tint is a
     * texture across forty points and a column down two hundred; a 1.5pt line
     * is an implication at forty points and a rule at two hundred.
     *
     * The guard is not "never add leading". It is that anything added here is
     * measured against this height rather than inherited, and re-adding the old
     * constants unchanged is what this catches.
     */
    expect(code(GLASS)).not.toMatch(/LIGHTS|LEAD|came/);
    expect(code(GLASS)).not.toMatch(/rgba\(255,255,255,0\.05\)|rgba\(0,0,0,0\.04\)/);
    expect(code(GLASS)).not.toMatch(/Math\.random/);
  });

  it('saturates the photograph before blurring it, not after', () => {
    /*
     * Blurring averages neighbouring pixels, and averaging colour is how you
     * make it grey — a blurred photograph is always duller than the photograph.
     * Saturating afterwards saturates the mush; saturating first gives the blur
     * livelier pixels to average, so the colour of the evening survives it.
     *
     * The order is the whole of the effect, which is why the image and the
     * treatment are one component rather than an `<ExpoImage>` with something
     * laid over it.
     */
    const GLASS = readFileSync(
      fileURLToPath(new URL('../src/CoverGlass.tsx', import.meta.url).href),
      'utf8',
    );
    const filtered = GLASS.indexOf('filter="url(#lit)"');
    const blurred = GLASS.indexOf('<BlurView');
    expect(filtered).toBeGreaterThan(-1);
    expect(filtered).toBeLessThan(blurred);

    // Saturate, then lift. The other order brightens the grey rather than the
    // colour.
    const saturate = GLASS.indexOf('type="saturate"');
    const lift = GLASS.indexOf('<FeComponentTransfer');
    expect(saturate).toBeLessThan(lift);

    // And it costs an import rather than a pod: the filter set comes with the
    // library already here for the glyphs and the wordmark.
    expect(GLASS).toMatch(/from 'react-native-svg'/);
  });

  it('gives the last few points of the header back to the page', () => {
    /*
     * The glass ended on a line: a panel, an edge, then the tabs. Fading the
     * foot into the page's own colour means the header stops without a boundary
     * to notice.
     *
     * Short on purpose, and it has been 40 and 18 on the way to 10. The failure
     * at every length is the same: the page below is the colour this fades to,
     * so a long ramp does not read as the header ending softly — it reads as
     * the page starting higher than it does, and the header looks cropped.
     * Only the last few points can belong to both.
     *
     * It also keeps the fade clear of the album's name, which sits at the foot
     * of the header and reaches into this when it wraps to two lines.
     */
    expect(APP).toMatch(/coverFoot: \{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 10 \}/);

    /*
     * Ramping alpha on the page's own colour, never from `'transparent'`.
     *
     * CSS transparent — and React Native's — is transparent *black*, so a
     * gradient from it to a near-white page interpolates through darkened greys
     * on the way. The fade smudges instead of dissolving, which is the
     * dirty-gradient problem and is why this looked soft rather than clean.
     */
    expect(APP).toMatch(/colors=\{\[t\.bgClear, t\.bg\]\}/);
    expect(APP).toMatch(/bgClear: 'rgba\(247,248,250,0\)'/);
    expect(APP).toMatch(/bgClear: 'rgba\(13,15,18,0\)'/);

    /*
     * And biased rather than even. An even fade across the whole band is a soft
     * edge, which reads as the panel being out of focus rather than as it
     * ending; holding it clear and then resolving late is a crisp edge that
     * happens to have no line in it.
     *
     * 0.6 of ten points leaves four points of actual ramp. The band is as short
     * as it can usefully be, so compressing the transition inside it was the
     * only room left — and much past this there is not enough ramp for a ramp,
     * at which point the line comes back and all of this was for nothing.
     */
    expect(APP).toMatch(/locations=\{\[0\.6, 1\]\}/);

    /*
     * After the scrim, not before. The scrim's bottom stop is dark, so drawn
     * over this it would put the shadow back on top of the fade and the edge
     * would return underneath it.
     */
    const cover = APP.slice(APP.indexOf('<View style={styles.cover}>'));
    expect(cover.indexOf('styles.coverFoot')).toBeGreaterThan(cover.indexOf('<LinearGradient'));
  });

  it('puts no glass over an album with no photograph', () => {
    // There is nothing behind a flat lens colour to obscure, and blurring one
    // is work that changes no pixel.
    expect(APP).toMatch(
      /\{cover \? \([\s\S]{0,600}<CoverGlass uri=\{cover\} \/>[\s\S]{0,400}\) : \([\s\S]{0,600}lensFor\(event\.id\)\.fill/,
    );
  });

  it('keeps no slab where a setting used to be', () => {
    /*
     * The point of the redesign: none of these is on the screen any more. They
     * are asserted against the screen's own slice rather than the file, because
     * every one of them still exists — in the sheet, doing the same thing.
     */
    for (const gone of [
      // The sheet's three actions run across the top as icons now — this is
      // the label under the second one.
      'Download Album',
      'Who can see it',
      // The cover's row, not its handler: `editCover` still lives on the
      // screen, because the sheet calls it and the screen owns the refresh.
      'styles.coverRow',
      '<InviteCard',
      'Create group from this event',
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
    /*
     * The default carries the rule now that the Groups tab can open an album
     * on its conversation: `initialPane` is optional, nothing sets it but an
     * in-app row that is itself a thread, and a link reaches none of them.
     */
    expect(SCREEN).toMatch(/useState<Pane>\(initialPane \?\? 'photos'\)/);
    expect(APP).toMatch(/pane\?: Pane;/);
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

/**
 * Whose photograph each one is, and a way to keep it.
 *
 * An album is several people's pictures in one column, and it attributed none
 * of them — the People pane counted them by person and the grid said nothing.
 * Saving one was the same gap from the other side: the only route was Download
 * Album, which is the whole evening and a question about megabytes first.
 */
describe('a photograph in an album', () => {
  it('says whose it is, by the key the photo carries', () => {
    /*
     * Never by an actor id. `by` is an opaque per-event digest and `Feed.people`
     * is keyed by the same digest, so the association lives inside this event
     * and is useless outside it — which is the rule `contributors.ts` exists to
     * keep and the one an obvious "just send the uploader" would break.
     */
    expect(API).toMatch(/by: string \| null;/);
    expect(APP).toMatch(/const who = item\.by \? byline\.get\(item\.by\) : undefined/);
    expect(APP).not.toMatch(/item\.uploaderId|photo\.actorId/);
  });

  it('builds the lookup once rather than searching per row', () => {
    // `people.find` inside a `renderItem` is free at five photographs and a
    // dropped frame at three hundred.
    expect(APP).toMatch(/const byline = useMemo\(/);
    expect(APP).toMatch(/new Map\(\(feed\?\.people \?\? \[\]\)\.map\(\(person\) => \[person\.key, person\]\)\)/);
  });

  it('draws the handle, not the display name', () => {
    // A column of names reads as captions; a column of handles reads as
    // attribution. The name is the fallback for somebody who has no handle.
    expect(APP).toMatch(/\{who\.handle \?\? who\.name\}/);
  });

  it('saves one photograph without asking about megabytes', () => {
    /*
     * Download Album asks first because that question is about a hundred files
     * and a minute of waiting. One picture is a second and a few megabytes, and
     * asking doubles the cost of the action.
     *
     * The original rather than a rendition: somebody saving a single photograph
     * wants the photograph, and the size argument that makes smaller copies
     * worth offering in bulk does not apply to one.
     */
    const save = APP.slice(APP.indexOf('const saveOne'), APP.indexOf('const editCover'));
    expect(save).toMatch(/url: photo\.original/);
    expect(save).not.toMatch(/Alert\.alert\([\s\S]{0,80}Save \$\{/);
    expect(APP).toMatch(/<Glyph name="download" size=\{18\} color="#fff" \/>/);
  });

  it('keeps the two out of each other’s corner', () => {
    // Opposite corners, so they never meet however long a handle is.
    expect(APP).toMatch(/tileBy: \{\s*position: 'absolute',\s*top: 10,\s*left: 10,/);
    expect(APP).toMatch(/tileSave: \{ position: 'absolute', right: 10, bottom: 10,/);
    expect(APP).toMatch(/maxWidth: '70%'/);
  });

  it('shadows the corners rather than dimming the photograph', () => {
    /*
     * These are the pictures themselves, not a header. Darkening one to label
     * it is the product having an opinion about somebody's photograph, so the
     * scrim is weaker than the cover's and clear through the middle, which is
     * most of it.
     */
    expect(APP).toMatch(
      /colors=\{\['rgba\(0,0,0,0\.34\)', 'rgba\(0,0,0,0\)', 'rgba\(0,0,0,0\.34\)'\]\}/,
    );
  });
});
