/**
 * The cover of an album you cannot open: a window of coloured glass.
 *
 * The panes come from `stainedGlass` in `@parea/cards`, seeded by the album's
 * id, so this and the phone's `StainedGlass` draw the same window for the
 * same album. See the note there for why it is glass and not a hatched tile.
 *
 * `slice` so the frame cuts the panes rather than squashing them, and a
 * non-scaling stroke so the leading is one weight at every card size.
 */

import { GLASS_LEAD, stainedGlass } from '@parea/cards';

export function StainedGlass({ seed }: { seed: string }) {
  const glass = stainedGlass(seed, 4, 4);
  const light = `glass-light-${seed}`;
  return (
    <svg
      className="album-glass"
      viewBox={`0 0 ${glass.width} ${glass.height}`}
      preserveAspectRatio="xMidYMid slice"
      focusable="false"
    >
      <defs>
        {/* Light coming through from the upper left, fading by the far corner. */}
        <linearGradient id={light} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity={0.32} />
          <stop offset="0.55" stopColor="#fff" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.18} />
        </linearGradient>
      </defs>
      <rect width={glass.width} height={glass.height} fill={GLASS_LEAD} />
      {glass.panes.map((pane, i) => (
        <polygon
          key={i}
          points={pane.points}
          fill={pane.fill}
          fillOpacity={pane.opacity}
          stroke={GLASS_LEAD}
          strokeWidth={3}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <rect width={glass.width} height={glass.height} fill={`url(#${light})`} />
    </svg>
  );
}
