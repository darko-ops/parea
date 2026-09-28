/**
 * The window over an album somebody cannot open.
 *
 * A private album on another person's page has no photograph to show, and the
 * dashed, hatched tile it wore said "shut" by saying "empty". A window of
 * coloured glass says the other half: there is something on the far side of
 * this, lit, and you are seeing its colour rather than its contents.
 *
 * Seeded by the album's id, for the reason `lensFor` is: the same album is the
 * same window on every screen, on both clients, on every visit. A window that
 * rearranged itself on each render would be decoration; one that stays put is
 * how somebody recognises an album they have already asked to join.
 *
 * Geometry only — no SVG, no React. The web draws it as an inline `<svg>` and
 * the phone through `react-native-svg`, and both read the same panes.
 */

/** Jewel tones: saturated enough to read as lit glass, dark enough to hold white. */
export const GLASS_COLOURS = [
  '#c8283f', // ruby
  '#e8792b', // amber
  '#f2c230', // gold
  '#2f9e5a', // emerald
  '#17978e', // teal
  '#2c6fc9', // cobalt
  '#4b3fb5', // sapphire
  '#7e3fa8', // violet
  '#d24d8a', // rose
] as const;

/** The leading between panes. Near-black with a little violet, as lead reads. */
export const GLASS_LEAD = '#1c1822';

export interface GlassPane {
  /** An SVG `points` string in the window's own units. */
  points: string;
  fill: string;
  /** Glass is not uniform; a little variation is what stops it reading as a chart. */
  opacity: number;
}

export interface GlassWindow {
  width: number;
  height: number;
  panes: GlassPane[];
}

/** The cell edge in window units; callers size the window in cells. */
const CELL = 24;

/** mulberry32: small, fast, and the same sequence on every JavaScript engine. */
function random(seed: string): () => number {
  let a = 0;
  for (const ch of seed) a = (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A window of `cols` × `rows` cells, each cut into one or two panes.
 *
 * A jittered grid rather than a true Voronoi: the vertices are shared between
 * neighbouring cells, so the leading is continuous without computing one, and
 * the frame's own edge stays straight because only interior points move.
 */
export function stainedGlass(seed: string, cols = 4, rows = 3): GlassWindow {
  const next = random(seed);
  const width = cols * CELL;
  const height = rows * CELL;

  const at: [number, number][][] = [];
  for (let y = 0; y <= rows; y++) {
    const row: [number, number][] = [];
    for (let x = 0; x <= cols; x++) {
      const inside = x > 0 && x < cols && y > 0 && y < rows;
      const jx = inside ? (next() - 0.5) * CELL * 0.7 : 0;
      const jy = inside ? (next() - 0.5) * CELL * 0.7 : 0;
      // Edge points slide along their edge so the border panes vary too.
      const ex = !inside && (y === 0 || y === rows) && x > 0 && x < cols
        ? (next() - 0.5) * CELL * 0.6
        : 0;
      const ey = !inside && (x === 0 || x === cols) && y > 0 && y < rows
        ? (next() - 0.5) * CELL * 0.6
        : 0;
      row.push([x * CELL + jx + ex, y * CELL + jy + ey]);
    }
    at.push(row);
  }

  const panes: GlassPane[] = [];
  const colourAbove: number[] = new Array(cols).fill(-1);
  let last = -1;
  const pick = (avoid: number[]) => {
    let i = Math.floor(next() * GLASS_COLOURS.length);
    // A pane the colour of its neighbour is one pane with a line through it.
    for (let tries = 0; avoid.includes(i) && tries < 8; tries++) {
      i = Math.floor(next() * GLASS_COLOURS.length);
    }
    return i;
  };
  const pane = (pts: [number, number][], colour: number) => {
    panes.push({
      points: pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' '),
      fill: GLASS_COLOURS[colour]!,
      opacity: 0.82 + next() * 0.18,
    });
  };

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = at[y]![x]!;
      const b = at[y]![x + 1]!;
      const c = at[y + 1]![x + 1]!;
      const d = at[y + 1]![x]!;
      const roll = next();
      if (roll < 0.3) {
        const i = pick([last, colourAbove[x]!]);
        pane([a, b, c, d], i);
        last = colourAbove[x] = i;
      } else {
        // One diagonal or the other, so the cuts do not all run the same way.
        const [one, two] = roll < 0.65 ? [[a, b, c], [a, c, d]] : [[a, b, d], [b, c, d]];
        const i = pick([last, colourAbove[x]!]);
        const j = pick([i, last]);
        pane(one as [number, number][], i);
        pane(two as [number, number][], j);
        last = j;
        colourAbove[x] = j;
      }
    }
  }

  return { width, height, panes };
}
