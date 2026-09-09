/**
 * The browser half of the upload queue — docs/design.md §8.
 *
 * The state machine lives in `@parea/upload` and is shared with the native
 * client. Everything here is the three things a browser does differently:
 * where bytes come from (an IndexedDB-held `File` rather than an asset URI),
 * how identity travels (a cookie rather than a bearer token), and the fact
 * that a `File` handle can stop working while the queue still believes in it.
 */

import {
  SourceGone,
  UploadQueue,
  type Deps,
  type QueueItem,
  type QueueState,
} from '@parea/upload';

import { readable, type UploadStore } from './store';

/**
 * The store, as its two callers need it.
 *
 * Structural rather than the class because the interesting behaviour here is
 * what happens to a dead `File` handle, and no in-process IndexedDB fake
 * carries a real `File` through a round trip — so a test that went through one
 * would be testing the fake. Named seams let a test supply the handles
 * directly and check the logic that acts on them.
 */
export type FileSource = Pick<UploadStore, 'getFile'>;
export type StateSource = Pick<UploadStore, 'loadState' | 'clear'> & FileSource;
export type SaveTarget = Pick<UploadStore, 'saveState' | 'dropFiles'> & FileSource;

/**
 * A file's identity, stable across reloads and across re-picking.
 *
 * Not a random id: the same file chosen twice must collide so the queue's
 * dedupe catches it, and a file re-picked after its handle died must land on
 * the same record so the live handle replaces the dead one. Name, size and
 * mtime is what the platform gives us, and it is enough — two genuinely
 * different photos agreeing on all three is not a failure worth engineering
 * against, and the cost of being wrong is one skipped duplicate.
 */
export function sourceKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export type NewFile = { source: string; file: File };

/** The queue's view of a picked file, plus the handle to store beside it. */
export function describe(eventId: string, file: File): NewFile & {
  item: Omit<QueueItem, 'status' | 'attempts' | 'eventId'>;
} {
  const source = sourceKey(file);
  return {
    source,
    file,
    item: {
      id: `${eventId}:${source}`,
      source,
      name: file.name,
      size: file.size,
      // Browsers leave `type` empty for formats they do not recognise, HEIC
      // among them on some Android builds — and the presign route rejects an
      // empty MIME. Guessing JPEG is wrong for a HEIC, but the deriver reads
      // the real type from the bytes and corrects the row, so the guess only
      // has to get past validation.
      mime: file.type || 'image/jpeg',
    },
  };
}

export type WebQueueDeps = {
  eventId: string;
  store: SaveTarget | null;
  /** Injectable for tests; defaults to the global. */
  fetch?: typeof globalThis.fetch;
  /** Held in memory as well as in IndexedDB, so a failed store still uploads. */
  files: Map<string, File>;
};

export function browserDeps({
  eventId,
  store,
  files,
  fetch: doFetch = globalThis.fetch,
}: WebQueueDeps): Deps {
  return {
    async presign(id, batch) {
      const res = await doFetch(`/api/events/${id}/uploads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ files: batch }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(`presign failed: ${res.status} ${body.error ?? ''}`.trim());
      }
      const { uploads } = (await res.json()) as { uploads: any[] };
      return uploads;
    },

    async upload(item) {
      const file = files.get(item.id) ?? (await store?.getFile(item.id)) ?? null;
      // Nothing to send and nothing that will produce it later.
      if (!file) throw new SourceGone(`no handle for ${item.name}`);

      // Checked before the PUT rather than after, because a `fetch` whose body
      // cannot be read rejects with the same opaque network error as a dropped
      // connection — and those two want opposite responses: one should retry,
      // one should never retry again.
      if (!(await readable(file))) {
        throw new SourceGone(`${item.name} is no longer readable`);
      }

      const res = await doFetch(item.uploadUrl!, {
        method: 'PUT',
        headers: item.headers ?? {},
        // The File goes in as the body and streams from disk; reading it into
        // memory first is a tab crash on a 200-file selection.
        body: file,
      });
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
    },

    async complete(photoId) {
      const res = await doFetch(`/api/uploads/${photoId}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`complete failed: ${res.status}`);
    },

    async save(state) {
      // Handles for finished items are dropped as we go, not at the end: the
      // reason this database is small is that it holds only outstanding work.
      const finished = state.items
        .filter((i) => i.status === 'done')
        .map((i) => i.id);
      for (const id of finished) files.delete(id);
      await store?.dropFiles(finished).catch(() => {});
      await store?.saveState(eventId, state).catch(() => {});
    },
  };
}

export type Restored = {
  queue: UploadQueue;
  files: Map<string, File>;
  /** Items whose bytes are gone. The UI asks for these to be picked again. */
  stale: QueueItem[];
};

/**
 * Rebuilds a queue from IndexedDB, checking every handle before trusting it.
 *
 * The probe is the point. Without it a resumed queue spends four attempts and
 * four presign round trips per photo discovering one at a time that the tab it
 * came from is gone — and reports "failed", which reads as "try again" when
 * the only thing that helps is picking the file again.
 *
 * `lent` is the arrival from the create page: handles still on loan to this
 * document, which have not been through a navigation that could end the loan.
 * They are preferred over the stored copy rather than used as a fallback,
 * because the stored copy is a clone of the same reference and is the one that
 * dies first — on iOS it is reliably dead by the time anything reads it back.
 * See `upload/handoff.ts`.
 */
export async function restore(
  eventId: string,
  store: StateSource & SaveTarget,
  {
    now = Date.now(),
    fetch,
    lent = new Map<string, File>(),
  }: {
    now?: number;
    fetch?: typeof globalThis.fetch;
    lent?: Map<string, File>;
  } = {},
): Promise<Restored | null> {
  const state = await store.loadState(eventId, now);
  if (!state) return null;

  const files = new Map<string, File>();
  const outstanding = state.items.filter(
    (i) => i.status !== 'done' && i.status !== 'stale',
  );
  if (outstanding.length === 0) {
    await store.clear(eventId);
    return null;
  }

  for (const item of outstanding) {
    const file = lent.get(item.id) ?? (await store.getFile(item.id));
    if (file && (await readable(file))) {
      files.set(item.id, file);
    } else {
      item.status = 'stale';
      item.error = 'the browser can no longer read this file';
    }
  }

  const queue = new UploadQueue(
    browserDeps({ eventId, store, files, fetch }),
    state as QueueState,
  );
  return { queue, files, stale: queue.staleItems };
}
