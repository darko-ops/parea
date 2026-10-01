'use client';

import type { UploadPreview } from './uploadPreviews';
import { useImageFailure } from './useImageFailure';

/**
 * A photo on its way, in the gallery before it is in the album.
 *
 * Not a link and not pickable: there is no photograph page yet, nothing on the
 * server to download, and a tile that opened onto "not found" would be worse
 * than one that does nothing. Dimmed, with what it is waiting on across the
 * foot — and, where it is waiting on somebody, the button that unsticks it.
 *
 * The picture is a small blob made in this tab, never the original — see
 * `thumbnails.ts`. Without one (HEIC in Chrome, a handle gone after a refresh)
 * the tile is plain, at the same size.
 */
export function UploadTile({
  upload,
  ratio,
  progress,
  onRetry,
  onPickAgain,
}: {
  upload: UploadPreview;
  /** Height as a fraction of width, as `Masonry` laid it out. */
  ratio: number;
  /** In the panel's thirds: the queue knows steps, not bytes. */
  progress: number;
  onRetry?: () => void;
  onPickAgain?: () => void;
}) {
  const { ref, failed, onError } = useImageFailure(upload.src ?? '');
  const stuck = upload.state === 'failed' || upload.state === 'stale';
  const label =
    upload.state === 'uploading'
      ? 'Uploading'
      : upload.state === 'processing'
        ? 'Processing'
        : upload.state === 'failed'
          ? 'Didn’t upload'
          : 'Can’t be read';

  return (
    <div
      className={`tile tile-pending${stuck ? ' tile-pending-stuck' : ''}`}
      role="group"
      aria-label={`${upload.name} — ${label}`}
    >
      <div className="tile-open" style={{ aspectRatio: `1 / ${ratio}` }}>
        {upload.src && !failed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img ref={ref} src={upload.src} alt="" onError={onError} />
        )}
      </div>
      <span className="tile-pending-state">
        <span className="tile-pending-label">{label}</span>
        {upload.state === 'failed' && onRetry && (
          <button type="button" className="secondary small" onClick={onRetry}>
            Retry
          </button>
        )}
        {upload.state === 'stale' && onPickAgain && (
          <button type="button" className="secondary small" onClick={onPickAgain}>
            Pick again
          </button>
        )}
      </span>
      {!stuck && (
        <span className="tile-pending-bar" aria-hidden="true">
          <span className="bar-fill bar-moving" style={{ width: `${Math.max(8, progress)}%` }} />
        </span>
      )}
    </div>
  );
}
