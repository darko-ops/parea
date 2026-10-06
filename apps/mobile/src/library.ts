/**
 * The photo library, as the app's own pickers and the upload queue read it:
 * whether it may be read, the most recent photographs for somebody choosing by
 * eye, and turning a chosen photo into a file the queue can send.
 *
 * Nothing here decides which photos somebody means. It used to: a pass over
 * the library by capture time and location fed the auto-selection that ticked
 * photos on somebody's behalf, and that is gone — people choose their own.
 */

import {
  Asset,
  AssetField,
  MediaType,
  Query,
  getPermissionsAsync,
  requestPermissionsAsync,
  type PermissionResponse,
} from 'expo-media-library';
import { Directory, File, Paths } from 'expo-file-system';

/** At most this many library reads in flight at once. */
const CONCURRENCY = 8;

/** A span of time, ms since the epoch, inclusive at both ends. */
export type Window = { start: number; end: number };

export type LibraryAccess = 'granted' | 'limited' | 'denied' | 'undetermined';

export async function libraryAccess(): Promise<LibraryAccess> {
  return classify(await getPermissionsAsync(false, ['photo']));
}

/**
 * Asked by the new-roll picker, which is nothing but the library. Adding to an
 * existing roll uses the system picker instead and needs no permission.
 */
export async function requestLibraryAccess(): Promise<LibraryAccess> {
  return classify(await requestPermissionsAsync(false, ['photo']));
}

function classify(response: PermissionResponse): LibraryAccess {
  if (!response.granted) {
    return response.canAskAgain ? 'undetermined' : 'denied';
  }
  // iOS and Android 14+ let someone grant access to a hand-picked subset.
  // Treated as a first-class state, not an error — the picker shows what was
  // granted, it just cannot see the rest.
  return response.accessPrivileges === 'limited' ? 'limited' : 'granted';
}

async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** One photograph on the phone, as a picker needs it. */
export type LibraryPhoto = {
  id: string;
  /** Displayable on this device. Not an upload source — see `resolveForUpload`. */
  uri: string;
  /** When the shutter went, ms. Null for an asset the store has no time for. */
  takenAt: number | null;
};

/**
 * The most recent photographs, for somebody choosing by eye.
 *
 * Ids, times and a URI and nothing else — no location lookup, which is the
 * expensive call and which a grid somebody is scrolling needs none of.
 *
 * Paged, with a screenful as the bound: `after` is the id to continue from, so a picker can fetch more as somebody
 * scrolls instead of reading a five-year camera roll to draw twelve tiles.
 */
export async function recentPhotos(
  limit: number,
  after?: string,
): Promise<{ photos: LibraryPhoto[]; next: string | null }> {
  const metas = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    // Newest first: a picker opens on last night, not on 2019.
    .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
    .exeForMetadata();

  /*
   * Paged in JavaScript rather than in the query.
   *
   * `Query` has no cursor, so the page has to be cut after the fact. The
   * metadata pass is the cheap one — no location, no file access — and the
   * expensive part is the `getUri` below, which is what the slice bounds.
   */
  const from = after ? metas.findIndex((m) => m.id === after) + 1 : 0;
  const page = metas.slice(from, from + limit);

  const photos = await pooled(page, CONCURRENCY, async (meta) => ({
    id: meta.id,
    uri: await new Asset(meta.id).getUri(),
    takenAt: meta.creationTime ?? null,
  }));

  return {
    photos,
    next: from + limit < metas.length ? (page.at(-1)?.id ?? null) : null,
  };
}

/**
 * The window a set of chosen photographs covers.
 *
 * What the `WHEN` picker used to ask for, answered by the photographs instead.
 * Somebody who has just chosen the evening's pictures has already said when it
 * was, far more precisely than a six-hour box resolved from "last night" — and
 * asking them to say it again was the screen not reading what it had been
 * handed.
 *
 * Null when nothing chosen has a time on it, which is an album with no date
 * rather than an error: most events have none, and the card dates itself by its
 * earliest photograph.
 */
export function windowOf(photos: LibraryPhoto[]): Window | null {
  const times = photos.map((p) => p.takenAt).filter((t): t is number => t != null);
  if (times.length === 0) return null;
  return { start: Math.min(...times), end: Math.max(...times) };
}

/**
 * Where copies of chosen photographs wait to be uploaded.
 *
 * The cache rather than documents: these are reproducible from the library, so
 * iOS is welcome to reclaim them under pressure — which is exactly the bargain
 * `Paths.cache` describes. They are deleted once nothing needs them — the queue
 * has let the item go and no stand-in in a roll is drawing it — by
 * `releaseCopies`, and anything that slipped past that by `sweepOutbox`.
 */
export const OUTBOX = 'outbox';

/**
 * The mark on an id this app invented rather than read off the library.
 *
 * The system picker hands back files, not assets: there is no library id to
 * carry, so the queue item gets one made up here. That distinction has to
 * survive into the queue, because `uploadItem` re-reads an item's id as a
 * library id when it needs the bytes a second time — and handing
 * `new Asset()` a number this file invented is what raised
 *
 *   AssetNotFoundException: Asset not found: 1790480378140-0
 *
 * on every single photograph added through the picker. A prefix no library id
 * can have is what lets that path ask the question instead of assuming.
 */
export const PICKED = 'picked:';

/** False for an id invented by `PICKED` — nothing in the library answers to it. */
export function isLibraryAsset(id: string): boolean {
  return !id.startsWith(PICKED);
}

/**
 * The outbox, made if it is not there.
 *
 * Idempotent, and called per copy rather than once at startup, because
 * `Paths.cache` is a directory iOS empties whenever it likes.
 */
function outboxDir(): Directory {
  const dir = new Directory(Paths.cache, OUTBOX);
  dir.create({ idempotent: true });
  return dir;
}

/**
 * Where one id's copy lives.
 *
 * Named by the id, not by the filename. Two photographs taken a second apart
 * can share `IMG_0042.HEIC` across albums, and a collision here would upload
 * one of them twice. The id is unique and is `ph://<uuid>/L0/001` on iOS, so
 * its slashes and colons come out before it can be read as a path of its own.
 */
function outboxFile(id: string, filename: string): File {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, '_');
  return new File(outboxDir(), `${safe}-${filename}`);
}

/**
 * Turns library ids into files the upload queue can send.
 *
 * ## Why this copies rather than handing over the asset's own path
 *
 * `getUri()` returns a real `file://` URL — `contentEditingInput
 * .fullSizeImageURL`, which points *inside the Photos library container* and is
 * reached through a temporary grant scoped to this app in the foreground.
 *
 * The uploader runs a **background** `URLSession`, which means an out-of-process
 * iOS daemon opens the file. That daemon does not hold the grant, so the
 * transfer failed before a byte moved — and because `uploadItem` reads any
 * throw as "no network", it surfaced as "3 waiting for a connection, they are
 * saved and will go up on their own", which was three kinds of wrong: they were
 * not waiting, nothing was saved, and they were never going up.
 *
 * Copying into our own sandbox fixes it at the cause. It buys two other things
 * worth having: the bytes survive somebody deleting the photograph out of their
 * library mid-queue, and the size is read off the copy that is actually being
 * sent rather than off a file the sender cannot open.
 */
export async function sandboxCopy(
  assetId: string,
): Promise<{ uri: string; name: string; size: number }> {
  const asset = new Asset(assetId);
  const info = await asset.getInfo();
  const uri = await asset.getUri();

  const copy = outboxFile(assetId, info.filename);
  if (!copy.exists) await new File(uri).copy(copy);

  return { uri: copy.uri, name: info.filename, size: copy.size ?? 0 };
}

/**
 * The same copy, for a file that came from the system picker.
 *
 * ## Why the picker needs this at all
 *
 * `launchImageLibraryAsync` already returns a `file://` URL this app can read,
 * which is why the picker path handed it straight to the queue. Two things
 * were wrong with that, and both of them were fatal:
 *
 *   - **`uploadItem` does not trust a source outside the outbox**, and it is
 *     right not to: a persisted queue can carry a path into the Photos
 *     container that a background `URLSession` can never open. So it repaired
 *     every picked file by re-reading `item.id` as a library id — and the
 *     picker's items carry an invented one. Every photograph added this way
 *     went stale on its first attempt with "17 could not be read — add them
 *     again", and adding them again did the identical thing.
 *   - **The picker's own file is temporary.** It lives in `tmp`, which iOS
 *     reclaims without warning, so even the repair-free version was a race
 *     against a directory the app does not own.
 *
 * Copying into the outbox answers both: the source is ours, it is what a
 * background session can open, and it is the file the size is measured on
 * rather than the picker's `fileSize`, which is optional and defaulted to `0`
 * here — a number `/api/events/[id]/uploads` refuses outright.
 */
export async function adoptIntoOutbox(
  id: string,
  uri: string,
  filename: string,
): Promise<{ uri: string; name: string; size: number }> {
  const copy = outboxFile(id, filename);
  if (!copy.exists) await new File(uri).copy(copy);

  return { uri: copy.uri, name: filename, size: copy.size ?? 0 };
}

/** True for a path this app owns, and therefore one a background session can read. */
export function inOutbox(uri: string): boolean {
  return uri.includes(`/${OUTBOX}/`);
}

/**
 * A copy's name in the outbox, which is how two spellings of it are compared.
 *
 * Not the whole uri. The one a listing hands back and the one written into
 * the queue months ago are the same file and need not be the same string —
 * `/private/var` against `/var` on iOS, a space encoded or not — and a sweep
 * that mistook a queued copy for a stray would delete a photograph that has
 * not gone up yet. The names are unique by construction; see `outboxFile`.
 */
export function outboxName(uri: string): string {
  const last = uri.split('/').pop() ?? '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Delete copies nothing needs any more, unless the queue has taken them back.
 *
 * `queued` is the queue as it is on disk now, not as it was when these were
 * let go of: the suggestion screen names a copy by its library id, so the
 * same photograph added to a second roll reuses the file a first roll's
 * stand-in has just finished with.
 *
 * Only ever our own outbox, for the reason `uploadItem` gave when it was the
 * one doing this — a caller can point it at anything, and deleting a file
 * somebody else owns would be a fine way to eat a camera roll. Swallowed,
 * because a copy that outlives its use is litter in a directory iOS empties
 * under pressure, and there is no one to tell.
 */
export function releaseCopies(uris: Iterable<string>, queued: readonly string[]): void {
  const keep = new Set(queued.map(outboxName));
  for (const uri of uris) {
    if (!inOutbox(uri) || keep.has(outboxName(uri))) continue;
    try {
      const file = new File(uri);
      if (file.exists) file.delete();
    } catch {}
  }
}

/**
 * How old a copy nobody has claimed has to be before a sweep takes it.
 *
 * An hour, which is far longer than the gap it guards: a copy is made a moment
 * before its item is queued, and a sweep in that moment would find a file
 * the queue does not name yet.
 */
export const OUTBOX_STRAY_MS = 60 * 60 * 1000;

/**
 * Delete what the outbox is still holding that the queue does not name.
 *
 * `releaseCopies` deletes a copy when its stand-in goes, and a stand-in lives
 * as long as the app does — so a copy whose upload landed while the app was
 * closed, or in the minutes before it was swiped away, has nobody left to let
 * go of it. Called once, at launch, with the queue that is on disk.
 *
 * Old as well as unnamed, by the newer of the two times the file has, because
 * the queue can be a moment behind the outbox. And kept when it has neither
 * time: a stray that stays is a few megabytes in a cache the system empties,
 * and a photograph deleted before it went up is gone.
 */
export function sweepOutbox(queued: readonly string[], now: number = Date.now()): number {
  const dir = new Directory(Paths.cache, OUTBOX);
  if (!dir.exists) return 0;
  const keep = new Set(queued.map(outboxName));
  let swept = 0;
  for (const entry of dir.list()) {
    if (!(entry instanceof File) || keep.has(outboxName(entry.uri))) continue;
    try {
      const at = Math.max(entry.modificationTime ?? 0, entry.creationTime ?? 0);
      if (at === 0 || now - at < OUTBOX_STRAY_MS) continue;
      entry.delete();
      swept += 1;
    } catch {}
  }
  return swept;
}

export async function resolveForUpload(
  ids: string[],
): Promise<{ id: string; source: string; name: string; size: number; mime: string }[]> {
  return pooled(ids, CONCURRENCY, async (id) => {
    const copy = await sandboxCopy(id);

    return {
      id,
      // The queue's opaque source string: our copy, which is the only version
      // of these bytes a background session can open.
      source: copy.uri,
      name: copy.name,
      /*
       * The real size, read off the copy.
       *
       * This was `0`, with a comment claiming the queue sent the real size from
       * disk. It does not — it presigns with exactly the number handed to it —
       * and `/api/events/[id]/uploads` refuses any file whose size is not
       * greater than zero, so every upload was rejected before it started.
       */
      size: copy.size,
      mime: guessMime(copy.name),
    };
  });
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  switch (ext) {
    case 'heic':
    case 'heif':
      return 'image/heic';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'mov':
      return 'video/quicktime';
    case 'mp4':
      return 'video/mp4';
    default:
      return 'image/jpeg';
  }
}
