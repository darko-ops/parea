/**
 * The window over an album somebody cannot open.
 *
 * A private album on another person's page has no photograph to show, and the
 * dashed, hatched tile it wore said "shut" by saying "empty". A window of
 * coloured glass says the other half: there is something on the far side of
 * this, lit, and you are seeing its colour rather than its contents.
 *
 * ## Why a rose and not a scatter of shards
 *
 * The first pass cut the frame into jittered triangles and quads in random
 * colours, and on a screen it read as a mosaic — flat tiles, nothing lit. What
 * makes glass read as glass is the things a mosaic never has: curves in the
 * leading, symmetry around a centre, and light coming *through* each pane. So
 * this is a rose window — spokes, a ring of wedges, round foils, petals and a
 * boss in the middle, where the padlock sits — and every pane is filled with
 * a glow that is bright at its heart and deepens to its lead.
 *
 * The panes are drawn back to front and allowed to overlap: each layer's lead
 * is the edge the next layer is cut against, which is how the curves meet
 * without any geometry computing where they cross.
 *
 * Seeded by the album's id, for the reason `lensFor` is: the same album is the
 * same window on every screen, on both clients, on every visit. A window that
 * rearranged itself on each render would be decoration; one that stays put is
 * how somebody recognises an album they have already asked to join.
 *
 * Geometry only — no SVG elements, no React. The web draws it as an inline
 * `<svg>` and the phone through `react-native-svg`, and both read the same
 * panes and the same tones.
 */

/** Jewel tones: saturated enough to read as lit glass, dark enough to hold white. */
export const GLASS_COLOURS = [
  '#c8283f', // ruby
  '#e8792b', // amber
  '#f2c230', // gold
  '#2f9e5a', // emerald
  '#17978e', // teal
  '#2c6fc9', // cobalt
  '#3b33a8', // sapphire
  '#7e3fa8', // violet
  '#d24d8a', // rose
] as const;

/** The leading between panes. Near-black with a little violet, as lead reads. */
export const GLASS_LEAD = '#1c1822';

function mix(hex: string, toward: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (n >> shift) & 0xff;
    return Math.round(c + (toward - c) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/**
 * Each colour as light passes through it: a pale heart where the light is
 * strongest, the colour itself, and a deep edge where the glass meets lead.
 * Drawn as a radial gradient per pane, which is what makes it glow.
 */
export const GLASS_TONES = GLASS_COLOURS.map((base) => ({
  heart: mix(base, 255, 0.45),
  base,
  edge: mix(base, 0, 0.35),
}));

export interface GlassPane {
  /** An SVG path in the window's own units. */
  d: string;
  /** An index into `GLASS_COLOURS` / `GLASS_TONES`. */
  colour: number;
}

export interface GlassWindow {
  width: number;
  height: number;
  /** Back to front: later panes are laid over earlier ones. */
  panes: GlassPane[];
}

/** mulberry32: small, fast, and the same sequence on every JavaScript engine. */
function random(seed: string): () => number {
  // FNV-1a and a murmur finaliser, so ids that differ by a character start
  // far apart — a plain ×31 hash left the first draws of similar ids alike.
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

const f = (n: number) => n.toFixed(2);

/**
 * A rose window centred in a `width` × `height` frame.
 *
 * Callers pick the frame to match the tile's shape so the rose is cut by the
 * edge the way a real window's tracery is — the corners are filled by the
 * spokes that run out beyond the rose.
 */
export function stainedGlass(seed: string, width = 160, height = 120): GlassWindow {
  const next = random(seed);
  const cx = width / 2;
  const cy = height / 2;
  const m = Math.min(width, height) / 2;
  const far = Math.hypot(width, height);

  const at = (angle: number, r: number) =>
    `${f(cx + Math.cos(angle) * r)} ${f(cy + Math.sin(angle) * r)}`;

  // Distinct colours for each layer, so neighbouring rings never merge.
  const order = [...GLASS_COLOURS.keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const [fieldA, fieldB, wedgeA, wedgeB, foil, petalA, petalB, boss] = order as number[];

  const n = [6, 8, 8, 10, 12][Math.floor(next() * 5)]!;
  const step = (Math.PI * 2) / n;
  const turn = -Math.PI / 2 + (next() < 0.5 ? 0 : step / 2);
  const foils = next() < 0.75;
  const petalWidth = 0.75 + next() * 0.3;

  const panes: GlassPane[] = [];

  // The field: spokes running from the centre out past the frame.
  for (let i = 0; i < n * 2; i++) {
    const a1 = turn + (i * step) / 2;
    const a2 = a1 + step / 2;
    panes.push({
      d: `M ${f(cx)} ${f(cy)} L ${at(a1, far)} L ${at(a2, far)} Z`,
      colour: i % 2 ? fieldB! : fieldA!,
    });
  }

  // The rose: a disc of wedges, bounded by one circle.
  const rose = m * 0.96;
  for (let i = 0; i < n; i++) {
    const a1 = turn + i * step;
    const a2 = a1 + step;
    panes.push({
      d: `M ${f(cx)} ${f(cy)} L ${at(a1, rose)} A ${f(rose)} ${f(rose)} 0 0 1 ${at(a2, rose)} Z`,
      colour: i % 2 ? wedgeB! : wedgeA!,
    });
  }

  // Foils: a ring of round panes between the petals' tips.
  if (foils) {
    const ring = m * 0.72;
    const r = Math.min(m * 0.2, ring * Math.sin(step / 2) * 0.85);
    for (let i = 0; i < n; i++) {
      const a = turn + (i + 0.5) * step;
      const x = cx + Math.cos(a) * ring;
      const y = cy + Math.sin(a) * ring;
      panes.push({
        d: `M ${f(x - r)} ${f(y)} A ${f(r)} ${f(r)} 0 1 0 ${f(x + r)} ${f(y)} A ${f(r)} ${f(r)} 0 1 0 ${f(x - r)} ${f(y)} Z`,
        colour: foil!,
      });
    }
  }

  // Petals: pointed, curved on both sides, one on each spoke.
  const tip = m * (foils ? 0.64 : 0.86);
  const bulge = tip * Math.tan(step / 2) * petalWidth;
  for (let i = 0; i < n; i++) {
    const a = turn + i * step;
    const mid = tip * 0.5;
    const px = cx + Math.cos(a) * mid;
    const py = cy + Math.sin(a) * mid;
    const ox = -Math.sin(a) * bulge;
    const oy = Math.cos(a) * bulge;
    panes.push({
      d: `M ${f(cx)} ${f(cy)} Q ${f(px + ox)} ${f(py + oy)} ${at(a, tip)} Q ${f(px - ox)} ${f(py - oy)} ${f(cx)} ${f(cy)} Z`,
      colour: i % 2 ? petalB! : petalA!,
    });
  }

  // The boss, which the padlock sits on.
  const b = m * 0.2;
  panes.push({
    d: `M ${f(cx - b)} ${f(cy)} A ${f(b)} ${f(b)} 0 1 0 ${f(cx + b)} ${f(cy)} A ${f(b)} ${f(b)} 0 1 0 ${f(cx - b)} ${f(cy)} Z`,
    colour: boss!,
  });

  return { width, height, panes };
}
