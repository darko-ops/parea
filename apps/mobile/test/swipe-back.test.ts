/**
 * Getting out of a pushed screen without reaching for the corner.
 *
 * Every screen this app pushes has a back arrow in its top-left corner, which
 * on a phone is the one place a thumb holding the device cannot reach. iOS
 * answers that with an edge swipe on every screen in the system, so it is the
 * first thing people try here.
 *
 * The checks are about the two things that are easy to get wrong and invisible
 * until somebody is holding it: that the gesture does not fight the lists it
 * sits on top of, and that leaving by the gesture does exactly what leaving by
 * the arrow does.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const SWIPE = read('src/SwipeBack.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const GESTURE = code(SWIPE);

describe('the gesture', () => {
  it('adds no native dependency', () => {
    /*
     * `PanResponder` and `Animated` are in React Native already. A navigator
     * or a gesture library would both be native code, which means a rebuild
     * before anybody can see the change — and the whole navigation model here
     * is one piece of route state, with nothing for a stack to hold.
     */
    expect(GESTURE).toMatch(/from 'react-native'/);
    expect(GESTURE).toMatch(/PanResponder/);
    expect(GESTURE).not.toMatch(/react-native-gesture-handler|@react-navigation|reanimated/);
  });

  it('is claimed only from the left edge', () => {
    /*
     * The photo grid, the roster and the inverted thread are all scrollers. A
     * swipe-back that triggered anywhere on the screen would take touches away
     * from every one of them.
     */
    expect(GESTURE).toMatch(/startX <= EDGE/);
    // `onMoveShouldSetPanResponder` fires after the touch has moved, so the
    // start has to be reconstructed rather than read.
    expect(GESTURE).toMatch(/const startX = evt\.nativeEvent\.pageX - g\.dx/);
  });

  it('never takes a vertical drag', () => {
    // A diagonal is somebody scrolling with their thumb, and the list wins it.
    expect(GESTURE).toMatch(/g\.dx > Math\.abs\(g\.dy\) \* DOMINANCE/);
    expect(GESTURE).toMatch(/g\.dx > SLOP/);
  });

  it('leaves taps alone', () => {
    // Only a move starts a drag; a press belongs to whatever was pressed.
    expect(GESTURE).toMatch(/onStartShouldSetPanResponder: \(\) => false/);
    expect(GESTURE).toMatch(/onStartShouldSetPanResponderCapture: \(\) => false/);
  });

  it('goes back on distance or on a flick', () => {
    // A short fast swipe is the same intention as a long slow one.
    expect(GESTURE).toMatch(/const far = g\.dx > width \* COMMIT/);
    expect(GESTURE).toMatch(/const flung = g\.vx > FLING/);
  });

  it('finishes the animation before changing the route', () => {
    /*
     * The route change unmounts this. Doing it while the screen is still under
     * the finger shows the next screen arriving from nowhere rather than the
     * old one leaving.
     */
    expect(GESTURE).toMatch(/\}\)\.start\(\(\) => \{\s*onBackRef\.current\(\);/);
  });

  it('puts the screen back when something above takes over', () => {
    expect(GESTURE).toMatch(/onPanResponderTerminate/);
  });

  it('reads `enabled` and `onBack` through refs', () => {
    /*
     * `PanResponder.create` runs once. Rebuilding it on every render hands the
     * view a fresh responder mid-gesture and drops the drag in progress, so
     * the handlers have to read the current value rather than the one that was
     * true when they were made.
     */
    expect(GESTURE).toMatch(/live\.current = enabled/);
    expect(GESTURE).toMatch(/onBackRef\.current = onBack/);
    expect(GESTURE).toMatch(/useMemo\(/);
  });
});

describe('the screens it wraps', () => {
  it('is on every screen pushed over the tabs', () => {
    for (const back of ['leaveEvent', 'leaveGroup', 'leaveToTabs']) {
      expect(APP).toMatch(new RegExp(`<SwipeBack onBack=\\{${back}\\}>`));
    }
    // Event, group, group thread, person and door — every screen pushed over
    // the tabs that has an arrow in its corner.
    expect(APP.match(/<SwipeBack /g) ?? []).toHaveLength(5);
  });

  it('does not wrap the screens holding something half-typed', () => {
    /*
     * Making an event and taking a link both have a form in them, and a
     * gesture is easier to make by accident than a button is to press. Those
     * two keep their explicit Cancel and nothing else.
     */
    const between = (from: string) => {
      const at = APP.indexOf(from);
      return APP.slice(at, at + 900);
    };
    expect(between("route.screen === 'create' && signedIn === true")).not.toMatch(/SwipeBack/);
    expect(between("route.screen === 'join'")).not.toMatch(/SwipeBack/);
  });

  it('goes out the same door the arrow does', () => {
    /*
     * The whole point of hoisting these: leaving an event refreshes the event
     * list, leaving a group refreshes both, and a gesture that skipped the
     * refresh would leave the home screen showing a cover that has changed.
     */
    expect(APP).toMatch(/const leaveEvent = useCallback\(\(\) => \{\s*void refreshEvents\(\);/);
    expect(APP).toMatch(
      /const leaveGroup = useCallback\(\(\) => \{\s*void refreshGroups\(\);\s*void refreshEvents\(\);/,
    );
    // Both ways out of the event screen are the same callback, not two copies.
    expect(APP).toMatch(/<SwipeBack onBack=\{leaveEvent\}>/);
    expect(APP).toMatch(/onBack=\{leaveEvent\}/);
  });
});
