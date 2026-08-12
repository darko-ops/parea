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

import { ACCEPT_ATTRIBUTE, acceptedMime } from '@parea/upload';
import { useCallback, useEffect, useRef, useState } from 'react';

import { SignIn, useSession } from './SignIn';
import { PhotoLightbox } from './PhotoLightbox';
import { PhotoTile } from './PhotoTile';
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
  /** How many of the last selection were not photos. */
  const [skipped, setSkipped] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const session = useSession();

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
      /*
       * `accept` on the input is advice, not a rule — a drop, or "All Files"
       * in the OS dialog, gets past it. The presign endpoint refuses the whole
       * request if any one file is unacceptable, so without this a single
       * video dropped alongside two hundred photos loses all two hundred.
       *
       * An empty `type` is not a rejection. Browsers routinely fail to type a
       * HEIC, and the deriver reads the real format out of the bytes anyway;
       * refusing those would turn "we could not guess" into "you may not
       * upload your iPhone photos".
       */
      const usable = picked.filter(
        (file) => file.type === '' || acceptedMime(file.type) !== null,
      );
      setSkipped(picked.length - usable.length);

      if (usable.length > 0) await uploads.add(usable);
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

      {feed.event.uploadsOpen && session.known && !session.account && (
        // Adding names who added. Shown here rather than behind a link to
        // /account, because being sent away mid-task loses the picker they
        // were about to use — and on a phone, the photos they had chosen.
        <SignIn
          why="Adding photos needs an account. Looking does not — you can carry on browsing without one."
          onSignedIn={session.refresh}
        />
      )}

      {feed.event.uploadsOpen && session.known && session.account && (
        <section className="panel">
          <input
            ref={inputRef}
            type="file"
            multiple
            // The same list the presign endpoint enforces, spelled out rather
            // than an image wildcard. The wildcard is a superset — it offers
            // TIFF, BMP and SVG, which the server then refuses, and one
            // refusal fails the whole batch rather than the one file.
            // Offering only what will be accepted is the difference between a
            // greyed-out file and a failed upload.
            //
            // Written without the literal wildcard token on purpose: it
            // contains a block-comment opener, and a source-scanning test that
            // strips comments will swallow this attribute along with it. That
            // is not hypothetical — see test/accepted-types.test.ts.
            accept={ACCEPT_ATTRIBUTE}
            disabled={uploads.running}
            onChange={(e) => pick(Array.from(e.target.files ?? []))}
          />

          {/*
            Said out loud, because the alternative is a count that silently
            does not match what was chosen. Photos only is a real limitation
            and worth naming as one rather than letting someone conclude the
            upload dropped their video.
          */}
          {skipped > 0 && (
            <p className="muted">
              {skipped === 1 ? '1 file was' : `${skipped} files were`} not added —
              Parea takes photos, not video or other files.
            </p>
          )}

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
          {/*
            Every photo is a way in to the safety actions, which is why the
            tile stays a button even when its thumbnail will not load —
            guideline 1.2 wants reporting reachable, not merely implemented.
          */}
          {feed.photos.map((photo) => (
            <PhotoTile
              key={photo.id}
              src={photo.src}
              sources={photo.sources}
              onOpen={() => setOpenPhoto(photo)}
            />
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
