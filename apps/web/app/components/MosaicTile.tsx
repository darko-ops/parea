'use client';

import { useEffect, useRef, useState } from 'react';

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
 * It happens for ordinary reasons, not just bugs. Image URLs are signed
 * against the event's `cap_epoch`, so a card rendered from a cached page after
 * someone rotated the link points at URLs the Worker will refuse — the
 * correct outcome, badly drawn.
 *
 * A client component because `onError` needs one, kept to this leaf so the
 * card and the page stay server-rendered.
 */
export function MosaicTile({ src, hidden }: { src: string; hidden?: boolean }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  /*
   * `onError` alone is not enough, which cost a round of testing to find.
   *
   * These images are server-rendered, so the browser starts fetching them
   * while the HTML streams and can finish failing before React hydrates.
   * Hydration does not replay events that already fired, so the handler below
   * never hears about it and the broken glyph stays. Checked here on mount
   * instead: a finished image with no intrinsic width did not decode.
   */
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={src}
      alt=""
      loading="lazy"
      aria-hidden={hidden ? 'true' : undefined}
      onError={() => setFailed(true)}
    />
  );
}
