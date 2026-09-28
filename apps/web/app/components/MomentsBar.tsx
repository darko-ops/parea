/**
 * Moments, on Home: one way in, and nobody's name on it.
 *
 * Home used to draw the stream itself — a tile per moment, each with its
 * author's face — and that read as a row of individual people's stories, the
 * shape moments are not. So Home says only that there are moments and how
 * many are new to you. Who shared what is for once you are inside, where the
 * tiles come back as the viewer's own map of the stream.
 *
 * A dark card, and — only while something is new — the icon's colours
 * showing through it from one corner, as if lit from behind frosted glass,
 * drifting very slowly. The colour says there is activity and nothing about
 * what. All caught up, it goes and the bar is monochrome. The status on the
 * right is the thing to read; the chevron after it only says this opens.
 *
 * Opens on the first moment you have not seen, in the stream's own order —
 * which is where the server already put the new ones.
 */

import type { WireMoment } from '@/moments';

export function MomentsBar({ moments, at }: { moments: WireMoment[]; at: string }) {
  if (moments.length === 0) return null;

  const unseen = moments.filter((m) => !m.seen);
  const start = unseen[0] ?? moments[0]!;
  const href = `/moments/${start.id}?${new URLSearchParams({ at }).toString()}`;
  const fresh = unseen.length > 0;

  return (
    <a
      className={`moments-bar${fresh ? ' moments-bar-new' : ''}`}
      href={href}
      aria-label={fresh ? `Moments, ${unseen.length} new` : 'Moments'}
    >
      {fresh && <span className="moments-bar-bloom" aria-hidden="true" />}
      <span className="moments-bar-name">Moments</span>
      <span className="moments-bar-end">
        {fresh && <span className="moments-bar-count">{unseen.length} new</span>}
        <span className="moments-bar-go" aria-hidden="true">
          ›
        </span>
      </span>
    </a>
  );
}
