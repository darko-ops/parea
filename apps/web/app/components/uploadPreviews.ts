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
 */

import { useEffect, useRef, useState } from 'react';
import type { QueueItem } from '@parea/upload';

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

export function useUploadPreviews({
  items,
  fileOf,
  shown,
  arriving,
  running,
}: {
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
   */
  const [end, setEnd] = useState<{ running: boolean; shown: Set<string> | null }>({
    running,
    shown: null,
  });
  if (end.running !== running) setEnd({ running, shown: running ? null : shown });
  const settled = !running && arriving === 0 && shown !== end.shown;

  const wanted = outstandingUploads(items, shown, settled);
  const key = wanted.map((item) => item.id).join('\n');

  const [made, setMade] = useState<Map<string, Made>>(() => new Map());
  // Handles caught while the queue still has them: it lets go of a photo's
  // file as soon as it is sent, which can be before its preview is made.
  const held = useRef(new Map<string, File>());
  const wantedIds = useRef(new Set<string>());
  const busy = useRef(false);
  const alive = useRef(true);
  const [, nudge] = useState(0);

  useEffect(() => {
    const ids = new Set(key ? key.split('\n') : []);
    wantedIds.current = ids;
    const gone = [...made.keys()].filter((id) => !ids.has(id));
    for (const id of ids) {
      const file = fileOf(id);
      if (!file || held.current.get(id) === file) continue;
      // A stale photo picked again keeps its id and brings a new handle, so
      // whatever was drawn for the dead one is made again from the live one.
      if (held.current.has(id) && made.has(id)) gone.push(id);
      held.current.set(id, file);
    }
    for (const id of [...held.current.keys()]) if (!ids.has(id)) held.current.delete(id);

    // Previews of anything no longer owed a tile: shown, discarded, re-picked.
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
    }
  });

  // One at a time, top of the gallery first.
  useEffect(() => {
    if (busy.current) return;
    const id = (key ? key.split('\n') : []).find((one) => !made.has(one));
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
    });
  });

  // Whatever is still held when the page goes.
  const latest = useRef(made);
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
