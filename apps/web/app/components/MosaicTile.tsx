'use client';

import { useImageFailure } from './useImageFailure';

/**
 * One photo in a card's mosaic, which disappears rather than breaking.
 *
 * An `<img>` whose source fails renders the browser's broken-image glyph —
 * a small grey icon in the middle of the tile, repeated across every tile of
 * every card. That is a worse failure than it sounds: the home screen is the
 * first thing someone opens, and a grid of broken icons reads as "this product
 * lost your photos" rather than "one signed URL expired". The tile's own
 * background is a perfectly good answer, and the card still has its name, its
 * count and its meta line.
 *
 * Disappearing is the right answer *here* specifically because the mosaic is
 * decoration: it says which event this is faster than the name does, and when
 * it cannot, the name is still there doing the same job. The photo grid on the
 * event itself is the opposite case — there the photo is the content, so
 * `PhotoTile` holds the slot open instead.
 *
 * A client component because failure detection needs one, kept to this leaf so
 * the card and the page stay server-rendered.
 */
export function MosaicTile({ src, hidden }: { src: string; hidden?: boolean }) {
  const { ref, failed, onError } = useImageFailure(src);

  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt=""
      loading="lazy"
      aria-hidden={hidden ? 'true' : undefined}
      onError={onError}
    />
  );
}
