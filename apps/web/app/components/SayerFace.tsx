'use client';

/**
 * The person who spoke last, at the head of the line they spoke.
 *
 * Small — 18px, beside 13px type — and a circle, because it is a person in a
 * sentence rather than an object in a column: the room's own mark beside it is
 * the square, and the two being different shapes is what keeps "which room"
 * and "who spoke" from reading as one thing.
 *
 * Their picture, or their initial in their own colour. The letter is not a
 * placeholder for a failure — it is what somebody with no picture sees anyway,
 * which makes it the right thing to fall back *to*. An avatar URL is presigned
 * and lasts an hour, so a tab left open overnight outlives it, and the
 * browser's answer to that is a broken glyph in the middle of a chat list;
 * `useImageFailure` turns that into the letter that was already the other half
 * of this component.
 */

import { useImageFailure } from './useImageFailure';

export function SayerFace({
  name,
  avatarUrl,
  lens,
}: {
  name: string;
  avatarUrl: string | null;
  /** Theirs, by a stable hash of who they are — never of what they are called. */
  lens: { fill: string; ink: string };
}) {
  const { ref, failed, onError } = useImageFailure(avatarUrl ?? '');

  if (!avatarUrl || failed) {
    return (
      <span
        className="sayer-face"
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
      className="sayer-face"
      aria-hidden="true"
    />
  );
}
