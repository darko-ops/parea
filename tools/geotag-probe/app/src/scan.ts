/**
 * Reads photo-library metadata and turns it into Candidates for analysis.ts.
 *
 * NOTHING here reads pixel data, copies a file, or touches the network. It
 * reads creation times, locations, and (on iOS) media subtypes, and throws all
 * of it away except aggregate counts. See buildReport() in report.ts for the
 * exact payload that can leave the device.
 */

import { Platform } from 'react-native';
import {
  Asset,
  AssetField,
  MediaType,
  Query,
  requestPermissionsAsync,
  type PermissionResponse,
} from 'expo-media-library';

import type { Candidate } from './analysis';

/** Per-asset location lookups are the slow part; keep the run bounded. */
export const MAX_LOCATION_LOOKUPS = 2000;
const CONCURRENCY = 8;

export type ScanProgress = {
  phase: 'permission' | 'listing' | 'locating' | 'done';
  done: number;
  total: number;
};

export type ScanResult = {
  candidates: Candidate[];
  totalImagesInRange: number;
  /** getLocation() threw — on Android this usually means ACCESS_MEDIA_LOCATION. */
  locationErrors: number;
  /** True when we stopped short of covering every session member. */
  truncated: boolean;
  accessPrivileges: PermissionResponse['accessPrivileges'];
};

export async function requestAccess(): Promise<PermissionResponse> {
  // 'photo' is the granular Android 13+ permission; iOS ignores the argument.
  return requestPermissionsAsync(false, ['photo']);
}

/** Run tasks with a fixed concurrency, reporting progress as each settles. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
      onProgress?.(++done);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Two passes, deliberately:
 *   1. exeForMetadata() — cheap, reads the media store without resolving files.
 *      Enough to sessionise, which is how we avoid a location lookup on every
 *      photo in the library.
 *   2. getLocation() per asset, only for members of candidate sessions.
 *
 * This is the same shape the real app would use, so the cost measured here is
 * roughly the cost the app would pay.
 */
export async function scan(
  monthsBack: number,
  sessioniseFn: (items: Candidate[]) => Candidate[][],
  onProgress: (p: ScanProgress) => void,
): Promise<ScanResult> {
  onProgress({ phase: 'permission', done: 0, total: 0 });
  const permission = await requestAccess();
  if (!permission.granted) {
    throw new Error('Photo library access is required to measure anything.');
  }

  onProgress({ phase: 'listing', done: 0, total: 0 });
  const since = Date.now() - monthsBack * 30 * 24 * 3600_000;
  const metas = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .gte(AssetField.CREATION_TIME, since)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: true })
    .exeForMetadata();

  const dated = metas.filter(
    (m): m is typeof m & { creationTime: number } => m.creationTime != null,
  );

  // Pass 1 has no location and no subtypes yet, so sessionising here treats
  // every asset as a non-screenshot. Screenshots are subtracted in pass 2.
  const provisional: Candidate[] = dated.map((m) => ({
    createdAt: m.creationTime,
    lat: null,
    lon: null,
    isScreenshot: false,
    locationUnavailable: false,
  }));

  const sessions = sessioniseFn(provisional);
  const wanted = new Set<number>();
  for (const s of sessions) for (const c of s) wanted.add(c.createdAt);

  const inSessions = dated.filter((m) => wanted.has(m.creationTime));
  const truncated = inSessions.length > MAX_LOCATION_LOOKUPS;
  const toLookUp = inSessions.slice(0, MAX_LOCATION_LOOKUPS);

  onProgress({ phase: 'locating', done: 0, total: toLookUp.length });
  let locationErrors = 0;

  const candidates = await pooled(
    toLookUp,
    CONCURRENCY,
    async (meta): Promise<Candidate> => {
      const asset = new Asset(meta.id);
      let lat: number | null = null;
      let lon: number | null = null;
      let locationUnavailable = false;

      try {
        const loc = await asset.getLocation();
        if (loc) {
          lat = loc.latitude;
          lon = loc.longitude;
        }
      } catch {
        // Distinguishing "no GPS on this photo" from "we were not allowed to
        // look" matters enormously — conflating them reports 0% coverage on a
        // healthy library, which is the exact failure this probe exists to avoid.
        locationUnavailable = true;
        locationErrors++;
      }

      let isScreenshot = false;
      if (Platform.OS === 'ios') {
        try {
          isScreenshot = (await asset.getMediaSubtypes()).includes('screenshot' as never);
        } catch {
          // Non-fatal: an unclassified screenshot has no GPS and the location
          // filter drops it anyway. Only the "dropped" count is affected.
        }
      }

      return {
        createdAt: meta.creationTime,
        lat,
        lon,
        isScreenshot,
        locationUnavailable,
      };
    },
    (done) => onProgress({ phase: 'locating', done, total: toLookUp.length }),
  );

  onProgress({ phase: 'done', done: candidates.length, total: candidates.length });

  return {
    candidates,
    totalImagesInRange: dated.length,
    locationErrors,
    truncated,
    accessPrivileges: permission.accessPrivileges,
  };
}
