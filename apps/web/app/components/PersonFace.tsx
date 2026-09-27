'use client';

/**
 * Somebody, small: their picture, or their initial in their own colour.
 *
 * Two callers and one drawing. On a chat row it is the person who spoke last,
 * a circle beside 13px type — a person in a sentence, where the room's own
 * mark beside it is a square, and the two being different shapes is what keeps
 * "which room" from reading as "who spoke". On a recent search it is a rounded
 * square, because there it *is* the object the row is about. The shape is the
 * caller's, through `className`; everything else is here.
 *
 * The letter is not a placeholder for a failure. The letter is not a
 * placeholder for a failure — it is what somebody with no picture sees anyway,
 * which makes it the right thing to fall back *to*. An avatar URL is presigned
 * and lasts an hour, so a tab left open overnight outlives it, and the
 * browser's answer to that is a broken glyph in the middle of a chat list;
 * `useImageFailure` turns that into the letter that was already the other half
 * of this component.
 */

import { useImageFailure } from './useImageFailure';

export function PersonFace({
  name,
  avatarUrl,
  lens,
  className = 'sayer-face',
}: {
  name: string;
  avatarUrl: string | null;
  /** Theirs, by a stable hash of who they are — never of what they are called. */
  lens: { fill: string; ink: string };
  /** What shape it is, which is the only thing the two callers disagree on. */
  className?: string;
}) {
  const { ref, failed, onError } = useImageFailure(avatarUrl ?? '');

  if (!avatarUrl || failed) {
    return (
      <span
        className={className}
        style={{ background: lens.fill, color: lens.ink }}
        aria-hidden="true"
      >
        {name.trim().slice(0, 1).toUpperCase() || '?'}
      </span>
    );
  }

  return (
    // Not next/image: presigned, short lived and off-origin — the optimiser
    // cannot fetch it and would only add a second address for the same bytes.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={avatarUrl}
      alt=""
      onError={onError}
      className={className}
      aria-hidden="true"
    />
  );
}
