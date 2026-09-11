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
