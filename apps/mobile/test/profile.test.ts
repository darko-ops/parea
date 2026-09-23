/**
 * The profile page, and the three things about it that are decisions.
 *
 * The You tab was a form: a name field in a card, a paragraph explaining what
 * the field was for, then two lists of events under headings. Everything the
 * product knows about a person was on it and none of it looked like a person —
 * the picture, the handle and the line they wrote were on the web's profile and
 * absent here, though `/api/account/session` had been answering with all four
 * for as long as that page existed.
 *
 * Source checks, because there is no renderer in this suite. They stand in for
 * the simulator run and they catch the screen being taken apart.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const PROFILE = read('src/Profile.tsx');
const APP = read('App.tsx');
const API = read('src/api.ts');
const EVENTS = read('src/Events.tsx');

describe('the grid', () => {
  it('is albums, not photographs', () => {
    /*
     * The one place this departs from the shape it borrows. A square of
     * somebody's photographs is a wall of images with no way to tell one
     * evening from another, and the product's unit is the evening — so a tile
     * is an album, leading with the same cover its card leads with, and it
     * opens when tapped.
     */
    expect(PROFILE).toMatch(/events\.map\(\(event\)/);
    expect(PROFILE).toMatch(/uri: event\.cover\.src/);
    expect(PROFILE).toMatch(/onPress=\{\(\) => onOpen\(event\)\}/);
    // Never a photograph picked out of one: the mosaic is not consulted.
    expect(PROFILE).not.toMatch(/mosaic/);
  });

  it('keeps an empty album on the shelf', () => {
    // Leaving it out would make the grid disagree with the Albums count above
    // it — and it is still one of the things this person is in.
    expect(PROFILE).toMatch(/tileEmpty/);
    expect(PROFILE).toMatch(/borderStyle: 'dashed'/);
  });
});

describe('what the numbers may say', () => {
  it('counts only this person’s own shelf', () => {
    /*
     * Albums they can reach, photographs in those, and a friend count the
     * web's own profile already prints for you. Nothing about anybody else,
     * and the photograph number is deliberately not a claim about authorship —
     * it is the size of the shelf.
     */
    expect(PROFILE).toMatch(/\{events\.length\} \{events\.length === 1 \? 'album' : 'albums'\}/);
    expect(PROFILE).toMatch(/sum \+ event\.photoCount/);
    expect(PROFILE).toMatch(/api\s*\.friends\(\)|api\.friends\(\)/);
  });

  it('says them in one line, at the size of the handle', () => {
    /*
     * Three stacked pairs of figure and label, spread across the space beside
     * the picture, gave a shelf of eleven albums the visual weight of an
     * analytics panel. One line in one colour, because none of the three is a
     * score and the product does not want them read as one.
     */
    expect(PROFILE).toMatch(/counts: \{[^}]*fontSize: 14\.5/);
    expect(PROFILE).toMatch(/handle: \{[^}]*fontSize: 14\.5/);
    // And nothing left of the dashboard to drift back into use.
    expect(PROFILE).not.toMatch(/function Stat\b/);
    expect(PROFILE).not.toMatch(/statN|statLabel/);
  });

  it('shows a dash rather than a zero while a number is unknown', () => {
    // "0 friends" is a claim, and the wrong one to make about somebody whose
    // request has not come back.
    expect(PROFILE).toMatch(/friends === null \? '—' : friends/);
  });
});

describe('editing', () => {
  it('sends only the fields that changed', () => {
    // The route takes each optionally, so an empty bio typed by accident
    // cannot clear a handle.
    expect(PROFILE).toMatch(/if \(name\.trim\(\) !== \(account\.displayName \?\? ''\)\)/);
    expect(PROFILE).toMatch(/if \(handle\.trim\(\) !== \(account\.handle \?\? ''\)\)/);
    expect(PROFILE).toMatch(/if \(bio\.trim\(\) !== \(account\.bio \?\? ''\)\)/);
    expect(PROFILE).toMatch(/Object\.keys\(patch\)\.length === 0/);
  });

  it('repeats the route’s own words when a handle is refused', () => {
    /*
     * The route knows whether the problem is the shape, a reserved word or
     * somebody else already having it. A sentence invented here would
     * eventually say the wrong one.
     */
    expect(PROFILE).toMatch(/err\.body\.message/);
  });

  it('streams a new picture rather than reading it into JavaScript', () => {
    // A profile picture is a photograph off the camera roll; reading megabytes
    // into JS to hand them back to the same OS is the version that runs out of
    // memory on an old phone. Same uploader the event cover uses.
    expect(PROFILE).toMatch(/uploadCover\(target\.url, target\.headers/);
    expect(API).toMatch(/avatarTarget\(\)/);
    expect(API).toMatch(/'content-type': 'image\/jpeg'/);
  });
});

describe('what replaced the old tab', () => {
  it('leaves nothing behind to drift', () => {
    // The dead export is the failure mode: it would compile, keep importing
    // what it needed, and quietly become the version somebody edits.
    expect(EVENTS).not.toMatch(/export function ProfileTab/);
    expect(APP).toMatch(/<ProfileScreen/);
    expect(APP).not.toMatch(/ProfileTab/);
  });

  it('still asks about the account in the one card that asks everywhere', () => {
    // Signing in has to say the same thing wherever it is asked, so this is
    // the same component the gated callers use rather than a second copy.
    expect(PROFILE).toMatch(/import \{ AccountCard \} from '\.\/Events'/);
    expect(PROFILE).toMatch(/<AccountCard/);
  });
});

/**
 * The header's picture, bled to the edge — handoff 2c.
 *
 * One row on this screen reaches the edge and every other row does not, which
 * is a thing that only stays true if the reason is written down. The picture
 * runs through the gutter to the screen: circular where it starts, square where
 * the screen cuts it off.
 *
 * 2b drew it at 84 × 64 — the height it already had. 2c takes it to 124 × 104,
 * on the argument that at 64 a face is a thumbnail, and that the gutter is what
 * pays for the height without pushing the bio and the grid down. The height is
 * the text block's: three lines come to roughly 104, so the two sides square
 * off against each other instead of the picture floating beside the first line.
 *
 * The exception is the photograph's alone. A letter on a lens colour 124 wide
 * running off the edge is a field of colour rather than a face — it reads as a
 * banner somebody forgot to fill — so the letter stays a 64pt circle inside the
 * gutter. The header therefore has two heights depending on whether there is a
 * picture, which is intended: the taller one is a photograph and the shorter
 * one is an absence.
 */
describe('the header picture', () => {
  const PROFILE = readFileSync(
    fileURLToPath(new URL('../src/Profile.tsx', import.meta.url).href),
    'utf8',
  );

  it('is 124 by 104, rounded on the left and square on the right', () => {
    /*
     * The left radius was 52 — half the height, so a perfect arc and the whole
     * thing a capsule cut in half. That reads as a badge rather than a
     * photograph, and at this size it takes a visible bite out of whatever is
     * on the left of the picture, which on a portrait is usually a shoulder.
     *
     * What the shape has to keep is the asymmetry: rounded where it starts,
     * square where the screen cuts it off. That is what makes it a photograph
     * continuing past the edge rather than a badge sitting near one — so the
     * assertion is on the pattern, and the amount is free to be tuned.
     */
    expect(PROFILE).toMatch(
      /avatar: \{\s*width: 124,\s*height: 104,(?:\s*\/\*[\s\S]*?\*\/)?\s*borderTopLeftRadius: (\d+),\s*borderBottomLeftRadius: \1,\s*borderTopRightRadius: 0,\s*borderBottomRightRadius: 0,/,
    );
    const radius = Number(PROFILE.match(/borderTopLeftRadius: (\d+),\s*borderBottomLeftRadius:/)?.[1]);
    // Rounded at all, and short of the semicircle it was.
    expect(radius).toBeGreaterThan(0);
    expect(radius).toBeLessThan(52);
  });

  it('hangs from the top edge rather than bleeding off the side', () => {
    /*
     * The picture used to run off the right-hand edge of a header row, which
     * is why the gutter moved onto the children — a container that insets
     * everything cannot make an exception for one child. It hangs from the
     * top now, centred, and nothing is exempt. The gutter stays on the
     * children because the rows below still want it.
     */
    expect(PROFILE).toMatch(/tab: \{\s*position: 'absolute',\s*top: 0,\s*left: '50%',/);
    expect(PROFILE).toMatch(/marginLeft: -TAB_W \/ 2/);
    // Square at the top, round at the bottom: a tab pulled down, not a card.
    expect(PROFILE).toMatch(/borderBottomLeftRadius: 28,\s*borderBottomRightRadius: 28,/);
    expect(PROFILE).toMatch(/gutter: \{ paddingHorizontal: 20 \}/);
  });

  it('reads down the middle rather than across a row', () => {
    /*
     * The header was a row: words on the left taking the space, picture on
     * the right being pushed to the edge by them. With the picture above, the
     * row has nothing to push — so it is a centred column, and the text is
     * centred with the thing it sits under.
     */
    expect(PROFILE).toMatch(/head: \{ alignItems: 'center' \}/);
    expect(PROFILE).toMatch(/who: \{ alignSelf: 'stretch', alignItems: 'center' \}/);
    expect(PROFILE).toMatch(/name: \{[^}]*textAlign: 'center'/);
  });

  it('gives the letter the tab’s shape', () => {
    /*
     * This has been three things: a disc in the gutter, the photograph's
     * bled rectangle, and now the tab. The rule underneath has not moved —
     * somebody with no picture sees the shape their picture will take — only
     * the shape has.
     */
    expect(PROFILE).toMatch(/tabBlank: \{ alignItems: 'center', justifyContent: 'center' \}/);
    // The lens is on the tab now rather than on the letter's box — see
    // `tabBack`, which is what keeps the cap and the panel one colour.
    expect(PROFILE).toMatch(/styles\.tabFill, styles\.tabBlank\]/);
    expect(PROFILE).toMatch(/: lens\.fill;/);
    expect(PROFILE).toMatch(/tabFill: \{ width: '100%', height: '100%' \}/);
  });

  it('draws the crop in a box the shape of the crop', () => {
    /*
     * This frame asked for 1:1, then 6:5, then 9:16, and was given a square
     * every time: `allowsEditing` on iOS crops to a square and ignores
     * `aspect` outright, and the endpoint stores a square too. So each of
     * those shapes was a portrait box with a square source in it, and `cover`
     * paid the difference out of the sides of somebody's face.
     *
     * The frame is the shape of the crop now, so there is nothing to pay:
     * `PHOTO_H` is `TAB_W`, and [1, 1] makes Android crop the same square iOS
     * has always cropped.
     */
    expect(PROFILE).toMatch(/aspect: \[1, 1\]/);
    expect(PROFILE).toMatch(/const PHOTO_H = TAB_W;/);
    expect(PROFILE).toMatch(/const TAB_W = 172;/);
  });

  it('grows the letter with the box it is now in', () => {
    // It is the 124 × 104 frame now, not a 64pt disc — and a letter sized for
    // the disc is lost in a frame with twice the area.
    expect(PROFILE).toMatch(/avatarLetter: \{ fontSize: 38, fontWeight: '700' \}/);
  });
});

/**
 * The line of three facts under a name, and the room under the last album.
 */
describe('the counts and the clearance', () => {
  const flat = (source: string) => source.replace(/\s+/g, ' ');

  it('says "1 friend", like the two counts beside it', () => {
    /*
     * It said "1 friends". The albums and the photographs either side of it
     * each got their ternary; the third fact in a line of three was written
     * last and written differently.
     */
    /*
     * The counts row specifically, not "the file contains a ternary
     * somewhere" — the friends *panel* further down has always had one, so a
     * loose assertion here passes while the line under the name still reads
     * "1 friends". It did, when I checked by breaking it.
     */
    const counts = PROFILE.slice(
      PROFILE.indexOf('styles.counts'),
      PROFILE.indexOf('onPress={() => setEditing(true)}'),
    );
    expect(counts).not.toBe('');
    expect(flat(counts)).toMatch(
      /\{friends === null \? '—' : friends\.length\}\{' '\} \{friends !== null && friends\.length === 1 \? 'friend' : 'friends'\}/,
    );
    // The other two, unchanged, so this stays a line of three matching facts.
    expect(counts).toMatch(/events\.length === 1 \? 'album' : 'albums'/);
    expect(counts).toMatch(/photos === 1 \? 'photo' : 'photos'/);
  });

  it('says it the same way to a screen reader', () => {
    // The label is a second copy of the sentence, and a second copy is where
    // a fix like this gets applied to one of them.
    expect(flat(PROFILE)).toMatch(
      /\$\{friends\.length\} \$\{friends\.length === 1 \? 'friend' : 'friends'\}, see them/,
    );
  });

  it('leaves room under the last album for the bar that floats over it', () => {
    /*
     * This screen ends in a wall of album covers with nothing after it, so
     * whatever it reserves is the only thing between the last row and the
     * floating tab bar. It reserved 110 against a bar that occupies about 94,
     * which is 16 points of clearance — technically visible, and it reads as
     * content cut off by the chrome.
     *
     * Derived from the bar now rather than chosen by eye. See `chrome.ts`.
     */
    expect(PROFILE).toMatch(/paddingBottom: BELOW_TABS/);
    expect(PROFILE).toMatch(/import \{ BELOW_TABS \} from '\.\/chrome'/);
  });
});

/**
 * The one link, and where it sits.
 */
describe('a link on a profile', () => {
  const flat = (source: string) => source.replace(/\s+/g, ' ');

  it('sits under the counts and above the bio', () => {
    /*
     * With the facts, not under the sentence. The line above it is what this
     * person has, and an address is the same kind of thing; under the bio it
     * would read as a footnote to a sentence rather than as part of the
     * header.
     */
    const counts = PROFILE.indexOf('styles.counts');
    const link = PROFILE.indexOf('accessibilityRole="link"');
    const bio = PROFILE.indexOf('styles.bio, styles.gutter');
    expect(counts).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(counts);
    expect(bio).toBeGreaterThan(link);
  });

  it('draws nothing at all without one', () => {
    expect(PROFILE).toMatch(/\{account\?\.link && \(/);
  });

  it('shows no scheme and opens with one', () => {
    /*
     * `https://` in front of a domain is four characters of protocol on a
     * screen about a person. The stored value keeps it so that opening needs
     * no guessing — and the server refuses anything that is not http or https,
     * which is what makes handing it to the browser safe from here.
     */
    expect(PROFILE).toMatch(/Linking\.openURL\(account\.link!\)/);
    expect(PROFILE).toMatch(/account\.link\.replace\(\/\^https\?:\\\/\\\/\/, ''\)/);
  });

  it('is a field in the editor, without the scheme in it', () => {
    // Putting `https://` in the box means editing around it, and the server
    // adds it back anyway — so the field holds what somebody would say aloud.
    expect(PROFILE).toMatch(/>LINK</);
    expect(PROFILE).toMatch(/keyboardType="url"/);
    expect(PROFILE).toMatch(/useState\(\(account\.link \?\? ''\)\.replace\(/);
    expect(flat(PROFILE)).toMatch(/Leave off the https/);
  });

  it('does not count an untouched field as an edit', () => {
    // Both sides compared scheme-stripped, or opening the sheet and pressing
    // Save would rewrite the link every time.
    expect(PROFILE).toMatch(
      /if \(link\.trim\(\) !== \(account\.link \?\? ''\)\.replace\(/,
    );
  });

  it('centres the bio rather than pulling it up', () => {
    /*
     * The -8 pulled it against a header whose height was set by a 104pt
     * picture beside the text. There is no picture beside the text any more,
     * so the pull is against nothing. The inset keeps a long bio to a
     * readable measure once centred — full width and centred is a paragraph
     * ragged on both sides.
     */
    expect(PROFILE).toMatch(/bio: \{[^}]*textAlign: 'center', paddingHorizontal: 36 \}/);
    expect(PROFILE).not.toMatch(/marginTop: -8/);
  });
});

