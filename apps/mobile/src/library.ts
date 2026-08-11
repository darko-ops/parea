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
import { Platform } from 'react-native';

/** Guards against a pathological window over a huge library. */
const MAX_LOOKUPS = 600;
const CONCURRENCY = 8;

export type LibraryAccess = 'granted' | 'limited' | 'denied' | 'undetermined';

export async function libraryAccess(): Promise<LibraryAccess> {
  return classify(await getPermissionsAsync(false, ['photo']));
}

/**
 * The permission upgrade — offered *after* someone has contributed once.
 *
 * Same philosophy as the account ask: the prompt sits at the moment of
 * demonstrated value, not in front of the first upload. Until it is granted
 * the app uses the system picker, which needs no permission at all.
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

/** Turns library ids back into files the upload queue can send. */
export async function resolveForUpload(
  ids: string[],
): Promise<{ id: string; source: string; name: string; size: number; mime: string }[]> {
  return pooled(ids, CONCURRENCY, async (id) => {
    const asset = new Asset(id);
    const info = await asset.getInfo();
    const uri = await asset.getUri();
    return {
      id,
      // The queue's opaque source string; on native it is the asset URI.
      source: uri,
      name: info.filename,
      // The queue sends the real size from disk; the media store's is
      // advisory, and the server only uses it for a sanity bound.
      size: 0,
      mime: guessMime(info.filename),
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
