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

export {
  ACCEPTED_MIME,
  ACCEPT_ATTRIBUTE,
  acceptedMime,
  type AcceptedMime,
} from './accepted';

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
  /**
   * The underlying reason, where `error` is the note a person reads.
   *
   * Kept because the two are not the same thing and conflating them cost real
   * debugging time: every transport failure arrives here as `Offline`, whose
   * note is "waiting for a connection" — correct advice when the network is
   * actually gone, and a dead end when the truth is that the file could not be
   * read. The note stays reassuring; this is what says why.
   */
  cause?: string;
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
/**
 * The network is not there. Nothing is wrong with this item.
 *
 * Design §1's table promises "offline queueing at a bad-signal venue" as
 * something native has and the web does not, and without this the queue does
 * the opposite: a venue with no signal burns all four attempts in a few
 * hundred milliseconds and marks two hundred photos permanently failed, at
 * exactly the moment the design says the native client earns its place.
 *
 * So an offline error consumes no attempt and stops the run. The item stays
 * pending and the caller starts the queue again when there is some reason to
 * think the answer will differ — the app coming back to the foreground, or a
 * backoff timer. Retrying inside the run would be a tight loop against a
 * network that is not there.
 *
 * The platform layer decides what counts, and errs towards this: a `fetch`
 * that rejects rather than answering is indistinguishable from no signal, and
 * being wrong here costs a stalled queue the person can restart, where being
 * wrong the other way costs their photos.
 */
export class Offline extends Error {
  constructor(message = 'no network') {
    super(message);
    this.name = 'Offline';
  }
}

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
  /**
   * Injectable for tests, which must not spend the retry backoff in real
   * seconds. Defaults to `setTimeout`.
   */
  sleep?(ms: number): Promise<void>;
};

/** Higher hurts throughput on cellular and multiplies memory pressure. */
export const CONCURRENCY = 3;
/** Beyond this a file is almost certainly not going to succeed on its own. */
export const MAX_ATTEMPTS = 4;
/** Re-presign rather than upload if the URL is this close to expiring. */
const EXPIRY_MARGIN_MS = 30_000;
/**
 * How long a run waits before re-attempting what just failed.
 *
 * Multiplied by the round, so 1s, 2s, 3s. Long enough that a blip is waited
 * out rather than raced, short enough that somebody watching the bar does not
 * read the pause as the upload having stopped.
 */
export const RETRY_BACKOFF_MS = 1000;
/**
 * How many times one run will go back for fresh grants.
 *
 * One covers the real case — the phone was locked and the grants went stale.
 * More than that means the fresh grant was unusable too, which is a wrong
 * clock or a broken server, and looping on it is a spin with nothing logged.
 */
export const MAX_REPRESIGN_ROUNDS = 2;

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
  /**
   * Set when the run stopped because the network was gone rather than because
   * the work finished. The UI needs the difference: "waiting for a
   * connection" and "3 didn't upload" ask for opposite things from a person.
   */
  private paused = false;

  /**
   * Which album the last run was working, if it was working one.
   *
   * Not persisted: it describes a run, not the queue, and a resumed queue has
   * not run yet. `undefined` means the run was unscoped, which is the browser's
   * case and the answer that makes `waitingFor` behave as it always did.
   */
  private scope: string | undefined;

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

  /**
   * The first underlying reason anything gave, if anything did.
   *
   * For a screen that wants to say more than "waiting for a connection" when
   * the wait is not going to end. One is enough: a queue of twenty photographs
   * stopped by one cause does not need it printed twenty times.
   */
  get cause(): string | null {
    return this.items.find((i) => i.cause)?.cause ?? null;
  }

  get failedCount(): number {
    return this.items.filter((i) => i.status === 'failed').length;
  }

  /** True when the last run stopped for want of a network, not for want of work. */
  get waitingForNetwork(): boolean {
    return this.paused && this.pendingCount > 0;
  }

  /** Items whose bytes vanished, and which therefore need re-picking. */
  get staleItems(): QueueItem[] {
    return this.items.filter((i) => i.status === 'stale');
  }

  /**
   * The same two questions, asked about one album.
   *
   * The counts above are the whole queue's, which is the right answer for a
   * screen that is about the queue and the wrong one for a screen that is about
   * an album. Nothing is pruned but `done`, so a failure survives every later
   * run — and a screen reading the global count captions a perfectly good
   * upload into one album with six failures that belong to another. Which is
   * exactly what it looks like from the outside: a line that will not go away
   * and has nothing to do with what you just did.
   */
  failedIn(eventId: string): QueueItem[] {
    return this.items.filter((i) => i.eventId === eventId && i.status === 'failed');
  }

  staleIn(eventId: string): QueueItem[] {
    return this.items.filter((i) => i.eventId === eventId && i.status === 'stale');
  }

  /** Still on its way up, in one album. The number a progress bar wants. */
  pendingIn(eventId: string): number {
    return this.items.filter(
      (i) =>
        i.eventId === eventId &&
        i.status !== 'done' &&
        i.status !== 'failed' &&
        i.status !== 'stale',
    ).length;
  }

  doneIn(eventId: string): number {
    return this.items.filter((i) => i.eventId === eventId && i.status === 'done').length;
  }

  /**
   * Stopped for want of a network, with work left in *this* album.
   *
   * Three things have to be true, and the middle one is the interesting one.
   * The unscoped form says yes whenever anything anywhere is still pending
   * after a pause — which on a screen about one album means telling somebody
   * their photographs are waiting for a signal when the thing waiting belongs
   * to a different evening, and when the album they are looking at has not been
   * attempted at all.
   *
   * So the last run's scope is remembered. An album nobody has tried yet is not
   * waiting for a network; it is waiting for somebody to open it.
   */
  waitingFor(eventId: string): boolean {
    if (!this.paused) return false;
    if (this.scope !== undefined && this.scope !== eventId) return false;
    return this.pendingIn(eventId) > 0;
  }

  /**
   * Spends a fresh set of attempts on everything that gave up.
   *
   * `failed` is terminal after `MAX_ATTEMPTS`, and it has to be: a queue that
   * retried forever would sit in somebody's pocket burning a battery on a file
   * the server keeps refusing. But terminal is not the same as permanent, and
   * the code had no way back at all — four attempts against a condition that
   * has since changed (a fixed build, a different network, a source that can be
   * copied out of the library again) were the end of it.
   *
   * A person pressing "try again" *is* the new information. Attempts go back to
   * zero rather than merely being allowed one more, because the count exists to
   * stop an unattended loop, and this run is not unattended.
   *
   * Stale items are deliberately untouched: their bytes are gone, and another
   * four attempts would find them just as gone. `forget` is the remedy there.
   */
  retryFailed(eventId?: string): number {
    let woken = 0;
    for (const item of this.items) {
      if (item.status !== 'failed') continue;
      if (eventId && item.eventId !== eventId) continue;
      item.status = 'pending';
      item.attempts = 0;
      woken += 1;
    }
    return woken;
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

  /**
   * Items this run failed and could sensibly attempt again.
   *
   * `attempts > 0` is what tells them from the other kinds of `pending`. An
   * item sent back for a fresh grant spent nothing and belongs to the
   * represign count; an item no presign has reached yet is not a retry, and
   * treating it as one would loop without consuming anything — the same spin
   * the represign bound exists to stop.
   */
  private retryable(eventId?: string): number {
    return this.items.filter(
      (i) =>
        (i.status === 'pending' || i.status === 'uploaded') &&
        i.attempts > 0 &&
        i.attempts < MAX_ATTEMPTS &&
        (!eventId || i.eventId === eventId),
    ).length;
  }

  private wait(ms: number): Promise<void> {
    return this.deps.sleep
      ? this.deps.sleep(ms)
      : new Promise((resolve) => setTimeout(resolve, ms));
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
   *
   * ## `eventId`, and why a caller would pass one
   *
   * The queue holds work for every album a device has uploaded into, and it
   * will happily work all of it — which is right for a client that can act for
   * any album at any time, and wrong for one whose credentials belong to the
   * album on screen. The phone is the second kind: it presigns and completes
   * with the link token of the album it is looking at, so a leftover item from
   * another album gets sent with the wrong credential and is refused.
   *
   * Scoped, the leftovers are not touched — they are not lost either. They sit
   * in the saved state, which every run writes back whole, and they go up when
   * somebody opens the album they belong to. That is the honest reading of an
   * upload anyway: it happens in the room you are standing in.
   *
   * Omitting it keeps the old behaviour, which is what the browser client
   * wants.
   */
  async run(eventId?: string): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    // Remembered for `waitingFor`, which has to tell "there is no signal" apart
    // from "nobody has opened that album yet".
    this.scope = eventId;
    try {
      /*
       * Rounds, until there is nothing left this run can usefully do.
       *
       * Two quite different reasons to go round again, counted separately
       * because only one of them spends anything.
       *
       * A grant that went stale while the phone was locked costs no attempt,
       * so it needs a bound of its own or it is a spin: a server handing back
       * an already-expired grant, or a device with a badly wrong clock, would
       * loop here forever with nothing consumed and nothing logged.
       *
       * A failed upload does spend an attempt, and this loop is the only thing
       * that ever spends the second one. `MAX_ATTEMPTS` reads like four tries
       * and used to buy exactly one: the round loop stopped the moment nothing
       * needed re-presigning, which left a failed item `pending` for a next run
       * that neither client makes. Both call `run` once per batch and neither
       * watches for leftovers, so one blip parked a photograph until somebody
       * reopened the album — and said nothing on the way out, because `pending`
       * with attempts to spare is neither `failed` nor waiting for a network,
       * so the status line cleared itself and the bar emptied. Eight photos
       * chosen, four in the album, no error anywhere.
       */
      let represigns = 0;
      let retries = 0;
      for (;;) {
        this.needsRepresign = false;
        await this.presignPending(eventId);

        let next = 0;
        const workable = this.items.filter(
          (i) =>
            (i.status === 'presigned' || i.status === 'uploaded') &&
            (!eventId || i.eventId === eventId),
        );
        const worker = async () => {
          // Stops the other workers too: once one request has found no
          // network, the remaining hundred and ninety-nine will not find one.
          while (next < workable.length && !this.paused) {
            const item = workable[next++]!;
            await this.push(item);
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, workable.length) }, worker),
        );

        // The network is gone. Presigning again would walk into the same wall,
        // and the items are untouched and pending for whenever it is back.
        if (this.paused) break;

        if (this.needsRepresign && ++represigns > MAX_REPRESIGN_ROUNDS) break;

        const again = this.retryable(eventId);
        if (!this.needsRepresign && again === 0) break;

        if (again > 0) {
          // A backstop only: an item that reaches `MAX_ATTEMPTS` becomes
          // `failed` and stops being retryable, so `again` runs out first.
          if (++retries >= MAX_ATTEMPTS) break;
          await this.wait(RETRY_BACKOFF_MS * retries);
        }
      }
    } finally {
      this.running = false;
      await this.deps.save(this.state);
    }
  }

  /** One presign call per event covers the whole pending batch. */
  private async presignPending(eventId?: string): Promise<void> {
    const pending = this.items.filter(
      (i) => i.status === 'pending' && (!eventId || i.eventId === eventId),
    );
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
        // Nothing else will presign either.
        if (this.paused) break;
      }
      await this.deps.save(this.state);
    }
  }

  private async push(item: QueueItem): Promise<void> {
    /*
     * `uploaded` means the bytes are in storage and nobody has been told.
     *
     * It was a state written and never read: not `pending`, so nothing
     * presigned it; not `presigned`, so nothing pushed it. A run that ended
     * between the PUT and the confirmation — a crash, a `complete` that came
     * back 500 — left the item there permanently. It counted as outstanding in
     * every progress bar for as long as the queue survived, and the photograph
     * reached the album only when the deriver gave up waiting half an hour
     * later and read the object anyway.
     *
     * What is outstanding for such an item is the confirmation, so that is all
     * this does for it. Sending the bytes a second time would be a second
     * object, a second row, and a second charge against the event's quota for
     * one photograph.
     */
    if (item.status !== 'uploaded') {
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
      } catch (err) {
        this.fail(item, err);
        await this.deps.save(this.state);
        return;
      }
      item.status = 'uploaded';
      await this.deps.save(this.state);
    }

    try {
      await this.deps.complete(item.photoId!);
      item.status = 'done';
      delete item.error;
    } catch (err) {
      // Same reasoning as above, for the failure that lands in the same place:
      // the bytes are up and only the word about them did not get through, so
      // the next attempt is another `complete`. `pending` would presign again
      // and re-upload a photograph that is already there.
      if (this.fail(item, err) === 'pending') item.status = 'uploaded';
    }
    await this.deps.save(this.state);
  }

  /** Records the failure and returns the state it left the item in. */
  private fail(item: QueueItem, err: unknown): QueueItemStatus {
    if (err instanceof Offline) {
      // No attempt was spent, because none was made. The item is untouched
      // apart from the note, and the run stops rather than eating the retry
      // budget of every remaining photo against a network that is not there.
      this.paused = true;
      item.error = 'waiting for a connection';
      // What actually threw. `Offline` is a reading of the failure, not a
      // report of it — see `cause`.
      if (err.message) item.cause = err.message;
      return item.status;
    }

    item.attempts += 1;
    item.error = err instanceof Error ? err.message : String(err);
    if (err instanceof SourceGone) {
      // No attempt will find the bytes again, so do not spend three more.
      item.status = 'stale';
      return item.status;
    }
    // Back to pending so this run, or the next one, tries again; retries are
    // safe because the server addresses objects by content.
    item.status = item.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    return item.status;
  }
}
