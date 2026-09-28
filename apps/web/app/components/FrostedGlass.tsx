/**
 * The cover of an album you cannot open: colour behind frosted glass.
 *
 * The lights come from `frostedGlass` in `@parea/cards`, seeded by the album's
 * id, so this and the phone's `FrostedGlass` show the same pane for the same
 * album. See the note there for why the colour is invented rather than the
 * album's own cover blurred.
 *
 * Plain CSS gradients rather than an SVG: each light is an ellipse that fades
 * to nothing, sized in percentages so it fills any card, and the frost is a
 * milky sheen over them in `.album-frost`.
 */

import { frostedGlass } from '@parea/cards';

export function FrostedGlass({ seed }: { seed: string }) {
  const pane = frostedGlass(seed);
  const lights = pane.lights
    .map((light) => {
      const x = `${(light.x * 100).toFixed(1)}%`;
      const y = `${(light.y * 100).toFixed(1)}%`;
      const r = `${(light.r * 100).toFixed(1)}%`;
      return `radial-gradient(ellipse ${r} ${r} at ${x} ${y}, ${light.colour} 0%, ${light.colour}bf 35%, ${light.colour}00 100%)`;
    })
    .reverse()
    .join(', ');
  return <span className="album-frost" style={{ background: `${lights}, ${pane.ground}` }} />;
}
