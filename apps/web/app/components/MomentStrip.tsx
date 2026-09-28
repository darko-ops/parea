'use client';

/**
 * A strip of moments: Home's stream, or one person's on their page.
 *
 * One tile per moment, not per person — the photograph itself in a rounded
 * square, the poster's face as a badge on its corner, their first name under
 * it. The ring is the app icon's field while a moment is new to you and a
 * hairline once you have opened it, which is the whole of what the ring
 * means: something here you have not seen.
 *
 * Draws what it is given in the order it is given. The order is the server's
 * — see `orderStream` — and a strip that re-sorted would be a second opinion
 * about what comes first.
 */

import type { WireMoment } from '@/moments';

import { Face } from './Faces';
import { useImageFailure } from './useImageFailure';

export function MomentStrip({
  moments,
  at,
  by,
  label,
}: {
  moments: WireMoment[];
  /** When the server worked this order out. See `seenBefore`. */
  at: string;
  /** One person's page: the viewer then steps through only theirs. */
  by?: string | null;
  label: string;
}) {
  if (moments.length === 0) return null;
  const query = `?${new URLSearchParams({ ...(by ? { by } : {}), at }).toString()}`;

  return (
    <div className="people-row moments-row" role="list" aria-label={label}>
      {moments.map((m) => {
        const who = m.mine ? 'You' : first(m.author.name);
        return (
          <a
            key={m.id}
            role="listitem"
            className={`person moment-tile${m.seen ? ' moment-seen' : ''}`}
            href={`/moments/${m.id}${query}`}
            aria-label={`${m.mine ? 'Your' : `${who}’s`} moment${m.seen ? '' : ', new'}`}
          >
            <span className="moment-ring">
              <Shot src={m.thumb} />
              {!by && (
                <Face
                  src={m.author.avatar}
                  size={24}
                  className="moment-badge"
                  fallback={
                    <span aria-hidden="true">
                      {(m.author.name.replace('@', '').trim() || '?').slice(0, 1).toUpperCase()}
                    </span>
                  }
                />
              )}
            </span>
            {/* A relative time, worked out against a clock the server and
                the browser read a moment apart — so the two may differ by a
                word, which is not a reason to throw the tree away. */}
            <span className="person-name" suppressHydrationWarning>
              {by ? when(m.createdAt) : who}
            </span>
          </a>
        );
      })}
    </div>
  );
}

/**
 * The photograph, or the square's own grey if it will not load — rather than
 * the browser's broken-image glyph in a row of pictures. The tile still opens
 * the moment, where the viewer says in words that it could not be loaded.
 */
function Shot({ src }: { src: string }) {
  const { ref, failed, onError } = useImageFailure(src);
  return (
    <span className="moment-shot">
      {!failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={ref} src={src} alt="" loading="lazy" onError={onError} />
      )}
    </span>
  );
}

function first(name: string): string {
  return name.replace('@', '').trim().split(/\s+/)[0] ?? name;
}

/** On somebody's page every tile is theirs, so the caption is when. */
function when(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
