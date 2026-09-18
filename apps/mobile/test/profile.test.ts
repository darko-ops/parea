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
    expect(PROFILE).toMatch(/counts: \{ fontSize: 14\.5/);
    expect(PROFILE).toMatch(/handle: \{ fontSize: 14\.5/);
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

  it('reaches the edge because the gutter moved onto the children', () => {
    /*
     * A container that insets everything cannot make an exception for one
     * child. So `paddingHorizontal` came off the scroll and each row carries
     * it — one named style, so "the gutter" stays one number rather than four
     * twenties that drift.
     */
    expect(PROFILE).not.toMatch(/scroll: \{[^}]*paddingHorizontal/);
    expect(PROFILE).toMatch(/gutter: \{ paddingHorizontal: 20 \}/);
    for (const row of ['styles.bio', 'styles.actions', 'styles.grid']) {
      expect(PROFILE, `${row} must keep the gutter`).toMatch(
        new RegExp(`\\[${row.replace('.', '\\.')}, styles\\.gutter`),
      );
    }
    /*
     * `styles.bar` was a fourth. The corners row is `PageHead` now — shared
     * with three other tabs that place it differently — so it wears the gutter
     * on a wrapper rather than carrying one of its own.
     */
    expect(PROFILE, 'the head row must keep the gutter').toMatch(
      /<View style=\{styles\.gutter\}>\s*\n\s*<PageHead/,
    );
  });

  it('is pushed right by the words, not by a space-between', () => {
    /*
     * `justifyContent: 'space-between'` spreads its children inside the row's
     * box, which would leave the picture 20 points short of the edge however
     * the padding was arranged. `who` taking the space is what puts it flush.
     *
     * Centred rather than top-aligned since 2c: the picture is the height of
     * the text block now, so aligning to the first line would hang it below the
     * last one.
     */
    expect(PROFILE).toMatch(/head: \{ flexDirection: 'row', alignItems: 'center', paddingLeft: 20, gap: 14 \}/);
    expect(PROFILE).toMatch(/who: \{ flex: 1, minWidth: 0 \}/);
  });

  it('leaves the letter a circle inside the gutter', () => {
    // A flat lens colour running off the edge is a field of colour, not a face.
    expect(PROFILE).toMatch(/avatarBlank: \{\s*width: 64,\s*height: 64,\s*borderRadius: 32,\s*marginRight: 20,/);
    // And it is no longer the photograph's shape with extras layered on it,
    // which is what would quietly give it the bleed back.
    expect(PROFILE).toMatch(/<View style=\{\[styles\.avatarBlank, \{ backgroundColor: lens\.fill \}\]\}>/);
  });

  it('crops for the largest place it is drawn', () => {
    /*
     * The picker asked for a square, on the argument that the avatar is a
     * circle everywhere else — the faces over a cover, the tiles in Lately, the
     * rows in a thread — and a landscape file is cropped again by every one of
     * them.
     *
     * That is true and it is the smaller loss. A circle takes the middle of a
     * 6:5 frame, which for a face is the face. A square centre-cropped into a
     * 124 × 104 box loses the top and bottom of what somebody framed — usually
     * the top of their head, at the one size where it is unmistakable.
     */
    expect(PROFILE).toMatch(/aspect: \[6, 5\]/);
    expect(PROFILE).not.toMatch(/aspect: \[1, 1\]/);
  });

  it('does not grow the letter with the box it is not in', () => {
    // The fallback tile is still 64 points across, so its letter is still 25.
    expect(PROFILE).toMatch(/avatarLetter: \{ fontSize: 25, fontWeight: '700' \}/);
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

