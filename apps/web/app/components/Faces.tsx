'use client';

/**
 * Who is in an album: their pictures, and the mark's lenses for everyone else.
 *
 * This replaces a row of coloured circles that stood for people without saying
 * anything about them. The argument for those was recorded in `Lenses` and is
 * still half true — most people here are somebody a host sent a link to, and
 * most of them have no picture. What changed is that the ones who *do* have a
 * picture are the ones you recognise an album by, and drawing a generic circle
 * for them threw that away to keep the row uniform.
 *
 * So it is a mixed row on purpose: a photograph where there is one, a lens
 * where there is not. Not a grey letter-circle in the gap — a row of initials
 * is a list of names, which is a much louder claim about who was somewhere
 * than three overlapping colours.
 *
 * ## Every one of these can fail, and they fail together
 *
 * An avatar URL is presigned and lasts an hour. A tab left open overnight, or
 * a page restored from the back-forward cache, holds a card whose faces have
 * all expired at once — and the browser's answer to that is the broken-image
 * glyph, in every circle, on the first screen somebody sees. `useImageFailure`
 * is what turns that into a lens: the same circle, the same size, no gap in
 * the row and nothing to explain.
 */

import { useImageFailure } from './useImageFailure';

/** Mark order, from `Mark.tsx`. The fourth is one of the overlap colours. */
const LENSES = ['#ffb3b8', '#9db2f0', '#a5dcc6', '#f3b584'];

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
