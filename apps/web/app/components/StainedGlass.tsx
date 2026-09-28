/**
 * The cover of an album you cannot open: a window of coloured glass.
 *
 * The panes come from `stainedGlass` in `@parea/cards`, seeded by the album's
 * id, so this and the phone's `StainedGlass` draw the same window for the
 * same album. See the note there for why it is glass and not a hatched tile.
 *
 * `slice` so the card's edge cuts the rose rather than squashing it. Each pane
 * is filled with its colour's radial gradient — pale at the heart, deep at the
 * lead — which is the light coming through. Gradient ids carry the album id
 * because every window on the page shares one document.
 */

import { GLASS_LEAD, GLASS_TONES, stainedGlass } from '@parea/cards';

export function StainedGlass({ seed }: { seed: string }) {
  const glass = stainedGlass(seed, 160, 160);
  const id = `glass-${seed}`;
  return (
    <svg
      className="album-glass"
      viewBox={`0 0 ${glass.width} ${glass.height}`}
      preserveAspectRatio="xMidYMid slice"
      focusable="false"
    >
      <defs>
        {GLASS_TONES.map((tone, i) => (
          <radialGradient key={i} id={`${id}-${i}`} cx="50%" cy="45%" r="65%">
            <stop offset="0" stopColor={tone.heart} />
            <stop offset="0.55" stopColor={tone.base} />
            <stop offset="1" stopColor={tone.edge} />
          </radialGradient>
        ))}
        {/* Light across the whole window from the upper left. */}
        <linearGradient id={`${id}-light`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={0.22} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.2} />
        </linearGradient>
      </defs>
      <rect width={glass.width} height={glass.height} fill={GLASS_LEAD} />
      {glass.panes.map((pane, i) => (
        <path
          key={i}
          d={pane.d}
          fill={`url(#${id}-${pane.colour})`}
          stroke={GLASS_LEAD}
          strokeWidth={2.4}
          strokeLinejoin="round"
        />
      ))}
      <rect width={glass.width} height={glass.height} fill={`url(#${id}-light)`} />
    </svg>
  );
}
