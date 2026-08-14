'use client';

/**
 * A single photo, and everything you can do about it — docs/design.md §13.
 *
 * The safety endpoints have existed for a while; this is what makes them
 * reachable, which is the part App Store Guideline 1.2 actually requires. An
 * API nobody can call is not a reporting mechanism.
 *
 * Which actions appear depends on whose photo it is, and the difference
 * matters. Your own upload gets an unceremonious "Remove" — no confirmation
 * beyond the obvious, no reason asked, because taking your own photo back is
 * not a moderation event. Someone else's gets the three things you might
 * legitimately want: ask for it down because you are in it, report it because
 * it should not exist, or block the person so you stop seeing their uploads.
 */

import { useCallback, useState } from 'react';

import type { Message } from '@/messages';

import { PhotoComments } from './PhotoComments';
import { useImageFailure } from './useImageFailure';

export type LightboxPhoto = {
  id: string;
  full: string;
  mine: boolean;
};

type Action = 'removal-request' | 'report' | 'block';

const DONE: Record<Action, string> = {
  'removal-request':
    'Asked the host to take it down. If they have not answered in 48 hours it is hidden automatically.',
  report: 'Reported. Someone will look at it.',
  block:
    'Blocked. You will not see their photos any more. They are not told, and nobody else is affected.',
};

export function PhotoLightbox({
  photo,
  eventId,
  messages,
  canPost,
  onClose,
  onChanged,
}: {
  photo: LightboxPhoto;
  eventId: string;
  /** The whole thread. The comments on this photo are the ones anchored to it. */
  messages: Message[];
  canPost: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function act(action: Action) {
    setBusy(true);
    setError(null);
    try {
      const url =
        action === 'block' ? '/api/blocks' : `/api/photos/${photo.id}/${action}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'block' ? { photoId: photo.id } : {}),
      });
      if (!res.ok) throw new Error('That did not work. Try again.');
      setDone(DONE[action]);
      // A block changes what the grid should contain, so refresh behind us.
      if (action === 'block') onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not remove it. Try again.');
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lightbox-inner">
        <LightboxImage src={photo.full} />

        {/*
          Between the photograph and the safety actions, which is the order
          these things matter in: the picture, then what people said about it,
          then what to do if it should not be here. Below the actions it would
          push reporting off the bottom of a long thread, and guideline 1.2
          wants that reachable rather than merely present.
        */}
        <PhotoComments
          eventId={eventId}
          photoId={photo.id}
          messages={messages}
          canPost={canPost}
          onChanged={onChanged}
        />

        <div className="lightbox-actions">
          {done ? (
            <p className="muted">{done}</p>
          ) : photo.mine ? (
            <>
              <button onClick={remove} disabled={busy}>
                {busy ? 'Removing…' : 'Remove my photo'}
              </button>
              <span className="muted">
                Yours. Nobody has to approve this.
              </span>
            </>
          ) : (
            <>
              <button className="secondary" onClick={() => act('removal-request')} disabled={busy}>
                That&rsquo;s me — take it down
              </button>
              <button className="secondary" onClick={() => act('report')} disabled={busy}>
                Report
              </button>
              {confirming ? (
                <button onClick={() => act('block')} disabled={busy}>
                  Block — hide all their photos
                </button>
              ) : (
                <button className="secondary" onClick={() => setConfirming(true)} disabled={busy}>
                  Block this person
                </button>
              )}
            </>
          )}
          {error && <p className="muted">{error}</p>}
        </div>

        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * The photo itself, or an honest statement that it would not load.
 *
 * A broken glyph here would be the worst place for one: this dialog is where
 * someone reports a photo or asks for it to be taken down, and those actions
 * are underneath. They stay usable — you do not need to see a photo to know it
 * is of you, and the grid tile that leads here deliberately stays clickable
 * for exactly that reason — so the image failing must not read as the dialog
 * being broken.
 *
 * Said out loud rather than left blank, because unlike a card mosaic there is
 * only one image here and its absence would otherwise be unexplained.
 */
function LightboxImage({ src }: { src: string }) {
  const { ref, failed, onError } = useImageFailure(src);

  if (failed) {
    return (
      <p className="muted lightbox-empty">
        This photo could not be loaded. The actions below still work.
      </p>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img ref={ref} src={src} alt="" onError={onError} />
  );
}
