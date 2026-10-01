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
import { lend, peek, release } from '@/upload/handoff';
import { secureBudget, UploadStore } from '@/upload/store';

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
  /** Persist a batch for another page to send. See below. */
  stage(files: File[], eventId: string): Promise<void>;
  discard(): Promise<void>;
  /** Another set of attempts for whatever gave up — see `retryFailed`. */
  retry(): Promise<void>;
  /**
   * The live handle for a queued photo, if this tab holds one — picked here,
   * or restored after a refresh. A getter rather than a list so the gallery's
   * previews can read it without the hook re-rendering for every handle.
   */
  fileOf(id: string): File | undefined;
};

const EMPTY: QueueState = { items: [] };

export function useUploads(eventId: string, onProgress?: () => void): UploadsView {
  const [snapshot, setSnapshot] = useState<QueueState>(EMPTY);
  const [running, setRunning] = useState(false);
  // Copies of picked photos still being written — see `secure` in the store.
  // A reload before they land loses those photos, so it is warned against.
  const [securing, setSecuring] = useState(0);
  const [resumed, setResumed] = useState(false);

  const store = useRef<UploadStore | null>(null);
  const queue = useRef<UploadQueue | null>(null);
  const files = useRef(new Map<string, File>());
  /*
   * One resume per mount. Effects run twice in development — opening the
   * database twice is harmless, starting the resumed queue twice is not.
   *
   * Released by the cleanup, and that is not a detail. Without it the pair of
   * development invocations cancelled each other out perfectly: the first ran,
   * was told to stop by the cleanup at its first `await`, and the second
   * returned here because the first had already claimed the flag. So nothing
   * ever resumed in `next dev` — which is exactly where anybody would go to
   * check that resuming works. It was invisible because it only misbehaves
   * where nobody ships from.
   */
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

    /*
     * Read before the store is even opened, and deliberately not taken.
     *
     * These are the handles the create page was still holding when it handed
     * over. Taking them here is what the first version did, and it broke under
     * the double-invoked effect above: this run may be the one whose work gets
     * thrown away at the `cancelled` check, and it must not walk off with the
     * photographs on its way out. `release` happens below, once there is a
     * queue worth keeping. See `upload/handoff.ts`.
     */
    const lent = peek(eventId);

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

      /*
       * Show the saved queue at once, before checking its files.
       *
       * The check reads every saved photo, and until it finished the panel was
       * empty — so a refresh made the progress bar vanish and the page jump,
       * then the bar came back. The saved state is already the right picture;
       * the check only corrects the few that turn out unreadable.
       */
      const early = await opened.loadState(eventId).catch(() => null);
      if (cancelled) return;
      if (early && early.items.length > 0) {
        setSnapshot({ items: [...early.items] });
        setResumed(true);
      }

      const restored = await restore(eventId, opened, { lent }).catch(() => null);
      if (cancelled) return;
      // Past the last point this run can be discarded, so the handles have
      // reached the queue that will actually send them — including when there
      // was nothing to restore, which means no queue is coming for them.
      release(eventId);
      if (!restored) {
        // Nothing left to send after all: take back the early picture.
        if (early) {
          setSnapshot(EMPTY);
          setResumed(false);
        }
        return;
      }

      queue.current = restored.queue;
      files.current = restored.files;
      setSnapshot({ items: [...restored.queue.state.items] });
      setResumed(true);
      if (restored.queue.pendingCount > 0) await drive(restored.queue);
    })();

    return () => {
      cancelled = true;
      started.current = false;
    };
  }, [eventId, drive]);

  /**
   * "The tab must stay open" is stated in the UI, but a statement is not a
   * guard. iOS Safari has no background completion, so a closed tab mid-batch
   * loses whatever had not been sent.
   */
  useEffect(() => {
    if (!running && securing === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [running, securing]);

  /**
   * Copies the bytes of just-queued photos into storage, in the background,
   * so a refresh resumes the upload instead of losing them. Counted while it
   * runs, for the warning above.
   */
  const secureAll = useCallback(
    (opened: UploadStore | null, stored: { id: string; file: File }[]) => {
      if (!opened || stored.length === 0) return;
      setSecuring((n) => n + 1);
      void secureBudget()
        .then((budget) => opened.secure(stored, budget))
        .catch(() => 0)
        .finally(() => setSecuring((n) => n - 1));
    },
    [],
  );

  /**
   * Hand the photos to the event and leave.
   *
   * The same enqueue as `add` and deliberately not the same finish: it writes
   * the queue into IndexedDB and returns, without uploading anything. The
   * event page opens, finds the queue under its own id, and sends them — which
   * is what makes "create it and you are looking at it" possible at all. `add`
   * would upload here and then navigate away from the tab doing the work.
   *
   * **The handles go through memory, not through the database.** They used to
   * go only through IndexedDB, on the reasoning that a `File` cloned into it is
   * a reference to something already on disk and therefore survives. The
   * reference survives; the loan behind it does not. An iOS photo picked from
   * the library is a temp copy the OS keeps alive for the document that asked,
   * and `location.href` ended both the document and the copy — so every photo
   * arrived at the event page unreadable, went `stale`, and was never sent.
   *
   * So `lend` parks the live handles for the next page, and the create page
   * navigates client-side so there is a next page holding the same loan. The
   * database write stays, because it is what survives a real reload — the case
   * where the bytes genuinely are gone and the honest answer is to ask again.
   */
  const stage = useCallback(
    async (picked: File[], forEventId: string) => {
      if (picked.length === 0) return;

      const described = picked.map((file) => describe(forEventId, file));

      /*
       * First, and before anything that can fail.
       *
       * The database is optional here and the handoff is not: private
       * browsing, a blocked upgrade from another tab, or storage switched off
       * all end with no store, and an early return on that used to mean
       * leaving with the photos held by nobody. iOS Safari in private mode is
       * both the browser most likely to refuse the database and the one whose
       * handles most need carrying, so the order matters more than it looks.
       */
      lend(forEventId, new Map(described.map((d) => [d.item.id, d.file])));

      // Opened here rather than waited for. The store effect above is keyed on
      // the event id, and at this moment the id is one render old — the event
      // was created a line ago.
      const opened = store.current ?? (await UploadStore.open().catch(() => null));
      store.current = opened;
      if (!opened) return;

      const { UploadQueue: Ctor } = await import('@parea/upload');
      const q = new Ctor(
        browserDeps({ eventId: forEventId, store: opened, files: new Map() }),
        { items: [] },
      );
      q.add(
        forEventId,
        described.map((d) => d.item),
      );

      await opened.saveState(forEventId, q.state).catch(() => {});
      const stored = described.map((d) => ({ id: d.item.id, file: d.file }));
      await opened.putFiles(forEventId, stored).catch(() => {});
      // Then the bytes themselves, in the background, so a reload on the event
      // page — Safari killing the tab, a refresh — resumes instead of asking
      // for every photo again. See `secure` in the store.
      secureAll(opened, stored);
    },
    [secureAll],
  );

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

      const stored = described.map((d) => ({ id: d.item.id, file: d.file }));
      await store.current?.putFiles(eventId, stored).catch(() => {});
      // As in `stage`: copies of the bytes, so a reload does not lose them.
      secureAll(store.current, stored);

      setSnapshot({ items: [...q.state.items] });
      await drive(q);
    },
    [eventId, drive, snapshot, secureAll],
  );

  const discard = useCallback(async () => {
    queue.current = null;
    files.current = new Map();
    setSnapshot(EMPTY);
    setResumed(false);
    await store.current?.clear(eventId).catch(() => {});
  }, [eventId]);

  /*
   * The queue already knows how; the web page had no way to ask. A failed
   * photo still has its handle (only finished ones are let go), so this is
   * the same run again rather than a re-pick.
   */
  const retry = useCallback(async () => {
    const q = queue.current;
    if (!q || running || q.retryFailed(eventId) === 0) return;
    setSnapshot({ items: [...q.state.items] });
    await drive(q);
  }, [eventId, drive, running]);

  // Read at call time, so it follows `files` when a restore swaps the map.
  const fileOf = useCallback((id: string) => files.current.get(id), []);

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
    stage,
    discard,
    retry,
    fileOf,
  };
}
