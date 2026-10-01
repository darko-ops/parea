/**
 * The gallery's previews of photos on their way, kept across leaving the page.
 *
 * A preview is drawn from the file in hand, and the queue lets go of a photo's
 * file as soon as it is sent — which is seconds before the photograph is
 * through processing. So somebody who added twenty photos, looked at another
 * page and came back found the top of the roll empty again while the album
 * still said "12 arriving". Each preview is now written down when it is made,
 * and read back when the roll opens, until the real photograph is on it.
 *
 * Its own small database rather than a third store in `parea-uploads`. Adding a
 * store means a version bump, and a version bump is refused while an older tab
 * holds the database open — which sends that upload to the in-memory fallback
 * and loses the very reload-survival the database exists for. Previews are a
 * nicety; they do not get to put the upload at risk.
 *
 * Thumbnails only: `PREVIEW_EDGE` JPEGs, tens of kilobytes, at most
 * `PREVIEW_CAP` per event, and none older than `PREVIEW_TTL_MS`. The bytes are
 * kept as an `ArrayBuffer` rather than a `Blob`: Safari has had seasons of not
 * storing Blobs in IndexedDB, and a buffer round-trips everywhere.
 *
 * Best effort throughout. No database — private browsing, storage off — is the
 * page as it was: previews for as long as the page has the files.
 */

import type { QueueItem } from '@parea/upload';

const DB_NAME = 'parea-upload-previews';
const DB_VERSION = 1;
const STORE = 'previews';

/** A preview this old is somebody's upload that went wrong, not one arriving. */
export const PREVIEW_TTL_MS = 30 * 60 * 1000;

/** The most kept for one event — a big evening, at thumbnail size. */
export const PREVIEW_CAP = 100;

/** What is known about a kept preview, without its bytes. */
export type PreviewMeta = {
  itemId: string;
  eventId: string;
  name: string;
  /** Set once the photo is presigned, which is what the feed will call it. */
  photoId?: string;
  status: QueueItem['status'];
  width: number;
  height: number;
  createdAt: number;
};

export type PreviewRecord = PreviewMeta & { bytes: ArrayBuffer; type: string };

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

/** Whether a kept preview is too old to be anything still on its way. */
export function expired(record: Pick<PreviewMeta, 'createdAt'>, now: number): boolean {
  return now - record.createdAt > PREVIEW_TTL_MS;
}

/** The oldest of one event's previews beyond `cap`, to be let go. */
export function overCap(records: Pick<PreviewMeta, 'itemId' | 'createdAt'>[], cap = PREVIEW_CAP): string[] {
  if (records.length <= cap) return [];
  return [...records]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(cap)
    .map((record) => record.itemId);
}

/**
 * The kept previews the queue no longer has, still owed a tile, newest first.
 *
 * The queue in this tab is the live answer for whatever it holds, so these
 * are only the rest: sent from a page since left, or by a queue that has been
 * cleared. Each is shown as processing until the feed has it, or until the
 * album has settled with nothing arriving — the same rule as a sent photo in
 * the queue (see `outstandingUploads`).
 *
 * One without a photo id never reached the server. While the queue has not
 * yet said what it holds that may just be a reload still restoring it; once
 * this page has seen the queue hold it and then not, it was discarded.
 */
export function orphanPreviews(
  records: PreviewMeta[],
  items: QueueItem[],
  seen: Set<string>,
  shown: Set<string>,
  settled: boolean,
): PreviewMeta[] {
  const live = new Set(items.map((item) => item.id));
  return records
    .filter((record) => {
      if (live.has(record.itemId)) return false;
      if (record.photoId != null && shown.has(record.photoId)) return false;
      if (settled) return false;
      if (record.photoId == null && seen.has(record.itemId)) return false;
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function openPreviewDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'itemId' });
        store.createIndex('eventId', 'eventId');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Step aside for a newer page rather than block its upgrade.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('preview database is blocked'));
  });
}

export class PreviewStore {
  constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<PreviewStore> {
    return new PreviewStore(await openPreviewDb(factory));
  }

  /** Keeps one, and lets go of that event's oldest beyond `cap`. */
  async put(record: PreviewRecord, cap = PREVIEW_CAP): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.put(record);
    const all = await promisify<PreviewRecord[]>(
      store.index('eventId').getAll(IDBKeyRange.only(record.eventId)),
    );
    for (const id of overCap(all, cap)) store.delete(id);
    await done(tx);
  }

  /** Follows the queue item along: its photo id once it has one, its status. */
  async update(itemId: string, patch: Pick<PreviewMeta, 'photoId' | 'status'>): Promise<void> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const record = await promisify<PreviewRecord | undefined>(store.get(itemId));
    if (record) store.put({ ...record, ...patch });
    await done(tx);
  }

  /** An event's kept previews, the expired ones let go on the way. */
  async load(eventId: string, now = Date.now()): Promise<PreviewRecord[]> {
    const tx = this.db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const all = await promisify<PreviewRecord[]>(
      store.index('eventId').getAll(IDBKeyRange.only(eventId)),
    );
    const kept: PreviewRecord[] = [];
    for (const record of all) {
      if (expired(record, now)) store.delete(record.itemId);
      else kept.push(record);
    }
    await done(tx);
    return kept;
  }

  async drop(itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    const tx = this.db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of itemIds) store.delete(id);
    await done(tx);
  }

  close(): void {
    this.db.close();
  }
}

let opening: Promise<PreviewStore | null> | null = null;

/** The page's one connection, or null where there is no database to be had. */
export function previewStore(): Promise<PreviewStore | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  opening ??= PreviewStore.open().catch(() => null);
  return opening;
}
