/**
 * What a screen shows while it is waiting.
 *
 * It was the system's grey ring on eleven screens — the right control inside a
 * button, where it means "this press is working", and the wrong one filling a
 * screen, where what somebody is looking at is the product failing to appear.
 *
 * Two things in the swap are easy to lose and invisible once lost: the meaning
 * `ActivityIndicator` carried for a screen reader, which a rotating picture does
 * not have on its own, and the fact that somebody may have asked the system to
 * stop animating things.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const WAITING = read('src/Waiting.tsx');
const MARK = read('src/Mark.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SPINNER = code(WAITING);

describe('the spinner', () => {
  it('turns the mark rather than a ring', () => {
    expect(SPINNER).toMatch(/import \{ Mark \} from '\.\/Mark'/);
    expect(SPINNER).toMatch(/outputRange: \['0deg', '360deg'\]/);
  });

  it('animates on the native thread', () => {
    /*
     * This is on screen precisely when the JavaScript thread is busy parsing
     * the response it is waiting for, which is when a JS-driven animation
     * hitches. `useNativeDriver` is the whole reason it is `Animated` and not
     * a GIF or a Lottie file.
     */
    expect(SPINNER.match(/useNativeDriver: true/g) ?? []).not.toHaveLength(0);
    expect(SPINNER).not.toMatch(/useNativeDriver: false/);
  });

  it('keeps the rotation linear', () => {
    // A rotation that eases is a rotation that looks like it keeps stalling.
    expect(SPINNER).toMatch(/easing: Easing\.linear/);
  });

  it('stops the loop when it goes away', () => {
    // A loop left running on an unmounted view is a timer nobody turns off.
    expect(SPINNER).toMatch(/return \(\) => loop\.stop\(\)/);
    expect(SPINNER).toMatch(/return \(\) => pulse\.stop\(\)/);
  });

  it('says what it is to a screen reader', () => {
    /*
     * The part that cannot be dropped in the swap: `ActivityIndicator` has this
     * meaning built in, and a rotating picture has none.
     */
    expect(SPINNER).toMatch(/accessibilityRole="progressbar"/);
    expect(SPINNER).toMatch(/accessibilityLabel="Loading"/);
  });
});

describe('where it sits', () => {
  it('takes the room that is left rather than a fixed gap', () => {
    /*
     * Padding was the first attempt and it put the mark a fixed distance below
     * the header, which on a tall phone is nowhere near the middle. `flex: 1`
     * against a content container that grows means "whatever is left", which is
     * what "centre it" actually asks for.
     */
    expect(SPINNER).toMatch(/filling: \{ flex: 1 \}/);
    expect(SPINNER).toMatch(/fill && styles\.filling/);
    expect(SPINNER).toMatch(/justifyContent: 'center'/);
    // No padding prop left to reach for.
    expect(SPINNER).not.toMatch(/paddingVertical: pad/);
  });

  it('is paired with a scroll that grows to the screen', () => {
    /*
     * Without `flexGrow` on the content container there is no spare height for
     * `flex: 1` to claim, and the spinner collapses to the size of the mark and
     * sits under the title again — which is the bug this pair exists to fix, and
     * it is invisible in either file alone.
     */
    for (const [name, style] of [
      ['src/Events.tsx', 'scroll:'],
      ['src/Events.tsx', 'groupsScroll:'],
      ['src/Profile.tsx', 'scroll:'],
    ] as const) {
      const source = read(name);
      const at = source.indexOf(style);
      expect(at, `${name} has no ${style}`).toBeGreaterThan(-1);
      expect(
        source.slice(at, source.indexOf('\n', at)),
        `${name} ${style} must grow or the spinner cannot centre`,
      ).toContain('flexGrow: 1');
    }
  });

  it('asks to fill on the tabs, and not on the screens that already centre', () => {
    // A screen that is *only* a spinner centres through its own `styles.center`.
    for (const name of ['src/Events.tsx', 'src/Profile.tsx']) {
      expect(read(name), `${name} should fill`).toMatch(/<Waiting fill \/>/);
    }
    expect(read('App.tsx')).toMatch(/<Waiting size=\{40\} \/>/);
  });
});

describe('somebody who has asked for less motion', () => {
  it('is asked, and listened to afterwards', () => {
    // A spinner on screen for four seconds is long enough for somebody to go
    // and change the setting while looking at it.
    expect(SPINNER).toMatch(/AccessibilityInfo\.isReduceMotionEnabled\(\)/);
    expect(SPINNER).toMatch(/addEventListener\('reduceMotionChanged'/);
    expect(SPINNER).toMatch(/listener\.remove\(\)/);
  });

  it('gets no rotation at all', () => {
    // Sustained spinning is exactly the movement the setting exists to stop.
    expect(SPINNER).toMatch(/still\s*\n?\s*\?\s*\{ opacity:/);
  });

  it('still gets something, rather than a screen that looks dead', () => {
    // Two seconds of a completely static logo is indistinguishable from a
    // screen that has given up. Opacity is not movement across the screen.
    expect(SPINNER).toMatch(/outputRange: \[0\.45, 1\]/);
  });
});

describe('where it replaced the ring', () => {
  it('is on the screen-level waits and not inside controls', () => {
    /*
     * A turning logo inside a button, or beside a search field, would be the
     * same mistake in the other direction: those three are reporting that one
     * press is working, not that the product is arriving.
     */
    for (const name of [
      'App.tsx',
      'src/AutoSelect.tsx',
      'src/DetectedEvents.tsx',
      'src/Door.tsx',
      'src/Person.tsx',
      'src/Groups.tsx',
      'src/GroupThread.tsx',
      'src/Events.tsx',
      'src/Profile.tsx',
    ]) {
      expect(read(name), `${name} still draws a ring for a screen`).toMatch(/<Waiting/);
    }
    // The three that keep it, deliberately.
    for (const name of ['src/CreateGroup.tsx', 'src/CreateEvent.tsx', 'src/InvitePeople.tsx']) {
      expect(read(name), `${name} should keep its inline ring`).toMatch(/<ActivityIndicator/);
    }
  });

  it('leaves no ring behind on a screen that has one of these', () => {
    for (const name of [
      'App.tsx',
      'src/AutoSelect.tsx',
      'src/DetectedEvents.tsx',
      'src/Door.tsx',
      'src/Person.tsx',
      'src/Groups.tsx',
      'src/GroupThread.tsx',
      'src/Events.tsx',
    ]) {
      expect(read(name), `${name} draws both`).not.toMatch(/<ActivityIndicator/);
    }
  });
});

describe('the mark it turns', () => {
  it('is the product’s own, not a redrawing of it', () => {
    // Checked against the other three copies by the web's `brand.test.ts`;
    // this only asserts the constants are here to be checked.
    expect(MARK).toMatch(/export const MARK_R = 200/);
    expect(MARK).toMatch(/export const MARK_CENTRES/);
    expect(MARK).toMatch(/export const MARK_FILLS/);
  });

  it('costs no new dependency', () => {
    // `react-native-svg` arrived with the glyphs.
    expect(MARK).toMatch(/from 'react-native-svg'/);
  });
});
