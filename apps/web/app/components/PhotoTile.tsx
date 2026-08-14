'use client';

import { useImageFailure } from './useImageFailure';

/**
 * One photo in the event's grid, which holds its place rather than breaking.
 *
 * The opposite call to `MosaicTile`, for the opposite reason. On a card the
 * mosaic is decoration and vanishing costs nothing. Here the photo *is* the
 * content, and dropping it would leave the header saying twelve photos above a
 * grid of eleven — a quiet lie about what is in the event, and one that would
 * look exactly like somebody's photo having been deleted. So the slot stays,
 * empty and obviously empty.
 *
 * It also stays a button. Every photo is a route to the reporting and takedown
 * actions in the lightbox (App Store guideline 1.2 wants those reachable, not
 * merely implemented), and a photo that will not render for *you* is not a
 * photo nobody else can see — it may be exactly the one someone means to
 * report. Losing the way in because a thumbnail 403'd would be a worse bug
 * than the glyph this replaces.
 */
export function PhotoTile({
  src,
  sources,
  className,
  selected,
  onOpen,
}: {
  src: string;
  sources?: { type: string; src: string }[];
  /** Extra treatment for the tile itself — the ring on a just-arrived photo. */
  className?: string;
  /**
   * Whether this tile is picked, while the grid is in selection mode.
   * `undefined` means the grid is not selecting, and the tile is a way in to
   * the photo rather than a checkbox — which is what `aria-pressed` would
   * otherwise claim it always was.
   */
  selected?: boolean;
  onOpen: () => void;
}) {
  const { ref, failed, onError } = useImageFailure(src);

  return (
    <button
      className={className ? `tile ${className}` : 'tile'}
      onClick={onOpen}
      aria-pressed={selected}
      aria-label={
        selected !== undefined
          ? selected
            ? 'Selected — press to unselect'
            : 'Select this photo'
          : failed
            ? 'Photo could not be loaded — open for options'
            : 'Open photo'
      }
    >
      {failed ? (
        // Dashed, because dashed already means "nothing here" everywhere else
        // in this design — the empty grid cell, the add-contact circle. A
        // plain grey square would read as a very dark photo.
        <span className="tile-empty">Not available</span>
      ) : (
        /*
          The browser picks the encoding, because it is the only party that
          knows what it can decode. The `<img>` is the JPEG and it is not
          optional — a `<picture>` whose sources a browser all rejects renders
          nothing at all.
        */
        <picture>
          {(sources ?? [])
            .filter((source) => source.type !== 'image/jpeg')
            .map((source) => (
              <source key={source.type} srcSet={source.src} type={source.type} />
            ))}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={ref} src={src} alt="" loading="lazy" onError={onError} />
        </picture>
      )}
    </button>
  );
}
