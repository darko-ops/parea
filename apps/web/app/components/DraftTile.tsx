'use client';

import type { Draft } from './useDrafts';

/**
 * One of your photographs that is not in the roll yet, seen by you alone.
 *
 * There is no picture: the server never had the file, or has not made one it
 * may show. What it does have — the type, the size, when it was added — is
 * enough to know which photograph it was, and the buttons say what is left to
 * do. File names are not kept, so there is no name to give.
 */
export function DraftTile({
  draft,
  busy,
  onRetry,
  onChooseAgain,
  onRemove,
}: {
  draft: Draft;
  busy: boolean;
  onRetry: () => void;
  onChooseAgain: () => void;
  onRemove: () => void;
}) {
  const stuck = draft.state === 'failed' || draft.state === 'needs_file';
  const label =
    draft.state === 'sending'
      ? 'Uploading'
      : draft.state === 'processing'
        ? 'Processing'
        : draft.state === 'failed'
          ? 'Couldn’t be processed'
          : 'Didn’t upload';
  const type = draft.mime.replace('image/', '').toUpperCase();
  const size = draft.size >= 1_000_000 ? `${(draft.size / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(draft.size / 1000))} KB`;
  const when = new Date(draft.capturedAt ?? draft.addedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return (
    <div
      className={`tile tile-pending tile-draft${stuck ? ' tile-pending-stuck' : ''}`}
      role="group"
      aria-label={`Draft, ${type} ${size} — ${label}`}
    >
      <div className="tile-open tile-draft-body" style={{ aspectRatio: '1 / 0.75' }}>
        <span className="tile-draft-meta">
          {type} · {size}
          <br />
          {draft.capturedAt ? 'Taken' : 'Added'} {when}
        </span>
      </div>
      <span className="tile-pending-state">
        <span className="tile-pending-label">{label}</span>
        {draft.state === 'failed' && (
          <button type="button" className="secondary small" onClick={onRetry} disabled={busy}>
            Try again
          </button>
        )}
        {draft.state === 'needs_file' && (
          <button type="button" className="secondary small" onClick={onChooseAgain} disabled={busy}>
            Choose again
          </button>
        )}
        {stuck && (
          <button type="button" className="secondary small" onClick={onRemove} disabled={busy}>
            Remove
          </button>
        )}
      </span>
      {!stuck && (
        <span className="tile-pending-bar" aria-hidden="true">
          <span className="bar-fill bar-moving" style={{ width: '50%' }} />
        </span>
      )}
    </div>
  );
}
