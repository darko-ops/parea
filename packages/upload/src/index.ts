/**
 * The upload queue — docs/design.md §7.5 (native) and §8 (web).
 *
 * The hard part of both clients, and the reason either exists at all for the
 * person with 200 photos. Shared rather than written twice because the failure
 * modes are identical and subtle, and two copies of this would drift.
 * Everything here is about surviving interruption:
 *
 *   - state is persisted after every transition, so a cold start resumes
 *     rather than restarts;
 *   - each file moves through presign → upload → complete independently, so a
 *     failure loses one photo rather than the batch;
 *   - presigned URLs expire in 15 minutes, and an upload that outlives its URL
 *     is re-presigned rather than failed — which is exactly what happens when
 *     someone locks their phone in the middle of a large batch;
 *   - retries are safe because keys are content-addressed server-side, so
 *     re-uploading a file that actually completed is a no-op.
 *
 * Deliberately free of any platform import — no React Native, no DOM. A queue
 * item names its source with an opaque string; what that string means, and how
 * bytes are got out of it, lives entirely in `Deps`. On native it is a
 * `content://` or `ph://` asset URI; on the web it is a key into the
 * IndexedDB store holding the `File` handle.
 */

export type QueueItemStatus =
  | 'pending'
  | 'presigned'
  | 'uploaded'
  | 'done'
  | 'failed'
  /**
   * The bytes are gone and no retry will bring them back — see `SourceGone`.
   * Distinct from 'failed' because the remedy is different: a failed item
   * wants another attempt, a stale one wants the file picked again.
   */
  | 'stale';

export type QueueItem = {
  /** Local id, stable across restarts. */
  id: string;
  eventId: string;
  /** Opaque to this module; only `Deps` knows how to turn it into bytes. */
  source: string;
  name: string;
  size: number;
  mime: string;
  status: QueueItemStatus;
  attempts: number;
  photoId?: string;
  uploadUrl?: string;
  headers?: Record<string, string>;
  /** When the presigned URL stops working. */
  expiresAt?: number;
  error?: string;
};

export type QueueState = { items: QueueItem[] };

export type PresignRequest = { name: string; size: number; type: string };
export type PresignResponse = {
  photoId: string;
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
};

/**
 * The source cannot be read and never will be again.
 *
 * Both clients can hit this and it is not exotic. On the web a `File` from
 * `<input type=file>` is a reference to a file on disk carrying a snapshot of
 * its state; the File API requires a read to fail once the underlying storage
 * no longer matches that snapshot, which is what happens when iOS reclaims the
 * temp copy the photo picker made. On native, the asset can be deleted from
 * the camera roll between queueing and upload.
 *
 * Retrying costs a round trip and cannot succeed, so this skips straight to
 * `stale` and asks a human for the file again.
 */
export class SourceGone extends Error {
  constructor(message = 'source is no longer readable') {
    super(message);
    this.name = 'SourceGone';
  }
}

export type Deps = {
  presign(eventId: string, files: PresignRequest[]): Promise<PresignResponse[]>;
  upload(item: QueueItem): Promise<void>;
  complete(photoId: string): Promise<unknown>;
  save(state: QueueState): Promise<void>;
  now?(): number;
};

/** Higher hurts throughput on cellular and multiplies memory pressure. */
export const CONCURRENCY = 3;
/** Beyond this a file is almost certainly not going to succeed on its own. */
export const MAX_ATTEMPTS = 4;
/** Re-presign rather than upload if the URL is this close to expiring. */
const EXPIRY_MARGIN_MS = 30_000;

export class UploadQueue {
  private items: QueueItem[];
  private running = false;
  /**
   * Set only when a grant expired and the item went back for a fresh one.
   *
   * Kept separate from ordinary failure on purpose: an expired URL should be
   * retried immediately, because the photo is fine and only the grant went
   * stale, whereas a failed upload should wait for the next run. Conflating
   * them burns every retry attempt in a single tight loop with no backoff —
   * which is what this did before the resume tests caught it.
   */
  private needsRepresign = false;

  constructor(
    private readonly deps: Deps,
    state: QueueState = { items: [] },
  ) {
    this.items = state.items;
  }

  get state(): QueueState {
    return { items: this.items };
  }

  get pendingCount(): number {
    return this.items.filter(
      (i) => i.status !== 'done' && i.status !== 'failed' && i.status !== 'stale',
    ).length;
  }

  get doneCount(): number {
    return this.items.filter((i) => i.status === 'done').length;
  }

  get failedCount(): number {
    return this.items.filter((i) => i.status === 'failed').length;
  }

  /** Items whose bytes vanished, and which therefore need re-picking. */
  get staleItems(): QueueItem[] {
    return this.items.filter((i) => i.status === 'stale');
  }

  /**
   * Forgets items so they can be queued again.
   *
   * The web client calls this when someone re-picks files that had gone stale:
   * without it the dedupe in `add` would recognise the same source and drop
   * the replacement on the floor.
   */
  forget(sources: string[]): void {
    const drop = new Set(sources);
    this.items = this.items.filter((i) => !drop.has(i.source));
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  add(eventId: string, files: Omit<QueueItem, 'status' | 'attempts' | 'eventId'>[]) {
    for (const file of files) {
      // Same asset queued twice in one session is a double-tap, not intent.
      if (this.items.some((i) => i.source === file.source && i.eventId === eventId)) {
        continue;
      }
      this.items.push({ ...file, eventId, status: 'pending', attempts: 0 });
    }
  }

  /** Drops finished work so a resumed queue does not grow without bound. */
  prune(): void {
    this.items = this.items.filter((i) => i.status !== 'done');
  }

  /**
   * Works the queue until nothing is left runnable.
   *
   * Safe to call again after a crash or a cold start: items are picked up from
   * whatever state they were persisted in.
   */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.needsRepresign = false;
    try {
      await this.presignPending();

      let next = 0;
      const workable = this.items.filter((i) => i.status === 'presigned');
      const worker = async () => {
        while (next < workable.length) {
          const item = workable[next++]!;
          await this.push(item);
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, workable.length) }, worker),
      );

      // Only items sent back for a fresh grant, never failures.
      if (this.needsRepresign) {
        this.running = false;
        return this.run();
      }
    } finally {
      this.running = false;
      await this.deps.save(this.state);
    }
  }

  /** One presign call per event covers the whole pending batch. */
  private async presignPending(): Promise<void> {
    const pending = this.items.filter((i) => i.status === 'pending');
    if (pending.length === 0) return;

    const byEvent = new Map<string, QueueItem[]>();
    for (const item of pending) {
      const list = byEvent.get(item.eventId) ?? [];
      list.push(item);
      byEvent.set(item.eventId, list);
    }

    for (const [eventId, items] of byEvent) {
      try {
        const granted = await this.deps.presign(
          eventId,
          items.map((i) => ({ name: i.name, size: i.size, type: i.mime })),
        );
        items.forEach((item, index) => {
          const grant = granted[index];
          if (!grant) return;
          item.photoId = grant.photoId;
          item.uploadUrl = grant.url;
          item.headers = grant.headers;
          item.expiresAt = new Date(grant.expiresAt).getTime();
          item.status = 'presigned';
        });
      } catch (err) {
        for (const item of items) this.fail(item, err);
      }
      await this.deps.save(this.state);
    }
  }

  private async push(item: QueueItem): Promise<void> {
    // A URL that expired while the phone was locked is not a failure — the
    // photo is fine, the grant went stale. Send it back for a new one.
    if (item.expiresAt && item.expiresAt - this.now() < EXPIRY_MARGIN_MS) {
      item.status = 'pending';
      delete item.uploadUrl;
      delete item.expiresAt;
      this.needsRepresign = true;
      await this.deps.save(this.state);
      return;
    }

    try {
      await this.deps.upload(item);
      item.status = 'uploaded';
      await this.deps.save(this.state);

      await this.deps.complete(item.photoId!);
      item.status = 'done';
      delete item.error;
    } catch (err) {
      this.fail(item, err);
    }
    await this.deps.save(this.state);
  }

  private fail(item: QueueItem, err: unknown): void {
    item.attempts += 1;
    item.error = err instanceof Error ? err.message : String(err);
    if (err instanceof SourceGone) {
      // No attempt will find the bytes again, so do not spend three more.
      item.status = 'stale';
      return;
    }
    // Back to pending so the next run retries; retries are safe because the
    // server addresses objects by content.
    item.status = item.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
  }
}
