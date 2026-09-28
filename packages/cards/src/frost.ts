/**
 * The frosted pane over an album somebody cannot open.
 *
 * A private album on another person's page has no photograph to show, and the
 * dashed, hatched tile it wore said "shut" by saying "empty". Frosted glass
 * says the other half: there is something lit on the far side of this, and
 * you can see its colour but nothing of it.
 *
 * ## Why not the album's own cover, blurred
 *
 * Because the server does not send one. `albumsBy` gives a locked album a name
 * and nothing else, and a blurred photograph is still a photograph — colours,
 * a face-shaped patch, a sky. So the colour behind the frost is invented: a
 * few soft lights, seeded by the album's id.
 *
 * ## Why not stained glass
 *
 * It was, twice — shards, then a rose window — and both read as a church
 * window: an object with a design of its own, drawn over the album. Frost has
 * no design. It is only light coming through something you cannot see into,
 * which is what a private album is.
 *
 * Seeded for the reason `lensFor` is: the same album is the same pane on every
 * screen, on both clients, on every visit — how somebody recognises an album
 * they have already asked to join.
 *
 * Numbers only, no SVG and no React. The web and the phone each draw the
 * lights as radial gradients that fade to nothing, and both read these.
 */

/** Bright enough to glow through frost, varied enough that two panes differ. */
export const FROST_COLOURS = [
  '#ff5f6d', // coral
  '#ffa94d', // apricot
  '#ffd43b', // sun
  '#51cf66', // leaf
  '#22b8cf', // lagoon
  '#4c6ef5', // cobalt
  '#845ef7', // violet
  '#f06595', // pink
] as const;

export interface FrostLight {
  /** Centre, as fractions of the pane's width and height. */
  x: number;
  y: number;
  /** Radius as a fraction of the pane's longer side. */
  r: number;
  colour: string;
}

export interface FrostedPane {
  /** The colour the lights sit on, so no corner is ever empty. */
  ground: string;
  /** Back to front. */
  lights: FrostLight[];
}

/** FNV-1a and a murmur finaliser into mulberry32: similar ids start far apart. */
function random(seed: string): () => number {
  let a = 0x811c9dc5;
  for (const ch of seed) a = Math.imul(a ^ ch.charCodeAt(0), 0x01000193);
  a ^= a >>> 16;
  a = Math.imul(a, 0x85ebca6b);
  a ^= a >>> 13;
  a = Math.imul(a, 0xc2b2ae35);
  a = (a ^ (a >>> 16)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function frostedGlass(seed: string): FrostedPane {
  const next = random(seed);
  const order = [...FROST_COLOURS];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const count = 3 + Math.floor(next() * 2);
  const lights: FrostLight[] = [];
  for (let i = 0; i < count; i++) {
    // One light per quadrant-ish, so the colour is spread rather than pooled.
    const qx = i % 2;
    const qy = Math.floor(i / 2) % 2;
    lights.push({
      x: 0.1 + qx * 0.5 + next() * 0.4,
      y: 0.1 + qy * 0.5 + next() * 0.4,
      r: 0.55 + next() * 0.3,
      colour: order[i + 1]!,
    });
  }
  return { ground: order[0]!, lights };
}
