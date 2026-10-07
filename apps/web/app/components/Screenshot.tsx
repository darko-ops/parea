'use client';

/**
 * A screenshot on a public page, with its description standing in if the file
 * will not load.
 *
 * `/texts` shows a carrier reviewer the real opt-in screen, and a broken image
 * there is a reviewer seeing a broken glyph where the evidence should be. The
 * alt text already says what the picture shows, so when it fails, that is what
 * is drawn in its place.
 */

import { useImageFailure } from './useImageFailure';

export function Screenshot({
  src,
  alt,
  width,
  height,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
}) {
  const { ref, failed, onError } = useImageFailure(src);
  if (failed) return <p className="muted sms-shot-missing">{alt}</p>;
  return <img ref={ref} src={src} alt={alt} width={width} height={height} onError={onError} />;
}
