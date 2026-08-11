'use client';

/**
 * Browse and contribute — screens 2 and 3 of design §3.
 *
 * The upload client is deliberately unglamorous but follows the rules in
 * design §8:
 *   - files stream straight into `fetch` bodies; nothing is read into memory,
 *     because one `arrayBuffer()` over a 200-file selection is a tab crash;
 *   - concurrency 3, because more hurts throughput on cellular;
 *   - progress is per-file, so a partial upload is partial photos, not zero;
 *   - the queue is persisted, so a reload resumes rather than restarts;
 *   - the UI says the tab has to stay open, because on iOS that is true and
 *     pretending otherwise loses people's photos.
 *
 * The mechanism is in `useUploads`; what is left here is the part someone
 * looks at. Still missing: auto-selection, which is native-only and gated on
 * the geotag measurement.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { PhotoLightbox } from './PhotoLightbox';
import { useUploads } from './useUploads';

type Photo = {
  id: string;
  /** Thumbnail, JPEG — the `<img>` fallback every browser can render. */
  src: string;
  /** The same thumbnail in every encoding that exists, best first (§11). */
  sources?: { type: string; src: string }[];
  /** Larger rendition, for the lightbox. */
  full: string;
  takenAt: string;
  mine: boolean;
};

type Feed = {
  event: {
    id: string;
    name: string;
    uploadsOpen: boolean;
    canAdminister: boolean;
    groupId: string | null;
    groupName: string | null;
  };
  contributors: number;
  count: number;
  photos: Photo[];
};

export function EventView({ eventId, initial }: { eventId: string; initial: Feed }) {
  const [feed, setFeed] = useState<Feed>(initial);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [openPhoto, setOpenPhoto] = useState<Photo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/photos`);
    if (res.ok) setFeed(await res.json());
  }, [eventId]);

  const uploads = useUploads(eventId, refresh);

  // Photos appear as ingest finishes, which is seconds behind the upload.
  useEffect(() => {
    if (!uploads.running) return;
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [uploads.running, refresh]);

  const pick = useCallback(
    async (picked: File[]) => {
      await uploads.add(picked);
      if (inputRef.current) inputRef.current.value = '';
    },
    [uploads],
  );

  const download = useCallback(
    async (format: 'original' | 'jpeg') => {
      setDownloading(true);
      setDownloadError(null);
      try {
        const res = await fetch(`/api/events/${eventId}/download`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ format }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(explainDownloadFailure(body));
        }
        const { url } = (await res.json()) as { url: string };
        // A plain navigation, so the browser or OS owns the download: real
        // progress, a real filename, and no tab that has to stay open.
        window.location.href = url;
      } catch (err) {
        setDownloadError(err instanceof Error ? err.message : String(err));
      } finally {
        setDownloading(false);
      }
    },
    [eventId],
  );

  return (
    <main className="wrap">
      <header>
        <h1>{feed.event.name}</h1>
        <p className="muted">
          {feed.count} {feed.count === 1 ? 'photo' : 'photos'} from {feed.contributors}{' '}
          {feed.contributors === 1 ? 'person' : 'people'}
          {feed.event.groupId && (
            <>
              {' · '}
              <a href={`/group/${feed.event.groupId}`}>{feed.event.groupName}</a>
            </>
          )}
          {feed.event.canAdminister && (
            <>
              {' · '}
              <a href={`/event/${eventId}/manage`}>Manage</a>
            </>
          )}
        </p>
      </header>

      {feed.event.uploadsOpen && (
        <section className="panel">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            disabled={uploads.running}
            onChange={(e) => pick(Array.from(e.target.files ?? []))}
          />

          {uploads.resumed && uploads.items.length > 0 && (
            <p className="muted">
              Picking up where the last tab left off.{' '}
              <button className="link" onClick={() => uploads.discard()}>
                Start over instead
              </button>
            </p>
          )}

          {uploads.running && (
            <p className="muted">
              {uploads.remaining} of {uploads.items.length} to go — keep this tab
              open until it finishes. Uploads do not continue in the background,
              but if this tab reloads it will carry on from here.
            </p>
          )}

          {!uploads.running && uploads.done > 0 && (
            <p className="muted">
              Added {uploads.done} of {uploads.items.length}
              {uploads.failed > 0 && ` · ${uploads.failed} failed`}
            </p>
          )}

          {/*
            Not an error message, a request. These photos were queued by a tab
            that is gone, and the browser will not hand over their contents any
            more — nothing retries into existence, so the only thing that helps
            is choosing them again. Saying "failed" here would send someone to
            a button that cannot work.
          */}
          {uploads.stale.length > 0 && (
            <p className="muted">
              {uploads.stale.length}{' '}
              {uploads.stale.length === 1 ? 'photo' : 'photos'} could not be read
              after the reload — your browser only lends a file to the tab that
              picked it. Choose{' '}
              {uploads.stale.length === 1 ? 'it' : 'them'} again to finish:{' '}
              {uploads.stale.map((item) => item.name).join(', ')}
            </p>
          )}
        </section>
      )}

      {feed.photos.length > 0 && (
        <section className="panel">
          {/*
            Both offered, side by side, rather than one button that silently
            picks — design §7.7. Originals are the promise the product makes,
            and converting behind someone's back would break it; but a folder
            of iPhone HEICs is unopenable on plenty of Android phones and
            Windows machines, and finding that out after the download is worse
            than being asked.
          */}
          <div className="row">
            <button onClick={() => download('original')} disabled={downloading}>
              {downloading ? 'Preparing…' : `Download all ${feed.count} at full quality`}
            </button>
            <button
              className="secondary"
              onClick={() => download('jpeg')}
              disabled={downloading}
            >
              Download as JPEG
            </button>
          </div>
          <p className="muted">
            Originals are exactly what the cameras produced. JPEG is smaller and
            opens anywhere — worth choosing if any of these came from an iPhone
            and you are not on one.
          </p>
          {downloadError && <p className="muted">{downloadError}</p>}
        </section>
      )}

      {feed.photos.length === 0 ? (
        <p className="muted empty">
          Nothing here yet. Add yours and everyone else will see there is
          something to add to.
        </p>
      ) : (
        <div className="grid">
          {feed.photos.map((photo) => (
            <button
              key={photo.id}
              className="tile"
              onClick={() => setOpenPhoto(photo)}
              // Every photo is a way in to the safety actions. Guideline 1.2
              // wants reporting reachable, not merely implemented.
              aria-label="Open photo"
            >
              {/*
                The browser picks the encoding, because it is the only party
                that knows what it can decode. The `<img>` is the JPEG and it
                is not optional — a `<picture>` whose sources a browser all
                rejects renders nothing at all.
              */}
              <picture>
                {(photo.sources ?? [])
                  .filter((source) => source.type !== 'image/jpeg')
                  .map((source) => (
                    <source key={source.type} srcSet={source.src} type={source.type} />
                  ))}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.src} alt="" loading="lazy" />
              </picture>
            </button>
          ))}
        </div>
      )}

      <p className="muted footer">
        <a href="/events">Your events</a> · <a href="/account">Your account</a> ·{' '}
        <a href="/safety">Safety, reporting and contact</a> ·{' '}
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
      </p>

      {openPhoto && (
        <PhotoLightbox
          photo={openPhoto}
          onClose={() => setOpenPhoto(null)}
          onChanged={refresh}
        />
      )}
    </main>
  );
}

/**
 * The two 409s mean different things and want different next steps.
 *
 * `not_ready` resolves by waiting. `jpeg_unavailable` does not — those photos
 * were derived before the archive path needed their sizes, and nothing gets
 * regenerated by asking again — so the useful answer is the other button.
 */
function explainDownloadFailure(body: { error?: string; pending?: number; missing?: number }) {
  switch (body.error) {
    case 'not_ready':
      return `${body.pending} photo(s) are still being processed. Try again in a moment.`;
    case 'jpeg_unavailable':
      return `${body.missing} photo(s) have no JPEG version. Download the originals instead.`;
    default:
      return 'Could not start the download.';
  }
}
