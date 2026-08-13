'use client';

/**
 * The upload queue, wired to React — docs/design.md §8.
 *
 * Three jobs: keep a snapshot of the queue in state so the UI can show
 * per-file progress, resume whatever the last tab left behind, and refuse to
 * let someone close the tab in the middle without being told.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { QueueItem, QueueState, UploadQueue } from '@parea/upload';

import { browserDeps, describe, restore } from '@/upload/browser';
import { UploadStore } from '@/upload/store';

export type UploadsView = {
  items: QueueItem[];
  /** Still to send. */
  remaining: number;
  done: number;
  failed: number;
  /** Bytes vanished with the tab that picked them; these need re-picking. */
  stale: QueueItem[];
  running: boolean;
  /** True when this tab picked up work a previous one left behind. */
  resumed: boolean;
  add(files: File[]): Promise<void>;
  discard(): Promise<void>;
};

const EMPTY: QueueState = { items: [] };

export function useUploads(eventId: string, onProgress?: () => void): UploadsView {
  const [snapshot, setSnapshot] = useState<QueueState>(EMPTY);
  const [running, setRunning] = useState(false);
  const [resumed, setResumed] = useState(false);

  const store = useRef<UploadStore | null>(null);
  const queue = useRef<UploadQueue | null>(null);
  const files = useRef(new Map<string, File>());
  // Effects run twice in development. Opening the database twice is harmless;
  // starting the resumed queue twice is not.
  const started = useRef(false);

  const drive = useCallback(
    async (q: UploadQueue) => {
      setRunning(true);
      try {
        await q.run();
      } finally {
        setSnapshot({ items: [...q.state.items] });
        setRunning(false);
        onProgress?.();
      }
    },
    [onProgress],
  );

  useEffect(() => {
    // The create page mounts this before its event exists, so that photos can
    // be chosen first and sent the moment there is somewhere to send them.
    // There is nothing to resume for an event that does not exist yet, and
    // restoring against an empty id would open a queue belonging to nobody.
    if (!eventId) return;
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    (async () => {
      // Everything below is best-effort. Private browsing, a blocked upgrade
      // from another tab, or a browser with storage disabled all land here,
      // and none of them should stop someone uploading — they only cost the
      // ability to survive a reload.
      const opened = await UploadStore.open().catch(() => null);
      if (cancelled) return;
      store.current = opened;
      if (!opened) return;

      const restored = await restore(eventId, opened).catch(() => null);
      if (cancelled || !restored) return;

      queue.current = restored.queue;
      files.current = restored.files;
      setSnapshot({ items: [...restored.queue.state.items] });
      setResumed(true);
      if (restored.queue.pendingCount > 0) await drive(restored.queue);
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId, drive]);

  /**
   * "The tab must stay open" is stated in the UI, but a statement is not a
   * guard. iOS Safari has no background completion, so a closed tab mid-batch
   * loses whatever had not been sent.
   */
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running]);

  const add = useCallback(
    async (picked: File[]) => {
      if (picked.length === 0) return;

      const described = picked.map((file) => describe(eventId, file));
      for (const { item, file } of described) files.current.set(item.id, file);

      let q = queue.current;
      if (!q) {
        const { UploadQueue: Ctor } = await import('@parea/upload');
        q = new Ctor(
          browserDeps({ eventId, store: store.current, files: files.current }),
          { items: [...snapshot.items] },
        );
        queue.current = q;
      }

      // Someone re-picking a file that went stale means exactly this photo,
      // again. Without forgetting the old entry the dedupe in `add` would
      // recognise the source and silently drop the replacement.
      q.forget(described.map((d) => d.source));
      q.add(
        eventId,
        described.map((d) => d.item),
      );

      await store.current
        ?.putFiles(
          eventId,
          described.map((d) => ({ id: d.item.id, file: d.file })),
        )
        .catch(() => {});

      setSnapshot({ items: [...q.state.items] });
      await drive(q);
    },
    [eventId, drive, snapshot],
  );

  const discard = useCallback(async () => {
    queue.current = null;
    files.current = new Map();
    setSnapshot(EMPTY);
    setResumed(false);
    await store.current?.clear(eventId).catch(() => {});
  }, [eventId]);

  const items = snapshot.items;
  return {
    items,
    remaining: items.filter(
      (i) => i.status !== 'done' && i.status !== 'failed' && i.status !== 'stale',
    ).length,
    done: items.filter((i) => i.status === 'done').length,
    failed: items.filter((i) => i.status === 'failed').length,
    stale: items.filter((i) => i.status === 'stale'),
    running,
    resumed,
    add,
    discard,
  };
}
