'use client';

/**
 * An album's picture in a group's strip.
 *
 * A client component for one reason: these URLs are presigned against the
 * album's `cap_epoch` and they expire. A tab left open overnight, or a page
 * restored from the back-forward cache, holds a strip whose covers are gone —
 * and the browser's answer to that is a row of broken-image glyphs on the
 * screen that is supposed to make a group recognisable.
 *
 * The box keeps its size and falls back to the warm bed, which is what "no
 * photograph here" already looks like everywhere else in this product. Not
 * removed: a strip that loses a tile re-flows the two beside it into different
 * widths, so the group appears to have fewer albums than its own count says.
 */

import { useImageFailure } from './useImageFailure';

export function GroupCover({ src, alt = '' }: { src: string; alt?: string }) {
  const { ref, failed, onError } = useImageFailure(src);

  if (failed) return <span className="cover-none" aria-hidden="true" />;

  // eslint-disable-next-line @next/next/no-img-element -- presigned, off-origin
  // and short-lived: the optimiser cannot fetch it and would only add a second
  // address for the same bytes.
  return <img ref={ref} src={src} alt={alt} onError={onError} />;
}
