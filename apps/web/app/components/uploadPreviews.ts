'use client';

/**
 * Photos somebody is adding, in the gallery before the server has them.
 *
 * An upload used to appear only in the panel at the foot of the page, and the
 * gallery stayed as it was until processing finished — seconds per photo, so
 * adding twenty looked like nothing had happened. Now each one takes its place
 * at the top of the roll at once, drawn from the file in hand, and gives way
 * to the real photograph when the feed has it.
 *
 * Small previews only, made one at a time: see `thumbnails.ts` for what
 * pointing an `<img>` at iPhone originals did to Safari. A photo that cannot be
 * previewed gets a plain tile, never its original.
 *
 * And kept: each preview is written down as it is made, and read back when the
 * roll opens again, because the file it was drawn from is gone by then — the
 * queue lets go of a photo once it is sent, and a reload of everything else.
 * See `upload/previews.ts`.
 */

import { useEffect, useRef, useState } from 'react';
import type { QueueItem } from '@parea/upload';

import { orphanPreviews, previewStore, type PreviewMeta } from '@/upload/previews';

import { thumbnail } from './thumbnails';

/** What a tile on its way says about itself. */
export type PreviewState = 'uploading' | 'processing' | 'failed' | 'stale';

export type UploadPreview = {
  id: string;
  name: string;
  status: QueueItem['status'];
  state: PreviewState;
  /** The preview, null where none could be made, undefined while it is. */
  src: string | null | undefined;
  /** Height over width, once a preview has told us; null until then. */
  ratio: number | null;
};

export function previewState(status: QueueItem['status']): PreviewState {
  switch (status) {
    case 'done':
      return 'processing';
    case 'failed':
      return 'failed';
    case 'stale':
      return 'stale';
    default:
      return 'uploading';
  }
}

/**
 * The queued photos still owed a place in the gallery, newest first.
 *
 * Newest first because the roll is: `addedSeq` puts each addition on top and
 * the first pick of a batch lowest, and the queue holds them in pick order.
 * So the reversed queue is the order the real photographs will arrive in, and
 * one that finishes takes the slot its preview had.
 *
 * A sent photo leaves once it is on the page — or once the album has settled
 * with nothing arriving, which is a duplicate dropped by processing that will
 * never show. Failed and stale ones stay: they are waiting on somebody.
 */
export function outstandingUploads(
  items: QueueItem[],
  shown: Set<string>,
  settled: boolean,
): QueueItem[] {
  const out: QueueItem[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.photoId != null && shown.has(item.photoId)) continue;
    if (item.status === 'done' && settled) continue;
    out.push(item);
  }
  return out;
}

type Made = { src: string | null; ratio: number | null };

/** A tile owed: a queue item, or a kept preview the queue no longer has. */
type Owed = Pick<QueueItem, 'id' | 'name' | 'status'>;

const ids = (key: string) => (key ? key.split('\n') : []);

export function useUploadPreviews({
  eventId,
  items,
  fileOf,
  shown,
  arriving,
  running,
}: {
  eventId: string;
  items: QueueItem[];
  fileOf: (id: string) => File | undefined;
  /** The feed's photo ids. A new set per feed, which is used below. */
  shown: Set<string>;
  arriving: number;
  running: boolean;
}): UploadPreview[] {
  /*
   * Settled means a feed read after the last run ended says nothing is
   * arriving. The feed on screen when a run ends can predate its last upload,
   * and trusting its "nothing arriving" took the newest preview away for a
   * moment before the photo came back. The refresh at the end of a run is a
   * new set, so "a different set from the one at the end" is "read since".
   * Adjusted during render rather than in an effect, so no frame sees it wrong.
   *
   * It starts at the feed the page opened with, which counts as read at the
   * end of a run: a page just come back to has kept previews and has not asked
   * the server anything yet, and the feed it was rendered with can be older
   * than the last photo sent from the page before. So kept previews wait for
   * one read of this page's own — which the gallery polls for while they show.
   */
  const [end, setEnd] = useState<{ running: boolean; shown: Set<string> | null }>({
    running,
    shown,
  });
  if (end.running !== running) setEnd({ running, shown: running ? null : shown });
  const settled = !running && arriving === 0 && shown !== end.shown;

  /*
   * Every photo the queue has held while this page was open. A kept preview
   * the queue held and then dropped before it was ever sent was discarded;
   * one the queue has not held yet may only be a reload still restoring it.
   * Adjusted during render, like `end`.
   */
  const [track, setTrack] = useState(() => ({ items, seen: new Set(items.map((i) => i.id)) }));
  let seen = track.seen;
  if (track.items !== items) {
    seen = new Set(track.seen);
    for (const item of items) seen.add(item.id);
    setTrack({ items, seen });
  }

  // What is known about the kept previews; their pictures are in `made`.
  const [kept, setKept] = useState<Map<string, PreviewMeta>>(() => new Map());
  const [loaded, setLoaded] = useState(false);

  const wanted: Owed[] = [
    ...outstandingUploads(items, shown, settled),
    // Sent, and the queue that sent them is gone: processing, until the feed.
    ...orphanPreviews([...kept.values()], items, seen, shown, settled).map((record) => ({
      id: record.itemId,
      name: record.name,
      status: 'done' as const,
    })),
  ];
  const key = wanted.map((item) => item.id).join('\n');

  const [made, setMade] = useState<Map<string, Made>>(() => new Map());
  // Handles caught while the queue still has them: it lets go of a photo's
  // file as soon as it is sent, which can be before its preview is made.
  const held = useRef(new Map<string, File>());
  const wantedIds = useRef(new Set<string>());
  const latestItems = useRef(items);
  const busy = useRef(false);
  const alive = useRef(true);
  const [, nudge] = useState(0);

  // Whatever was kept for this album, back as pictures before any is made.
  const latest = useRef(made);
  useEffect(() => {
    let cancelled = false;
    void (eventId ? previewStore().then((store) => store?.load(eventId) ?? []) : Promise.resolve([]))
      .catch(() => [])
      .then((records) => {
        if (cancelled) return;
        const fresh = records.filter((record) => !latest.current.has(record.itemId));
        if (fresh.length > 0) {
          setMade((prev) => {
            const next = new Map(prev);
            for (const record of fresh) {
              const blob = new Blob([record.bytes], { type: record.type });
              next.set(record.itemId, {
                src: URL.createObjectURL(blob),
                ratio: record.height / record.width,
              });
            }
            return next;
          });
          setKept((prev) => {
            const next = new Map(prev);
            for (const { bytes: _bytes, type: _type, ...meta } of fresh) next.set(meta.itemId, meta);
            return next;
          });
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    latestItems.current = items;
    const owed = new Set(ids(key));
    wantedIds.current = owed;
    const gone = [...made.keys()].filter((id) => !owed.has(id));
    for (const id of owed) {
      const file = fileOf(id);
      if (!file || held.current.get(id) === file) continue;
      // A stale photo picked again keeps its id and brings a new handle, so
      // whatever was drawn for the dead one is made again from the live one.
      if (held.current.has(id) && made.has(id)) gone.push(id);
      held.current.set(id, file);
    }
    for (const id of [...held.current.keys()]) if (!owed.has(id)) held.current.delete(id);

    // Previews of anything no longer owed a tile: shown, discarded, re-picked.
    // Their kept copies go with them; leaving the page is not one of these.
    if (gone.length > 0) {
      for (const id of gone) {
        const src = made.get(id)?.src;
        if (src) URL.revokeObjectURL(src);
      }
      setMade((prev) => {
        const next = new Map(prev);
        for (const id of gone) next.delete(id);
        return next;
      });
      setKept((prev) => {
        const next = new Map(prev);
        for (const id of gone) next.delete(id);
        return next;
      });
      void previewStore()
        .then((store) => store?.drop(gone))
        .catch(() => {});
    }
  });

  // Kept previews follow their photo along: its id once presigned, its status.
  useEffect(() => {
    const changed = items.filter((item) => {
      const meta = kept.get(item.id);
      return meta && (meta.photoId !== item.photoId || meta.status !== item.status);
    });
    if (changed.length === 0) return;
    setKept((prev) => {
      const next = new Map(prev);
      for (const item of changed) {
        const meta = next.get(item.id);
        if (meta) next.set(item.id, { ...meta, photoId: item.photoId, status: item.status });
      }
      return next;
    });
    void previewStore()
      .then(async (store) => {
        for (const item of changed) {
          await store?.update(item.id, { photoId: item.photoId, status: item.status });
        }
      })
      .catch(() => {});
  }, [items, kept]);

  // One at a time, top of the gallery first — once the kept ones are back, so
  // nothing is drawn twice.
  useEffect(() => {
    if (!loaded || busy.current) return;
    const id = ids(key).find((one) => !made.has(one));
    if (!id) return;
    const file = held.current.get(id) ?? fileOf(id);
    busy.current = true;
    void (file ? thumbnail(file) : Promise.resolve(null)).then((thumb) => {
      busy.current = false;
      if (!alive.current || !wantedIds.current.has(id)) {
        if (thumb) URL.revokeObjectURL(thumb.url);
        // Still the next one to make, if this was not the last.
        if (alive.current) nudge((n) => n + 1);
        return;
      }
      setMade((prev) =>
        new Map(prev).set(
          id,
          thumb
            ? { src: thumb.url, ratio: thumb.height / thumb.width }
            : { src: null, ratio: null },
        ),
      );
      const item = latestItems.current.find((one) => one.id === id);
      if (thumb && item && eventId) keep(eventId, item, thumb);
    });
  });

  /** Writes a made preview down, so it is still there after leaving. */
  function keep(album: string, item: QueueItem, thumb: NonNullable<Awaited<ReturnType<typeof thumbnail>>>) {
    const meta: PreviewMeta = {
      itemId: item.id,
      eventId: album,
      name: item.name,
      photoId: item.photoId,
      status: item.status,
      width: thumb.width,
      height: thumb.height,
      createdAt: Date.now(),
    };
    setKept((prev) => new Map(prev).set(item.id, meta));
    void (async () => {
      const store = await previewStore();
      if (!store) return;
      const bytes = await thumb.blob.arrayBuffer();
      // Shown or discarded while the bytes were read: nothing to keep.
      if (!wantedIds.current.has(item.id)) return;
      await store.put({ ...meta, bytes, type: thumb.blob.type || 'image/jpeg' });
    })().catch(() => {});
  }

  // Whatever is still held when the page goes.
  useEffect(() => {
    latest.current = made;
  });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      for (const { src } of latest.current.values()) if (src) URL.revokeObjectURL(src);
    };
  }, []);

  return wanted.map((item) => {
    const preview = made.get(item.id);
    return {
      id: item.id,
      name: item.name,
      status: item.status,
      state: previewState(item.status),
      src: preview ? preview.src : undefined,
      ratio: preview?.ratio ?? null,
    };
  });
}
