/**
 * The lens palette — five fills and the ink that reads on them.
 *
 * A group has no cover of its own and a person may have no picture, and the
 * product's answer in both cases is the same: a letter on a colour, chosen by
 * a hash of the id so that the same group or the same person is the same
 * colour on every screen and every device. Never a silhouette, and never a
 * photograph borrowed out of a room.
 *
 * It lives here rather than in `Events.tsx` because four screens draw one of
 * these now — the group tiles, the faces over an event's cover, the avatars in
 * a thread and the tiles in a search result — and a second copy of the palette
 * is how the same group comes to be pink in one list and green in another.
 */

export const GROUP_LENSES = [
  { fill: '#ffb3b8', ink: '#7a4f52' },
  { fill: '#9db2f0', ink: '#33477f' },
  { fill: '#a5dcc6', ink: '#3f6b57' },
  { fill: '#f3b584', ink: '#7d5230' },
  { fill: '#c79ad9', ink: '#5f3f70' },
] as const;

export type Lens = (typeof GROUP_LENSES)[number];

/**
 * A stable colour for an id.
 *
 * Stable is the whole requirement: the same string always lands on the same
 * lens, on every device and across reinstalls, because the colour is how
 * somebody recognises a room they are in at a glance. Not a hash in the
 * cryptographic sense and it does not need to be — it needs to spread five
 * ways and never move.
 */
export function lensFor(id: string): Lens {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return GROUP_LENSES[hash % GROUP_LENSES.length]!;
}

/** The letter on the lens: theirs, never an id and never a silhouette. */
export function initialOf(name: string | null | undefined): string {
  return (name?.trim() || '?').replace(/^@/, '').slice(0, 1).toUpperCase();
}
