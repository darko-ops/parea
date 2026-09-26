/**
 * Reading the photo library for auto-selection — docs/design.md §7.1, §7.4.
 *
 * Two passes, because location lookups are the expensive call and there is no
 * point paying for one on every photo in a five-year camera roll:
 *
 *   1. query the media store by capture time — cheap, and the window already
 *      cuts it down to tens of assets;
 *   2. read location and screenshot status only for what survived.
 *
 * Nothing read here is uploaded. Capture times and locations decide *what to
 * offer*; the files that actually go up have their GPS stripped server-side
 * (design §7.6). The app knows where your photos were taken only in the sense
 * that your phone already does.
 */

import type { Candidate, Window } from '@parea/autoselect';
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
import { Platform } from 'react-native';

/** Guards against a pathological window over a huge library. */
const MAX_LOOKUPS = 600;
const CONCURRENCY = 8;

export type LibraryAccess = 'granted' | 'limited' | 'denied' | 'undetermined';

export async function libraryAccess(): Promise<LibraryAccess> {
  return classify(await getPermissionsAsync(false, ['photo']));
}

/**
 * The permission upgrade — asked when somebody presses Add photos, behind a
 * card of our own, and never cold.
 *
 * It used to come *after* a manual contribution. That placement was protecting
 * the right thing — a permission wall in front of a stranger is how a
 * permission gets refused forever — and it was wrong about when the value is
 * demonstrated: the person who has just scrolled a five-year camera roll
 * looking for last night has already paid the cost this removes, and being
 * told afterwards that it could have been avoided is a receipt rather than an
 * offer.
 *
 * What is kept is the part that was load-bearing. This is never the first
 * thing anybody sees, it is only asked where there is an event window to be
 * concrete about, and our own card comes first: saying no there costs nothing
 * and the system picker opens anyway, where saying no at the system prompt
 * costs auto-selection for good and is not re-askable in practice.
 */
export async function requestLibraryAccess(): Promise<LibraryAccess> {
  return classify(await requestPermissionsAsync(false, ['photo']));
}

function classify(response: PermissionResponse): LibraryAccess {
  if (!response.granted) {
    return response.canAskAgain ? 'undetermined' : 'denied';
  }
  // iOS and Android 14+ let someone grant access to a hand-picked subset.
  // Treated as a first-class state, not an error — auto-selection still works
  // over what was granted, it just cannot see the rest.
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

export type LibraryScan = {
  candidates: Candidate[];
  /** Lookups that threw — "could not look", never "no GPS". */
  locationErrors: number;
  truncated: boolean;
};

/**
 * Everything on the phone from the last few days, for session detection.
 *
 * `keep: 'newest'` is the whole reason this is not just a `scanWindow` call.
 * Over a window a human chose, which end gets dropped on truncation is
 * arbitrary. Over "the last three days" it is not: the run being looked for is
 * the most recent one, and keeping the oldest 600 of a heavy shooter's weekend
 * discards last night and offers Friday instead.
 */
export async function scanRecent(
  days: number,
  now: number = Date.now(),
): Promise<LibraryScan> {
  return scanWindow({ start: now - days * 24 * 60 * 60 * 1000, end: now }, 'newest');
}

export async function scanWindow(
  window: Window,
  keep: 'oldest' | 'newest' = 'oldest',
): Promise<LibraryScan> {
  const metas = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .gte(AssetField.CREATION_TIME, window.start)
    .lte(AssetField.CREATION_TIME, window.end)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: true })
    .exeForMetadata();

  const dated = metas.filter(
    (m): m is typeof m & { creationTime: number } => m.creationTime != null,
  );
  const truncated = dated.length > MAX_LOOKUPS;
  const wanted =
    keep === 'newest' ? dated.slice(-MAX_LOOKUPS) : dated.slice(0, MAX_LOOKUPS);

  let locationErrors = 0;

  const candidates = await pooled(wanted, CONCURRENCY, async (meta) => {
    const asset = new Asset(meta.id);
    let lat: number | null = null;
    let lon: number | null = null;

    try {
      const location = await asset.getLocation();
      if (location) {
        lat = location.latitude;
        lon = location.longitude;
      }
    } catch {
      // On Android this usually means ACCESS_MEDIA_LOCATION was not granted.
      // Distinguishing it from "this photo has no GPS" matters: conflating
      // them reports zero coverage on a healthy library and silently disables
      // the filter that makes the suggestion safe.
      locationErrors++;
    }

    let isScreenshot = false;
    if (Platform.OS === 'ios') {
      try {
        isScreenshot = (await asset.getMediaSubtypes()).includes('screenshot' as never);
      } catch {
        // Non-fatal: a screenshot has no GPS, so the location filter drops it
        // anyway whenever the filter is running at all.
      }
    }

    return {
      id: meta.id,
      createdAt: meta.creationTime,
      lat,
      lon,
      isScreenshot,
    } satisfies Candidate;
  });

  return { candidates, locationErrors, truncated };
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
 * Deliberately not `scanWindow`. That exists for auto-selection and pays for a
 * location lookup per asset so it can group them by where they were — which is
 * the expensive call, and a grid somebody is scrolling needs none of it. This
 * asks for ids, times and a URI and nothing else.
 *
 * Paged rather than bounded, because the bound `scanWindow` needs is a
 * protection against a pathological window and the bound here is a screenful:
 * `after` is the id to continue from, so a picker can fetch more as somebody
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
 * `Paths.cache` describes. They are deleted on a successful upload anyway; see
 * `uploadItem`.
 */
export const OUTBOX = 'outbox';

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
  const outbox = new Directory(Paths.cache, OUTBOX);
  // Idempotent: this runs per upload, and the directory survives between them
  // unless iOS has reclaimed it.
  outbox.create({ idempotent: true });

  const asset = new Asset(assetId);
  const info = await asset.getInfo();
  const uri = await asset.getUri();

  /*
   * Named by the asset, not by its filename.
   *
   * Two photographs taken a second apart can share `IMG_0042.HEIC` across
   * albums, and a collision here would upload one of them twice. The id is
   * unique and is `ph://<uuid>/L0/001` on iOS, so its slashes and colons come
   * out before it can be read as a path of its own.
   */
  const safe = assetId.replace(/[^A-Za-z0-9._-]/g, '_');
  const copy = new File(outbox, `${safe}-${info.filename}`);
  if (!copy.exists) await new File(uri).copy(copy);

  return { uri: copy.uri, name: info.filename, size: copy.size ?? 0 };
}

/** True for a path this app owns, and therefore one a background session can read. */
export function inOutbox(uri: string): boolean {
  return uri.includes(`/${OUTBOX}/`);
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
