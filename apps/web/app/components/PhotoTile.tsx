'use client';

import { ago } from '@parea/cards';

import { useImageFailure } from './useImageFailure';

/**
 * One photograph in the gallery, at its own shape, with its chrome on top.
 *
 * It holds its place rather than breaking. The opposite call to `CoverImage`,
 * for the opposite reason: on a card the picture is decoration and vanishing
 * costs nothing. Here the photograph *is* the content, and dropping it would
 * leave the header saying twelve photos above a gallery of eleven — a quiet
 * lie, and one that looks exactly like somebody's photograph having been
 * deleted. So the slot stays, empty and obviously empty, and keeps a 3:2 box
 * so the column does not close up around the gap.
 *
 * It also stays clickable. Every photograph is the route to the reporting and
 * takedown actions on its own page (App Store guideline 1.2 wants those
 * reachable, not merely implemented), and a photograph that will not render
 * for *you* is not one nobody else can see — it may be exactly the one
 * somebody means to report.
 *
 * ## A link, not a button
 *
 * It opened a dialog and it opens a page now, so it is an `<a href>`: the
 * middle-click, the Copy-link, the Back button and the shared URL all come
 * from the element rather than from anything written here. The click handler
 * survives for one job — while the gallery is selecting, a tap ticks the
 * photograph instead of leaving the page.
 *
 * ## The overlay
 *
 * On hover and on focus-within, and it carries what belongs to this one
 * picture: a checkbox to pick it, a download, a menu, and whose it is. Not a
 * count, not a reaction — a photograph of somebody's evening is not a post,
 * and the moment it can be scored the album is a feed.
 *
 * On touch there is no hover, so the first tap shows the chrome and the second
 * opens the picture; that falls out of `:focus-within` rather than a tap
 * handler, because a button takes focus when it is tapped.
 */
export function PhotoTile({
  photo,
  href,
  ratio,
  by,
  picking,
  picked,
  onPick,
}: {
  photo: {
    id: string;
    src: string;
    sources?: { type: string; src: string }[];
    full: string;
    takenAt: string;
  };
  /** This photograph's own page. */
  href: string;
  /** Height as a fraction of width, so the tile reserves its space up front. */
  ratio: number;
  /** Whose photograph it is. Null for somebody who arrived by link unnamed. */
  by: string | null;
  /** The gallery is in selection mode: a tile picks rather than opens. */
  picking: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const { ref, failed, onError } = useImageFailure(photo.src);

  return (
    <div className={`tile${picked ? ' tile-picked' : ''}`}>
      <a
        className="tile-open"
        href={href}
        // The whole tile is one control while picking, so a tap anywhere on it
        // does the thing the mode is for rather than leaving the gallery you
        // were choosing from. `aria-pressed` stays off the link — the tick is
        // the checkbox below, which is a real button and says so.
        onClick={
          picking
            ? (e) => {
                e.preventDefault();
                onPick();
              }
            : undefined
        }
        aria-label={
          picking
            ? picked
              ? 'Selected — press to unselect'
              : 'Select this photo'
            : failed
              ? 'Photo could not be loaded — open for options'
              : 'Open photo'
        }
        style={{ aspectRatio: `1 / ${failed ? 0.667 : ratio}` }}
      >
        {failed ? (
          // Dashed, because dashed already means "nothing here" everywhere
          // else in this design. A plain grey square would read as a very dark
          // photograph.
          <span className="tile-empty">Not available</span>
        ) : (
          /*
            The browser picks the encoding, because it is the only party that
            knows what it can decode. The `<img>` is the JPEG and it is not
            optional — a `<picture>` whose sources a browser all rejects
            renders nothing at all.
          */
          <picture>
            {(photo.sources ?? [])
              .filter((source) => source.type !== 'image/jpeg')
              .map((source) => (
                <source key={source.type} srcSet={source.src} type={source.type} />
              ))}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img ref={ref} src={photo.src} alt="" loading="lazy" onError={onError} />
          </picture>
        )}
      </a>

      <span className="tile-scrim" aria-hidden="true" />

      {/*
        The checkbox is always there rather than only in selection mode: it is
        how the mode *starts*, which was previously only reachable from a menu
        two presses away.
      */}
      <button
        type="button"
        className={`tile-pick${picked ? ' tile-pick-on' : ''}`}
        aria-pressed={picked}
        aria-label={picked ? 'Unselect this photo' : 'Select this photo'}
        onClick={onPick}
      >
        {picked ? '✓' : ''}
      </button>

      <span className="tile-chips">
        <a
          className="tile-chip"
          href={photo.full}
          download
          aria-label="Download this photo"
          onClick={(e) => e.stopPropagation()}
        >
          {'↓'}
        </a>
        <a className="tile-chip" href={href} aria-label="More about this photo">
          ···
        </a>
      </span>

      {by && (
        <span className="tile-by">
          <span className="tile-by-face" aria-hidden="true">
            {by.replace('@', '').slice(0, 1).toUpperCase()}
          </span>
          <span className="tile-by-name">{by}</span>
          <span className="tile-by-when">Added {ago(new Date(photo.takenAt), new Date())}</span>
        </span>
      )}
    </div>
  );
}
