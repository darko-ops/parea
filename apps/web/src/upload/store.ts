/**
 * Persisting an in-flight upload across a reload — docs/design.md §8.
 *
 * Two stores, and the split is the whole design:
 *
 *   `queue`  one small JSON record per event: the `QueueState` the shared
 *            queue owns. Written after every state transition, so it has to
 *            be cheap — hundreds of bytes, one `put`.
 *   `files`  one record per queued photo, holding the `File` the picker
 *            handed over. Written once at enqueue, deleted when the item
 *            finishes.
 *
 * **The bytes are never copied.** A `File` from `<input type=file>` is a
 * reference to something already on disk; structured-cloning it into IndexedDB
 * stores that reference, not a second copy. The obvious "safer" alternative —
 * read each file and store the bytes — would put 200 photos, most of a
 * gigabyte, into origin storage to protect against a reload. Safari evicts an
 * origin's storage all at once, so that trade buys resilience against the
 * cheap failure by risking the expensive one: losing the queue *and* the
 * copies together.
 *
 * The cost of not copying is that a stored handle can die, and it is not rare
 * — see `readable()`.
 */

import type { QueueState } from '@parea/upload';

const DB_NAME = 'parea-uploads';
const DB_VERSION = 1;
const QUEUE_STORE = 'queue';
const FILE_STORE = 'files';

/**
 * A queue older than this is not resumed.
 *
 * Resume exists for the tab that reloaded mid-upload, not for the person who
 * comes back next week to a page that silently starts sending photos. By then
 * the handles are almost certainly dead anyway; this just makes the outcome
 * deliberate rather than incidental.
 */
export const RESUME_WINDOW_MS = 24 * 60 * 60 * 1000;

type QueueRecord = {
  eventId: string;
  state: QueueState;
  /** When this queue was last written, for `RESUME_WINDOW_MS`. */
  updatedAt: number;
};

type FileRecord = { id: string; eventId: string; file: File };

/** Promisifies one request. IndexedDB's event API is otherwise unreadable. */
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

export function openUploadDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'eventId' });
      }
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        const files = db.createObjectStore(FILE_STORE, { keyPath: 'id' });
        // So abandoning one event's queue does not mean scanning every record.
        files.createIndex('eventId', 'eventId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // Another tab is holding the old version open. Rather than hang forever,
    // fail — the caller falls back to an in-memory queue and the upload still
    // works, it just will not survive a reload.
    request.onblocked = () => reject(new Error('upload database is blocked'));
  });
}

export class UploadStore {
  constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<UploadStore> {
    return new UploadStore(await openUploadDb(factory));
  }

  async saveState(eventId: string, state: QueueState, now = Date.now()): Promise<void> {
    const tx = this.db.transaction(QUEUE_STORE, 'readwrite');
    const record: QueueRecord = { eventId, state, updatedAt: now };
    tx.objectStore(QUEUE_STORE).put(record);
    await done(tx);
  }

  /** Null when there is nothing to resume, or when what is there is too old. */
  async loadState(eventId: string, now = Date.now()): Promise<QueueState | null> {
    const tx = this.db.transaction(QUEUE_STORE, 'readonly');
    const record = await promisify<QueueRecord | undefined>(
      tx.objectStore(QUEUE_STORE).get(eventId),
    );
    if (!record) return null;
    if (now - record.updatedAt > RESUME_WINDOW_MS) {
      await this.clear(eventId);
      return null;
    }
    return record.state;
  }

  async putFiles(eventId: string, files: { id: string; file: File }[]): Promise<void> {
    const tx = this.db.transaction(FILE_STORE, 'readwrite');
    const store = tx.objectStore(FILE_STORE);
    for (const { id, file } of files) {
      const record: FileRecord = { id, eventId, file };
      store.put(record);
    }
    await done(tx);
  }

  async getFile(id: string): Promise<File | null> {
    const tx = this.db.transaction(FILE_STORE, 'readonly');
    const record = await promisify<FileRecord | undefined>(
      tx.objectStore(FILE_STORE).get(id),
    );
    return record?.file ?? null;
  }

  /**
   * Drops handles for finished work.
   *
   * Called as items complete rather than only at the end, because the whole
   * point of not copying bytes is to keep this database small, and a record
   * pinning a `File` reference for a photo that already uploaded is exactly
   * the kind of thing that quietly accumulates.
   */
  async dropFiles(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const tx = this.db.transaction(FILE_STORE, 'readwrite');
    const store = tx.objectStore(FILE_STORE);
    for (const id of ids) store.delete(id);
    await done(tx);
  }

  /** Forgets an event's queue entirely — finished, abandoned, or too old. */
  async clear(eventId: string): Promise<void> {
    const tx = this.db.transaction([QUEUE_STORE, FILE_STORE], 'readwrite');
    tx.objectStore(QUEUE_STORE).delete(eventId);
    const index = tx.objectStore(FILE_STORE).index('eventId');
    const cursorRequest = index.openCursor(IDBKeyRange.only(eventId));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    await done(tx);
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Whether a stored handle can still produce bytes.
 *
 * This is the check the design originally missed. Structured-cloning a `File`
 * into IndexedDB always *works*; reading it back later is what can fail. Per
 * the File API a Blob carries a snapshot of its underlying storage, and a read
 * must fail once the real thing no longer matches that snapshot — so a handle
 * outlives its bytes whenever the OS reclaims what the picker gave us. On iOS
 * that is routine: photos chosen from the library are temp copies, and the
 * reload we are trying to survive can be the very thing that outlives them.
 *
 * It has to be a real read. `file.size` and `file.name` answer from the
 * snapshot and keep answering happily after the bytes are gone, which makes
 * checking them worse than not checking at all. One byte is enough to force
 * the read and cheap enough to do for every item on resume.
 */
export async function readable(file: File): Promise<boolean> {
  try {
    await file.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}
