'use client';

/**
 * The photograph a card is made of.
 *
 * It disappears rather than breaking. An `<img>` whose source fails renders
 * the browser's broken-image glyph — a small grey icon in the middle of every
 * card on the first screen somebody opens, which reads as "this product lost
 * your photos" rather than "one signed URL expired". Removing it leaves the
 * cover's own flat rectangle, and the card still has its name, its people and
 * its date.
 *
 * These URLs expire for ordinary reasons: they are signed against the event's
 * `cap_epoch`, so rotating a link stops every one of them at once, and a tab
 * left open overnight gets there on its own.
 *
 * The `<picture>` is how the browser chooses an encoding, which is the only
 * place that decision can be made correctly — the edge cannot negotiate on
 * `Accept` without one cached response answering for viewers who disagree
 * about AVIF. The `<img>` is the JPEG and is not optional: a `<picture>` whose
 * sources a browser all rejects renders nothing at all.
 */

import { useImageFailure } from './useImageFailure';

export function CoverImage({
  src,
  sources,
}: {
  src: string;
  /** Better encodings, best first. Empty for a cover object, which is a JPEG. */
  sources: { type: string; src: string }[];
}) {
  const { ref, failed, onError } = useImageFailure(src);

  if (failed) return null;

  return (
    <picture>
      {sources
        .filter((source) => source.type !== 'image/jpeg')
        .map((source) => (
          <source key={source.type} srcSet={source.src} type={source.type} />
        ))}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={ref} src={src} alt="" loading="lazy" onError={onError} />
    </picture>
  );
}
