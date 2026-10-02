/**
 * The colour behind the glass: the Moments bar's aurora, and the corner
 * discs' tint, which is the same colour so the two read as one material.
 *
 * Three of `IconField`'s colours on dark, and the web's softer three on light
 * (see `.moments-bar-bloom`) — on white, a little colour is already a lot.
 * Places and radii are the bar's: a wide card lit from its right-hand end.
 * `RoundButton` re-places them for a disc and keeps the colours.
 */

export type AuroraLight = { id: string; colour: string; opacity: number };

export const AURORA_DARK: readonly AuroraLight[] = [
  { id: 'violet', colour: '#8F46DA', opacity: 0.9 },
  { id: 'pink', colour: '#F79AB6', opacity: 0.8 },
  { id: 'teal', colour: '#66E7C6', opacity: 0.75 },
];

export const AURORA_LIGHT: readonly AuroraLight[] = [
  { id: 'indigo', colour: '#6F7CE0', opacity: 0.6 },
  { id: 'violet', colour: '#A78BFA', opacity: 0.66 },
  { id: 'teal', colour: '#5FD4C4', opacity: 0.62 },
];
