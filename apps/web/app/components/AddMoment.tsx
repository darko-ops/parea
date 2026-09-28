'use client';

/**
 * Adding a moment: choose one photo, see it, share it.
 *
 * Its own page rather than a file dialog fired from the `+` sheet. The sheet
 * used to open the browser's picker and upload whatever came back, which left
 * nothing on the screen between choosing and sharing — no look at what was
 * about to go in front of everybody, and no way to change your mind short of
 * finding it on Home and deleting it. Here the frame shows it, pressing the
 * frame chooses again, and Share is the only thing that sends.
 */

import { useEffect, useRef, useState } from 'react';

import { useImageFailure } from './useImageFailure';

export function AddMoment() {
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A file the browser cannot draw — a HEIC in Chrome, say — still has a name
  // and can still be tried; it just cannot be shown here.
  const { ref, failed, onError } = useImageFailure(preview ?? '');

  // The preview is a blob URL, which lives until it is revoked.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function share() {
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/moments', { method: 'POST', body: file }).catch(() => null);
    if (res?.ok) {
      // Home, where it is now the first square in the row.
      location.assign('/events');
      return;
    }
    setBusy(false);
    setError(
      res?.status === 413
        ? 'That photo is too large.'
        : res?.status === 415
          ? 'That photo is in a format we cannot read. Try a JPEG or PNG.'
          : 'Could not share it. Try again.',
    );
  }

  return (
    <main className="photo-page add-moment">
      <header className="photo-head">
        <a href="/events" className="photo-back" aria-label="Cancel, back to Home">
          {'‹'}
        </a>
        <h1 className="add-moment-title">New moment</h1>
        <button
          type="button"
          className="add-moment-share"
          onClick={() => void share()}
          disabled={!file || busy}
        >
          {busy ? 'Sharing…' : 'Share'}
        </button>
      </header>

      <div className="photo-body">
        <div className="photo-main">
          <button
            type="button"
            className="photo-frame add-moment-frame"
            onClick={() => picker.current?.click()}
            disabled={busy}
            aria-label={file ? 'Choose a different photo' : 'Choose a photo'}
          >
            {preview && failed ? (
              <span className="add-moment-empty">
                <span className="add-moment-why">{file?.name}</span>
                <span className="add-moment-small">
                  This browser cannot show a preview of it.
                </span>
              </span>
            ) : preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img ref={ref} src={preview} alt="" onError={onError} />
            ) : (
              <span className="add-moment-empty">
                <span className="add-moment-plus" aria-hidden="true">
                  +
                </span>
                <span className="add-moment-why">Choose a photo</span>
                <span className="add-moment-small">
                  One photo, front and center for your people.
                </span>
              </span>
            )}
          </button>
          <input
            ref={picker}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              e.target.value = '';
              if (chosen) {
                setError(null);
                setFile(chosen);
              }
            }}
          />

          {file && !busy && (
            <button
              type="button"
              className="link-button add-moment-again"
              onClick={() => picker.current?.click()}
            >
              Choose a different photo
            </button>
          )}
          {error && <p className="photo-said">{error}</p>}
        </div>
      </div>
    </main>
  );
}
