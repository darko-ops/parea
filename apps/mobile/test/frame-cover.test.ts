/**
 * The screen between the photographs and the form.
 *
 * A card on the home screen is a wide letterbox and a phone photograph is a
 * tall rectangle, so something is always cut off — and the only party who knew
 * what mattered in the picture was never asked. `position: 'attention'` on the
 * server guessed, which is right on a group shot and wrong on the photograph
 * somebody actually cares about, with no way to disagree.
 *
 * It also took the cover off an invisible rule. "Whichever you touched first in
 * the picker" is not discoverable while you are picking and not changeable
 * afterwards; the row on this screen is the control that rule never had.
 *
 * Source checks because there is no renderer in this suite. The arithmetic that
 * can actually be wrong is tested against real pixels on the other side, in
 * `apps/web/test/cover-framing.test.ts`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const PAGE = read('src/FrameCover.tsx');
const FORM = read('src/CreateEvent.tsx');
const API = read('src/api.ts');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('where it sits in the flow', () => {
  it('is between the photographs and the form', () => {
    // The picker no longer hands straight to the form, and the form is no
    // longer reachable without having been through here.
    expect(APP).toMatch(/screen: 'cover',\s*groupId: route\.groupId/);
    expect(APP).toMatch(/route\.screen === 'cover' && signedIn === true/);
    expect(APP).toMatch(/<FrameCover/);
  });

  it('goes back a step at a time, not out of the flow', () => {
    /*
     * Somebody who wants a different photograph has not changed their mind
     * about making an album. The form returns here holding its photographs, so
     * the step people actually go back for — the framing — survives.
     */
    expect(APP).toMatch(/screen: 'cover',[\s\S]{0,200}chosen: was\.chosen,/);
    expect(APP).toMatch(/const backToPicking = useCallback/);
    expect(APP).toMatch(/onCancel=\{backToPicking\}/);
  });

  it('is gated and re-checked like the two steps around it', () => {
    /*
     * One predicate, asked by the account gate, the way out and the re-check on
     * the way in. A step added to the flow and missed at one of them is a
     * screen with no gate or no arrow, which is how the first two came to
     * disagree — see `profile-chrome.test.ts`.
     */
    expect(APP).toMatch(/function making\(route: Route\)/);
    expect(APP).toMatch(/route\.screen === 'cover'/);
    expect(APP).toMatch(/making\(route\) && signedIn !== true/);
    expect(APP).toMatch(/if \(making\(route\)\) void refreshAccount\(\)/);
  });
});

describe('the window', () => {
  it('is the card’s own shape, full width', () => {
    /*
     * The promise this screen makes is that this is the picture the home
     * screen will show. A window inset in a margin would be a smaller version
     * of a different rectangle, and 3:2 is what `ev/<id>/cover.jpg` is encoded
     * at — see `apps/web/src/cover.ts`.
     */
    expect(PAGE).toMatch(/export const COVER_ASPECT = 3 \/ 2;/);
    expect(code(PAGE)).toMatch(/w: width, h: width \/ COVER_ASPECT/);
    expect(code(PAGE)).toMatch(/overflow: 'hidden'/);
  });

  it('positions with the same two numbers the server crops with', () => {
    // `contentFit: cover` plus `contentPosition` is CSS `object-fit` and
    // `object-position`, which is the rule `regionFor` implements. Agreeing on
    // the convention is the whole of agreeing on the result.
    expect(code(PAGE)).toMatch(/contentFit="cover"/);
    expect(code(PAGE)).toMatch(
      /contentPosition=\{\{ left: `\$\{framing\.x\}%`, top: `\$\{framing\.y\}%` \}\}/,
    );
  });

  it('drags the photograph, not a box over it', () => {
    // A finger moving right shows more of the picture's left, so the position
    // percentage goes down.
    expect(code(PAGE)).toMatch(/start\.current\.x - \(gesture\.dx \/ sx\) \* 100/);
    expect(code(PAGE)).toMatch(/start\.current\.y - \(gesture\.dy \/ sy\) \* 100/);
  });

  it('does not divide by a slack of zero', () => {
    // A 3:2 photograph in a 3:2 window has nothing to reveal sideways, and a
    // drag that moves nothing beats one that moves something by dividing by
    // zero.
    expect(code(PAGE)).toMatch(/sx > 0 \?/);
    expect(code(PAGE)).toMatch(/sy > 0 \?/);
    expect(code(PAGE)).toMatch(/Math\.max\(0, natural\.w \* scale - win\.w\)/);
  });

  it('builds the responder once and reads through refs', () => {
    /*
     * `PanResponder.create` on every render hands the view a fresh responder
     * mid-drag and drops the gesture — the trap `SwipeBack` documents, and this
     * is a drag people make slowly.
     */
    expect(code(PAGE)).toMatch(/PanResponder\.create\(\{[\s\S]*?\}\),\s*\[\],/);
    expect(code(PAGE)).toMatch(/slackRef\.current = slack/);
    expect(code(PAGE)).toMatch(/framingRef\.current = framing/);
  });
});

describe('the row', () => {
  it('promotes on a tap and drops on the ⊗', () => {
    expect(code(PAGE)).toMatch(/onPress=\{\(\) => promote\(photo\)\}/);
    expect(code(PAGE)).toMatch(/onPress=\{\(\) => drop\(photo\)\}/);
    expect(code(PAGE)).toMatch(/\[photo, \.\.\.was\.filter\(\(p\) => p\.id !== photo\.id\)\]/);
  });

  it('marks which one is the cover', () => {
    // Otherwise the row is a list of photographs with no way to tell what the
    // window above it is showing.
    expect(code(PAGE)).toMatch(/index === 0 \? t\.accent : 'transparent'/);
    expect(code(PAGE)).toMatch(/accessibilityState=\{\{ selected: index === 0 \}\}/);
  });

  it('reframes when the picture changes', () => {
    /*
     * The numbers describe where a window sits over one photograph. Carrying
     * them to another is a crop somebody chose for a different picture, which
     * looks like the drag having been ignored.
     */
    const promote = code(PAGE).slice(code(PAGE).indexOf('const promote'));
    expect(promote.slice(0, 300)).toMatch(/setFraming\(CENTRED\)/);
    expect(promote.slice(0, 300)).toMatch(/setNatural\(null\)/);
    // And dropping the one in the window hands the window to the next.
    const drop = code(PAGE).slice(code(PAGE).indexOf('const drop'));
    expect(drop.slice(0, 400)).toMatch(/was\[0\]\?\.id === photo\.id/);
  });
});

describe('what the form does with it', () => {
  it('draws the same picture with the same numbers', () => {
    // One component, so the preview and the thing previewed cannot come to
    // disagree about what was framed.
    expect(FORM).toMatch(/import \{ CENTRED, CoverFrame, type CoverFraming \} from '\.\/FrameCover'/);
    expect(code(FORM)).toMatch(/<CoverFrame[\s\S]{0,200}framing=\{framing \?\? CENTRED\}/);
  });

  it('puts it above the caption', () => {
    // A caption sits under a photograph, which is the whole reason the field is
    // called one now.
    const body = code(FORM);
    expect(body.indexOf('<CoverFrame')).toBeLessThan(body.indexOf('CAPTION'));
    expect(body).toMatch(/>CAPTION</);
    expect(body).not.toMatch(/WHAT WAS IT/);
  });

  it('sends the framing with the cover', () => {
    expect(code(FORM)).toMatch(/api\.coverTarget\(created\.id, framing\)/);
    // In the query, because the body is the photograph: the native uploader
    // streams it from disk and must not be asked to wrap it in anything.
    expect(code(API)).toMatch(/\?cx=\$\{Math\.round\(framing\.x\)\}&cy=\$\{Math\.round\(framing\.y\)\}/);
  });

  it('leaves a caller with nothing to say saying nothing', () => {
    // The web has no such screen, and an absent framing is what keeps the
    // server's `attention` crop alive for it.
    expect(code(API)).toMatch(/const where = framing\s*\?/);
    expect(code(API)).toMatch(/: '';/);
  });
});
