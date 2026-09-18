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
      'Create group from this album',
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
    /*
     * The end of the slice used to be `const editCover`, which was renamed when
     * the cover row started opening the frame directly — so `indexOf` returned
     * -1 and this had been reading the whole rest of the file, quietly passing
     * on matches from anywhere in it. Bounded on the thing that actually
     * follows `saveOne` now.
     */
    const save = APP.slice(APP.indexOf('const saveOne'), APP.indexOf('const sendCover'));
    expect(save).toMatch(/url: photo\.original/);
    expect(save).not.toMatch(/Alert\.alert\([\s\S]{0,80}Save \$\{/);
    expect(APP).toMatch(/<Glyph name="download" size=\{18\} color="#fff" \/>/);
  });

  it('offers the same save from the photograph’s own menu', () => {
    /*
     * The corner button lives on a row in a list, which somebody looking at
     * one picture in the viewer has already scrolled past by the time they
     * decide they want it — and the viewer's own chrome is a `⋯` and nothing
     * else. One function behind both, so "saved" means the same thing either
     * way: the camera's own file, not a rendition.
     */
    expect(APP).toMatch(/onDownload=\{\(\) => \{/);
    expect(APP).toMatch(/downloading=\{savingOne === actionsFor\.id\}/);
    const SHEET = APP.slice(APP.indexOf('function PhotoActions'), APP.indexOf('function Pane'));
    /*
     * Above everything else in there. It is the only action in that sheet that
     * is not about taking something away — remove, ask down, report, block —
     * and the only one most people will ever press; under three destructive
     * rows it would be the safe action buried beneath the dangerous ones.
     */
    expect(SHEET.indexOf('label={downloading')).toBeLessThan(SHEET.indexOf("label=\"Remove photo\""));
    expect(SHEET.indexOf('label={downloading')).toBeLessThan(SHEET.indexOf("label=\"Report\""));
    /*
     * Offered whoever the photograph belongs to: saving somebody else's
     * picture out of an album you are in is what the corner button has always
     * done, and what "Download album" does in bulk. A rule that let you keep
     * all of them and not one of them would be a rule about nothing.
     */
    expect(SHEET).toMatch(/\{!tagging && \(\s*\n\s*<Button\s*\n\s*label=\{downloading/);
    /*
     * And the sheet closes when it lands: a menu that stays open over the
     * photograph after the one thing you asked it for is done is a menu you
     * have to dismiss twice.
     */
    expect(APP).toMatch(/if \(saved\) setActionsFor\(null\);/);
    expect(APP).toMatch(/async \(photo: FeedPhoto\): Promise<boolean> => \{/);
  });

  it('says so when a photograph lands, in whichever layer is in front', () => {
    /*
     * Saving one said nothing at all when it worked: the glyph dimmed for a
     * second and came back, which is indistinguishable from a control that did
     * nothing — and the place the photograph lands is another app, so there
     * was no way to find out short of leaving this one.
     *
     * A note rather than an alert. An alert is a thing you have to dismiss,
     * and making somebody press OK to acknowledge that a button did what it
     * said is a second gesture charged for the first. The failure still gets
     * one, because that is a thing they have to decide about.
     */
    expect(APP).toMatch(/setSavedNote\(true\);/);
    expect(APP).toMatch(/setTimeout\(\(\) => setSavedNote\(false\), 2200\)/);
    expect(APP).toMatch(/Saved to your photos/);
    // Restarted rather than inherited, so a second save gets a full welcome.
    expect(APP).toMatch(/if \(savedTimer\.current\) clearTimeout\(savedTimer\.current\);/);
    /*
     * Drawn on both sides of the modal boundary. One of the two saves is
     * pressed from the sheet inside the photograph's viewer, and a view in the
     * album's own tree is behind that modal — the same rule the cover frame
     * and `PhotoActions` follow.
     */
    expect(APP).toMatch(/\{!selected && saved\}/);
    expect(APP).toMatch(/\{saved\}\s*\n\s*\n\s*\{\/\*/);
    // And it never takes a touch: for two seconds it lies over the corner of
    // somebody's photograph.
    expect(APP).toMatch(/<View style=\{styles\.savedShell\} pointerEvents="none">/);
    /*
     * The unread banner keeps the top of the screen and the place a thumb
     * goes, since it is the only one of the two that can be pressed. Two white
     * slabs in one corner is what the foot avoids.
     */
    expect(APP).toMatch(/!bannerGone && !savedNote &&/);
    expect(APP).toMatch(/savedShell: \{[\s\S]*?bottom: 112,/);
  });

  it('asks only to add to the camera roll, not to read it', () => {
    /*
     * It asked for the whole library to put one file into it, which was wrong
     * twice. It contradicted `library.ts`, where read access is an upgrade
     * offered only after somebody has contributed once and the app works
     * without it. And on iOS the two are separate authorisations, so anybody
     * who had declined that upgrade could never save a photograph again — the
     * request came back `granted: false` and the alert said "Try again in a
     * moment" for as long as they were willing to.
     *
     * Safe for `Asset.create`, which is what runs under it: the native side
     * performs a change request and takes the id off
     * `placeholderForCreatedAsset`, never fetching the asset back — which is
     * the operation add-only would refuse.
     */
    const PLATFORM = read('src/platform.ts');
    expect(PLATFORM).toMatch(/MediaLibrary\.requestPermissionsAsync\(true, \['photo'\]\)/);
    // The library's own read ask is a different question and stays as it was.
    const LIBRARY = read('src/library.ts');
    expect(LIBRARY).toMatch(/requestPermissionsAsync\(false, \['photo'\]\)/);
  });

  it('says what has happened to a photograph, and nothing when nothing has', () => {
    /*
     * "0 comments" under every picture in a quiet album is a column of nothing,
     * and it is worse than nothing: it makes the pictures people *have* said
     * something about harder to pick out. So each half appears only when it is
     * not zero, and neither appearing means no line at all.
     */
    expect(APP).toMatch(/const said = \[/);
    expect(APP).toMatch(/\.filter\(Boolean\)\s*\.join\(' · '\)/);
    expect(APP).toMatch(/\{said !== '' && \(/);
    // Singular and plural on both halves, because "1 comments" is the kind of
    // thing that survives forever once it ships.
    expect(APP).toMatch(/=== 1 \? 'comment' : 'comments'/);
    expect(APP).toMatch(/=== 1 \? 'reaction' : 'reactions'/);
  });

  it('counts comments off the thread it already has', () => {
    /*
     * A comment is an event message with a `photo_id`, so the number is a pass
     * over a list already in hand rather than a request. Built once: a filter
     * inside `renderItem` is a walk of the whole conversation per row.
     *
     * Tombstones do not count. A deleted comment leaves a row so the messages
     * either side do not appear to answer each other, and counting it would put
     * "1 comment" under a photograph whose only comment is gone.
     */
    expect(APP).toMatch(/const talk = useMemo\(/);
    expect(APP).toMatch(/if \(!message\.photoId \|\| message\.deleted\) continue;/);
  });

  it('keeps the counts clear of the save in the other corner', () => {
    expect(APP).toMatch(/tileSaid: \{\s*position: 'absolute',\s*left: 10,\s*bottom: 14,\s*maxWidth: '72%'/);
  });

  it('gives each of the three its own corner', () => {
    /*
     * Who added it top-left, when it arrived top-right, and the save below
     * them. The top strip is a line of text at each end, and a control in it
     * would be a third thing competing with two labels for the same forty
     * points — down in its own corner it is the only thing there, which is what
     * a control should be.
     *
     * The byline's width stops short of the date, so a long handle truncates
     * rather than running under it.
     */
    expect(APP).toMatch(/tileBy: \{\s*position: 'absolute',\s*top: 10,\s*left: 10,/);
    expect(APP).toMatch(/tileWhen: \{\s*position: 'absolute',\s*top: 10,\s*right: 10,/);
    expect(APP).toMatch(/tileSave: \{ position: 'absolute', right: 10, bottom: 10,/);
    expect(APP).toMatch(/maxWidth: '62%'/);
  });

  it('dates each one by when it arrived, not by when it was taken', () => {
    /*
     * `takenAt` falls back to `addedAt`, so for most photographs the two agree —
     * a phone that uploads the same evening. They diverge exactly where the
     * difference is worth having: somebody adding last summer's pictures
     * tonight. "Taken in July" says what it is; "added today" says it is new to
     * you, and a grid somebody is scanning wants the second.
     */
    expect(API).toMatch(/addedAt: string;/);
    expect(APP).toMatch(/const added = shortDate\(item\.addedAt\)/);
    expect(APP).not.toMatch(/shortDate\(item\.takenAt\)/);
  });

  it('pins the date to the corner rather than trailing the handle', () => {
    /*
     * It sat inside the byline, on the argument that who added a photograph and
     * when are one fact. They are — but they are one fact of very different
     * weights, and riding on the end of a name that can be any length meant
     * landing somewhere different on every row. A date that moves is a date
     * nobody reads; a column you can run your eye down is the only way a date
     * in a grid is worth anything.
     */
    // Comments stripped: the prose between the two blocks explains the move,
    // so a raw slice ends in a comment rather than in the markup being checked.
    const jsx = code(APP);
    // A `Pressable` since the byline became a way to open the person it names.
    const by = jsx.slice(
      jsx.indexOf('style={styles.tileBy}'),
      jsx.indexOf('{added &&'),
    );
    expect(by).toMatch(/styles\.tileHandle/);
    // The byline's conditional closes before the date begins, so the date is a
    // sibling of it rather than a child — which is what lets it be pinned.
    // `{}` is what the comment stripper leaves behind where a JSX comment was.
    expect(by.trimEnd()).toMatch(/<\/Pressable>\s*\)\}\s*(\{\})?$/);
    expect(by).not.toMatch(/styles\.tileWhen/);
  });

  it('dates a photograph to the year', () => {
    /*
     * `dateLabel` names the weekday and omits the year because it dates an
     * evening, where the year is usually this one. A grid somebody scrolls is
     * the other case: an album people keep adding to holds photographs from
     * several years, and "14 Sept" alone is a date that quietly assumes an
     * answer.
     */
    const CARDS = readFileSync(
      fileURLToPath(new URL('../../../packages/cards/src/index.ts', import.meta.url).href),
      'utf8',
    );
    const short = CARDS.slice(
      CARDS.indexOf('export function shortDate'),
      CARDS.indexOf('export const CARD_FACES'),
    );
    expect(short).toMatch(/year: 'numeric'/);
  });

  it('dates a file in local time, unlike an evening', () => {
    /*
     * `dateLabel` fixes the zone on purpose — an event's date is a day somebody
     * chose, not an instant, and it must read the same everywhere. A
     * photograph's arrival *is* an instant, and one added at half past eleven
     * at night is dated tomorrow by UTC: the wrong answer, given confidently.
     */
    const CARDS = readFileSync(
      fileURLToPath(new URL('../../../packages/cards/src/index.ts', import.meta.url).href),
      'utf8',
    );
    const short = CARDS.slice(
      CARDS.indexOf('export function shortDate'),
      CARDS.indexOf('export const CARD_FACES'),
    );
    expect(short).not.toMatch(/timeZone/);
    expect(short).not.toMatch(/weekday/);
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

/**
 * A comment about a photograph carries the photograph.
 *
 * The board and the photo viewer are two ways into one thread: a comment
 * written under a picture is a line on the board carrying that picture's id.
 * The board drew the line and dropped the subject, so "look at her face in
 * this one" arrived with no *this one* in it — `Thread.tsx` never read
 * `photoId` at all. The same sentence meant two different things depending on
 * where you happened to read it, and on the board it meant nothing.
 */
describe('a comment about one photograph', () => {
  const THREAD = read('src/Thread.tsx');

  it('shows the photograph it is about', () => {
    expect(THREAD).toMatch(/about\?: \{ id: string; src: string \} \| null;/);
    expect(THREAD).toMatch(/\{about && \(/);
    expect(THREAD).toMatch(/source=\{\{ uri: about\.src \}\}/);
    // Only where there is one. A line written on the board itself has no
    // photograph and must not grow a blank square.
    expect(THREAD).toMatch(/item\.photoId \? \(photoOf\?\.\(item\.photoId\) \?\? null\) : null/);
  });

  it('opens that photograph when it is tapped', () => {
    // The other half: the comment says which picture, and the picture is one
    // tap away rather than something to go and find in the grid.
    expect(THREAD).toMatch(/onPress=\{\(\) => onOpenPhoto\?\.\(about\.id\)\}/);
    expect(APP).toMatch(/onOpenPhoto=\{\(photoId\) => \{/);
    expect(APP).toMatch(/if \(photo\) setSelected\(photo\);/);
  });

  it('is handed the photographs rather than fetching them', () => {
    /*
     * The album screen already holds every photograph in the feed. A thread
     * that could ask for one would be a second path to an album's pictures
     * with its own rules about who may — which is the kind of second path the
     * egress invariant exists to prevent.
     */
    expect(THREAD).toMatch(/photoOf\?: \(photoId: string\) => \{ id: string; src: string \} \| null;/);
    expect(THREAD).not.toMatch(/api\./);
  });

  it('looks the photograph up in a map, not by scanning the album', () => {
    /*
     * One `find` per row over the album's photographs is fine at four and
     * visible at four hundred — the board is one list and the album is
     * another, and this is the shape that walks the second for every row of
     * the first.
     */
    expect(APP).toMatch(/const photoById = useMemo\(/);
    expect(APP).toMatch(/for \(const photo of feed\?\.photos \?\? \[\]\) byId\.set\(photo\.id, photo\);/);
  });

  it('draws the thumbnail from the 320, not the full size', () => {
    // It is 52 points on screen, and the grid has usually already put the
    // same picture in the cache.
    expect(APP).toMatch(/return photo \? \{ id: photo\.id, src: photo\.src \} : null;/);
  });
});

