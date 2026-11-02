/**
 * The pull-to-refresh loader's motion — handoff 7a's `conveyorLoader.ts`,
 * ported. Pure: pull distance and elapsed time in, three circles out. Drawn by
 * `ConveyorRefresh.tsx`; kept apart from it so it can be tested without a
 * phone.
 *
 * Points and milliseconds throughout.
 */

export const PALETTES: [string, string, string][] = [
  ['#17c0de', '#9db2f0', '#c79ad9'], // 6a Cool
  ['#ffb3b8', '#f3b584', '#ffe08a'], // 6b Sunset
  ['#a5dcc6', '#17c0de', '#9db2f0'], // 6c Sea
  ['#f2f4f7', '#17c0de', '#f2f4f7'], // 6d One accent
  ['#8F46DA', '#F79AB6', '#66E7C6'], // 6e Aurora
];

/**
 * The palettes a light page may draw. "One accent" is two dots of the dark
 * theme's foreground, which on a near-white page are two dots of nothing; the
 * handoff tuned all five for dark and asked for this one to be looked at.
 */
export const LIGHT_PALETTES = [0, 1, 2, 4];

export const SPEC = {
  restPull: 76,
  triggerPull: 70,
  revealPull: 80,
  dotR: 4.5,
  startX: [54, 70, 86],
  speed: 0.26,
  bobAmp: 5,
  bobPeriod: 140,
  bobPhase: 1.05,
  returnMs: 500,
  /** So the motion reads on a refresh that comes back at once. */
  minLoadingMs: 800,
};

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, x: number) => {
  const p = clamp((x - a) / (b - a));
  return p * p * (3 - 2 * p);
};
export const easeInOutCubic = (p: number) =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

/** Vertical centre of the dots: the middle of the gap the list opens. */
export const dotsY = (pull: number) => 63 + pull / 2;

export type Dot = { x: number; y: number; r: number; opacity: number };

/** While the finger is down. */
export function pullingDots(pull: number): Dot[] {
  const a = clamp(pull / SPEC.revealPull);
  return [0, 1, 2].map((i) => {
    const k = smooth(i * 0.28, i * 0.28 + 0.3, a);
    return { x: SPEC.startX[i]!, y: dotsY(pull), r: SPEC.dotR * k, opacity: k };
  });
}

/**
 * While loading and on the way back.
 *
 * `width` is the screen's, where the handoff drew a 390pt frame: the dots
 * leave the right edge and come back in from the left on a period of the width
 * plus 80, whatever phone this is.
 */
export function travellingDots(t: number, pull: number, width: number, fadeP = 0): Dot[] {
  const wrap = width + 80;
  const fade = 1 - easeInOutCubic(clamp(fadeP));
  return [0, 1, 2].map((i) => {
    const raw = SPEC.startX[i]! + 40 + t * SPEC.speed;
    const x = (((raw % wrap) + wrap) % wrap) - 40;
    const edge = smooth(-30, 10, x) * (1 - smooth(width - 10, width + 30, x));
    const bob = -SPEC.bobAmp * Math.abs(Math.sin(t / SPEC.bobPeriod + i * SPEC.bobPhase));
    return { x, y: dotsY(pull) + bob, r: SPEC.dotR * edge * fade, opacity: edge * fade };
  });
}

/** Whether a page colour is a dark one: the palettes were tuned on dark. */
export function isDarkPage(bg: string): boolean {
  const hex = bg.replace('#', '');
  if (hex.length < 6) return true;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 128;
}

/** A palette other than the last one, from those this page can draw. */
export function nextPalette(prev: number | null, allowed: number[]): number {
  const choices = allowed.filter((i) => i !== prev);
  return choices[Math.floor(Math.random() * choices.length)] ?? allowed[0]!;
}
