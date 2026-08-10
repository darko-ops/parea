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
 *   - the UI says the tab has to stay open, because on iOS that is true and
 *     pretending otherwise loses people's photos.
 *
 * Not yet here, and both are real gaps rather than polish: the IndexedDB queue
 * that survives a reload, and auto-selection (native only, and gated on the
 * geotag measurement).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const CONCURRENCY = 3;

type Photo = {
  id: string;
  src: string;
  takenAt: string;
  mine: boolean;
};

type Feed = {
  event: { id: string; name: string; uploadsOpen: boolean };
  contributors: number;
  count: number;
  photos: Photo[];
};

type Job = { file: File; status: 'waiting' | 'sending' | 'done' | 'failed' };

export function EventView({ eventId, initial }: { eventId: string; initial: Feed }) {
  const [feed, setFeed] = useState<Feed>(initial);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/photos`);
    if (res.ok) setFeed(await res.json());
  }, [eventId]);

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(refresh, 4000);
    return () => clearInterval(timer);
  }, [busy, refresh]);

  const upload = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      setBusy(true);
      setJobs(files.map((file) => ({ file, status: 'waiting' as const })));

      const mark = (index: number, status: Job['status']) =>
        setJobs((prev) =>
          prev.map((job, i) => (i === index ? { ...job, status } : job)),
        );

      try {
        const res = await fetch(`/api/events/${eventId}/uploads`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            files: files.map((f) => ({
              name: f.name,
              size: f.size,
              type: f.type || 'image/jpeg',
            })),
          }),
        });
        if (!res.ok) throw new Error(`presign failed: ${res.status}`);
        const { uploads } = (await res.json()) as {
          uploads: { photoId: string; url: string; headers: Record<string, string> }[];
        };

        let next = 0;
        const worker = async () => {
          while (next < uploads.length) {
            const index = next++;
            const target = uploads[index]!;
            mark(index, 'sending');
            try {
              // The File goes straight in as the body — it streams from disk.
              const put = await fetch(target.url, {
                method: 'PUT',
                headers: target.headers,
                body: files[index]!,
              });
              if (!put.ok) throw new Error(`upload failed: ${put.status}`);
              await fetch(`/api/uploads/${target.photoId}/complete`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
              });
              mark(index, 'done');
            } catch {
              mark(index, 'failed');
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, uploads.length) }, worker),
        );
      } finally {
        setBusy(false);
        await refresh();
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [eventId, refresh],
  );

  const remaining = jobs.filter((j) => j.status === 'waiting' || j.status === 'sending').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;

  return (
    <main className="wrap">
      <header>
        <h1>{feed.event.name}</h1>
        <p className="muted">
          {feed.count} {feed.count === 1 ? 'photo' : 'photos'} from {feed.contributors}{' '}
          {feed.contributors === 1 ? 'person' : 'people'}
        </p>
      </header>

      {feed.event.uploadsOpen && (
        <section className="panel">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            disabled={busy}
            onChange={(e) => upload(Array.from(e.target.files ?? []))}
          />
          {busy && (
            <p className="muted">
              {remaining} of {jobs.length} to go — keep this tab open until it
              finishes. Uploads do not continue in the background.
            </p>
          )}
          {!busy && jobs.length > 0 && (
            <p className="muted">
              Added {jobs.filter((j) => j.status === 'done').length} of {jobs.length}
              {failed > 0 && ` · ${failed} failed`}
            </p>
          )}
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
            /* eslint-disable-next-line @next/next/no-img-element */
            <img key={photo.id} src={photo.src} alt="" loading="lazy" />
          ))}
        </div>
      )}
    </main>
  );
}
