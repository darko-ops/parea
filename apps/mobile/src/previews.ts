/**
 * Photographs somebody is adding, drawn in the roll before the roll has them.
 *
 * The wait between choosing a picture and seeing it in the grid is three waits
 * stacked: the bytes leaving the phone, the server being told, and the deriver
 * making the renditions the grid draws. Until all three were over the album
 * looked exactly as it had before Add photos was pressed — a bar under the
 * cover, and nothing in the place the pictures were going. Every app people
 * post from has taught them that the thing they just posted is there at once,
 * so an album that stays empty reads as one that did not take them.
 *
 * So the grid leads with the phone's own copy of each one, dimmed and marked,
 * until the real photograph with the same id is in the feed — at which point
 * the stand-in goes and the photograph takes its place.
 *
 * Pure, and kept out of `App.tsx`, so it can be tested without a renderer.
 * Nothing here imports React Native: the one platform question — which uri a
 * phone can draw — is asked by the caller and handed in.
 */

import type { QueueItem } from '@parea/upload';

/**
 * Where one stand-in is, as far as the person adding it needs to know.
 *
 * Four, not the queue's six. `pending`, `presigned` and `uploaded` are three
 * steps of one thing from where somebody is sitting — the picture is leaving
 * the phone — and `processing` is the one the queue cannot name, because the
 * queue forgets an item the moment its bytes are accepted: `prune` drops every
 * `done` item at the end of a run, a good while before the deriver has been.
 */
export type PreviewState = 'uploading' | 'processing' | 'failed' | 'stale';

export type Preview = {
  /** The queue's local id. Stable across restarts, so it is the tile's key. */
  id: string;
  /** Something this phone can draw: the outbox copy, or the library asset. */
  uri: string;
  /**
   * The queue item's own file, which is what `uri` draws on Android and from
   * the picker — and so a file that has to outlive the upload. `uploadItem`
   * used to delete it the moment the bytes landed, and the stand-in drew from
   * a decoded image that was gone the first time the roll was left and opened
   * again. It is deleted when the stand-in goes now; see `heldCopies`.
   */
  copy: string;
  /** The server's name for it, once a presign has given it one. */
  photoId?: string;
  state: PreviewState;
  /**
   * How far through leaving the phone, as a fraction, where the queue says.
   *
   * The queue reports stages rather than bytes, so this is a stage drawn as a
   * length — enough for a line along the foot of a tile to be seen moving.
   * Null where there is nothing to measure.
   */
  progress: number | null;
  /** When it was first seen as processing, ms. What `PROCESSING_GIVE_UP_MS` counts from. */
  processingSince?: number;
};

/**
 * How long a stand-in may wait for the deriver before it stops waiting.
 *
 * Deliveries to the deriver are paced one at a time, so twenty photographs
 * really can take a minute or two to all appear. Past five, the server has
 * decided something this phone was not told — a file it could not decode, a
 * photograph taken down — and a dimmed tile that says "Processing" for ever is
 * a promise nobody is keeping. It goes; the feed is the truth.
 */
export const PROCESSING_GIVE_UP_MS = 5 * 60 * 1000;

/** The queue's stage, drawn as a length. */
const STAGE: Record<'pending' | 'presigned' | 'uploaded', number> = {
  pending: 0.1,
  presigned: 0.4,
  uploaded: 0.85,
};

function stateOf(item: QueueItem): PreviewState {
  switch (item.status) {
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
 * The stand-ins after one more look at the queue and the feed.
 *
 * `was` is the last answer, newest first, and it is load-bearing rather than a
 * cache: an item the queue has pruned is still a photograph on its way, and
 * the only place left that remembers it is here.
 *
 * - An item of this roll's in the queue becomes, or stays, a stand-in.
 * - One that has left the queue with a photo id and without failing was
 *   finished and pruned, so it is processing until the feed has it.
 * - One that left any other way was forgotten — a stale item somebody agreed
 *   to let go of — and goes with it.
 * - Anything whose photograph is in the feed goes. That is the replacement.
 *
 * New ones go on top in reverse queue order, which is the grid's order: a roll
 * is a stack with its latest addition on top, and the picker queues photographs
 * in the order they were tapped. Ones already drawn keep their place, so a
 * tile does not move under somebody's thumb because the queue rewrote itself.
 */
export function nextPreviews(
  was: readonly Preview[],
  items: readonly QueueItem[],
  eventId: string,
  inFeed: ReadonlySet<string>,
  now: number,
  uriOf: (item: QueueItem) => string,
): Preview[] {
  const queued = new Map<string, QueueItem>();
  for (const item of items) {
    if (item.eventId === eventId) queued.set(item.id, item);
  }

  const shown = (preview: Preview) => !(preview.photoId && inFeed.has(preview.photoId));

  const fresh = (item: QueueItem, before?: Preview): Preview => {
    const state = stateOf(item);
    return {
      id: item.id,
      // Kept once chosen: a tile drawn from one file and then told to draw
      // another flickers through a blank for no reason anybody can see.
      uri: before?.uri ?? uriOf(item),
      copy: before?.copy ?? item.source,
      photoId: item.photoId,
      state,
      progress:
        item.status === 'pending' || item.status === 'presigned' || item.status === 'uploaded'
          ? STAGE[item.status]
          : null,
      processingSince:
        state === 'processing' ? (before?.processingSince ?? now) : undefined,
    };
  };

  const kept: Preview[] = [];
  for (const before of was) {
    const item = queued.get(before.id);
    if (item) {
      kept.push(fresh(item, before));
      continue;
    }
    // Gone from the queue. Finished and pruned, or let go of.
    if (!before.photoId || before.state === 'failed' || before.state === 'stale') continue;
    kept.push({
      ...before,
      state: 'processing',
      progress: null,
      processingSince: before.processingSince ?? now,
    });
  }

  const known = new Set(was.map((preview) => preview.id));
  const added: Preview[] = [];
  for (const item of queued.values()) {
    if (!known.has(item.id)) added.push(fresh(item));
  }
  added.reverse();

  const next = [...added, ...kept].filter(
    (preview) =>
      shown(preview) &&
      !(
        preview.state === 'processing' &&
        preview.processingSince !== undefined &&
        now - preview.processingSince > PROCESSING_GIVE_UP_MS
      ),
  );
  /*
   * The same list back when nothing moved. The queue saves several times a
   * second while it runs, and a new array each time is a new `data` for a grid
   * of two hundred photographs that has nothing new to draw.
   */
  return sameAs(was, next) ? (was as Preview[]) : next;
}

function sameAs(a: readonly Preview[], b: readonly Preview[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.id === b[i]!.id &&
        x.uri === b[i]!.uri &&
        x.copy === b[i]!.copy &&
        x.photoId === b[i]!.photoId &&
        x.state === b[i]!.state &&
        x.progress === b[i]!.progress &&
        x.processingSince === b[i]!.processingSince,
    )
  );
}

/**
 * Every roll's stand-ins, by event id.
 *
 * Held by the app rather than by the roll, and that is the whole of what this
 * shape is for. The roll's screen used to keep its own, so leaving it threw
 * them away — and a stand-in whose upload has finished is remembered by nobody
 * else: the queue prunes it, and the feed does not have it yet. Coming back to
 * a roll thirty seconds after adding twenty photographs showed an album that
 * had apparently not taken them, which is the thing stand-ins exist to stop.
 */
export type PreviewsByEvent = Readonly<Record<string, readonly Preview[]>>;

const NOTHING_IN_FEED: ReadonlySet<string> = new Set();

/**
 * `nextPreviews`, for every roll at once.
 *
 * Every roll the queue has work for, and every roll already holding a
 * stand-in — the second because a pruned item is in no queue, and its roll
 * would otherwise never be looked at again. `feeds` is the last feed seen for
 * each roll; one never opened has none, and its stand-ins wait for the give-up
 * instead.
 *
 * The same object back when no roll's list moved, for the reason
 * `nextPreviews` gives: this runs on every queue save.
 */
export function nextPreviewsByEvent(
  was: PreviewsByEvent,
  items: readonly QueueItem[],
  feeds: ReadonlyMap<string, ReadonlySet<string>>,
  now: number,
  uriOf: (item: QueueItem) => string,
): PreviewsByEvent {
  const events = new Set([...Object.keys(was), ...items.map((item) => item.eventId)]);
  const next: Record<string, readonly Preview[]> = {};
  let moved = false;
  for (const eventId of events) {
    const before = was[eventId] ?? [];
    const after = nextPreviews(
      before,
      items,
      eventId,
      feeds.get(eventId) ?? NOTHING_IN_FEED,
      now,
      uriOf,
    );
    if (after !== before) moved = true;
    if (after.length > 0) next[eventId] = after;
    else if (eventId in was) moved = true;
  }
  return moved ? next : was;
}

/**
 * The files something still needs: a queued item's bytes, or a stand-in's.
 *
 * What is held one moment and not the next is what may be deleted — the queue
 * has let the item go and no tile is drawing it. Both, rather than either:
 * a photograph in the feed while its item is still waiting to be pruned is
 * finished with as a stand-in and not yet as an upload, and the other way
 * round is the whole deriver's wait.
 */
export function heldCopies(
  items: readonly QueueItem[],
  byEvent: PreviewsByEvent,
): Set<string> {
  const held = new Set(items.map((item) => item.source));
  for (const previews of Object.values(byEvent)) {
    for (const preview of previews) held.add(preview.copy);
  }
  return held;
}

/** Whether any stand-in is still on its way, which is a reason to keep asking. */
export function previewsInFlight(previews: readonly Preview[]): boolean {
  return previews.some((p) => p.state === 'uploading' || p.state === 'processing');
}

/** What the tile says over the picture. */
export function previewLabel(state: PreviewState): string {
  switch (state) {
    case 'uploading':
      return 'Uploading';
    case 'processing':
      return 'Processing';
    case 'failed':
      return 'Didn’t upload';
    case 'stale':
      return 'Add again';
  }
}
