/**
 * The lens palette — five fills and the ink that reads on them.
 *
 * The app's `lens.ts`, here: a person with no picture is a letter on a colour
 * chosen by a hash of their id, so the same person is the same colour on a
 * phone and in a browser. Same five, same hash.
 */

export const PERSON_LENSES = [
  { fill: '#ffb3b8', ink: '#7a4f52' },
  { fill: '#9db2f0', ink: '#33477f' },
  { fill: '#a5dcc6', ink: '#3f6b57' },
  { fill: '#f3b584', ink: '#7d5230' },
  { fill: '#c79ad9', ink: '#5f3f70' },
] as const;

export type Lens = (typeof PERSON_LENSES)[number];

/** A stable colour for an id — the same string always lands on the same lens. */
export function lensFor(id: string): Lens {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PERSON_LENSES[hash % PERSON_LENSES.length]!;
}

/** The letter on the lens: theirs, never an id. */
export function initialOf(name: string | null | undefined): string {
  return (name?.trim() || '?').replace(/^@/, '').slice(0, 1).toUpperCase();
}
