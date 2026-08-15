'use client';

/**
 * Somebody's picture, in a circle, with something to fall back to.
 *
 * There was a row of these for an album's members and there is not any more —
 * the card draws the creator and nothing else. What is left is the one circle
 * and the reason it is a component at all:
 *
 * An avatar URL is presigned and lasts an hour. A tab left open overnight, or
 * a page restored from the back-forward cache, holds a card whose picture has
 * expired — and the browser's answer to that is the broken-image glyph, on the
 * first screen somebody sees. `useImageFailure` turns it into the same circle
 * with a letter in it: no gap, nothing to explain.
 */

import { useImageFailure } from './useImageFailure';

/**
 * One circle: a picture, or whatever stands in for it.
 *
 * `fallback` is a node rather than a colour because the two callers want
 * different things in the gap — a lens in the members' row, a letter in the
 * creator's circle beside the title.
 */
export function Face({
  src,
  size,
  fallback,
  className,
}: {
  src: string | null;
  size: number;
  fallback: React.ReactNode;
  className?: string;
}) {
  const { ref, failed, onError } = useImageFailure(src ?? '');

  if (!src || failed) {
    return (
      <span className={className} style={{ width: size, height: size }}>
        {fallback}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- presigned, short
    // lived and off-origin: the optimiser cannot fetch it and would only add a
    // second address for the same bytes.
    <img
      ref={ref}
      src={src}
      alt=""
      onError={onError}
      className={className}
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  );
}

/** Mark order, from `Mark.tsx`. The fourth is one of the overlap colours. */
const LENSES = ['#ffb3b8', '#9db2f0', '#a5dcc6', '#f3b584'];

/**
 * A row of them, overlapped — the people in an album.
 *
 * A photograph where somebody has one, a lens where they do not. Not a grey
 * letter-circle in the gap: a row of initials is a list of names, which is a
 * much louder claim about who was somewhere than three overlapping colours.
 *
 * The slots keep their order and their count, so somebody who has a picture
 * does not move along the row as other people join.
 */
export function Faces({
  /** One entry per person, in order. `null` means no picture. */
  avatars,
  size = 18,
}: {
  avatars: (string | null)[];
  size?: number;
}) {
  if (avatars.length === 0) return null;

  return (
    <span className="faces" aria-hidden="true">
      {avatars.map((src, i) => (
        <Face
          key={i}
          src={src}
          size={size}
          fallback={
            <span
              className="face-lens"
              style={{
                width: size,
                height: size,
                // The palette in order, so two people without pictures are two
                // different colours rather than the same one twice.
                background: LENSES[i % LENSES.length],
              }}
            />
          }
        />
      ))}
    </span>
  );
}
