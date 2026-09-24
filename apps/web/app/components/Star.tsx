'use client';

/**
 * Keeping a photograph, and letting it go.
 *
 * A shortlist somebody makes of an album of two hundred: the pictures they
 * would actually come back for. The route has existed since the phone got
 * this and the web never drew it — `favourite` has been on every photograph
 * the feed returns the whole time, read by nobody.
 *
 * It is theirs and nobody else's. Nothing here says how many people kept a
 * photograph, and there is no such number to say: `photo_favourite` is a table
 * of its own precisely so that a read of the album cannot become a score. That
 * is the difference between this and a reaction — a reaction is addressed to
 * the room, and this is addressed to nobody.
 *
 * ## Optimistic, and it puts itself back
 *
 * A toggle that waits for a round trip before it changes is a toggle somebody
 * presses twice. So the star fills on the press and the request follows; if
 * the request fails it goes back to what it was, which is the honest answer
 * and the one that lets a second press mean something.
 *
 * `PUT` and `DELETE` rather than a body saying which — the route is idempotent
 * in both directions on purpose, because a toggle retries.
 */

import { useState } from 'react';

import { RailIcon } from './RailIcon';

export function Star({
  photoId,
  /** Whether this reader has kept it, as the feed answered. */
  kept: initial,
  /**
   * Whether keeping is offered at all.
   *
   * False for somebody without an account — a guest actor is a credential in
   * one browser, and a shortlist that cannot survive a new one is a shortlist
   * that quietly empties. The route says the same thing with a 401; the
   * control is simply absent rather than present and refused, because a star
   * that answers "sign in" is a star that was not a star.
   */
  canKeep,
}: {
  photoId: string;
  kept: boolean;
  canKeep: boolean;
}) {
  const [kept, setKept] = useState(initial);
  const [busy, setBusy] = useState(false);

  if (!canKeep) return null;

  const toggle = async () => {
    const want = !kept;
    setKept(want);
    setBusy(true);
    try {
      const res = await fetch(`/api/photos/${photoId}/favourite`, {
        method: want ? 'PUT' : 'DELETE',
      });
      if (!res.ok) throw new Error('refused');
      // The server's own answer, not the guess: one row, and its existence is
      // the whole state.
      setKept(((await res.json()) as { favourite: boolean }).favourite);
    } catch {
      setKept(!want);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`photo-icon photo-star${kept ? ' photo-star-on' : ''}`}
      // What it will do, not what it is: a control's name is the verb. The
      // state is on `aria-pressed`, which is where a screen reader looks for
      // it, so the two are not saying the same thing twice.
      aria-label={kept ? 'Remove from your kept photos' : 'Keep this photo'}
      aria-pressed={kept}
      title={kept ? 'Kept — only you see this' : 'Keep this photo'}
      disabled={busy}
      onClick={() => void toggle()}
    >
      <RailIcon glyph="star" weight={kept ? 2.4 : 1.8} filled={kept} />
    </button>
  );
}
