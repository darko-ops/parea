/**
 * Choosing which photos to offer — docs/design.md §7.1–7.3.
 *
 * The single strongest reason for the native client to exist. A web file
 * picker hands over files and nothing else, so the human does the finding; a
 * native client can read capture times and locations and open on "47 photos
 * from Saturday 8–2, add them all?". That collapses the chore the whole
 * product is about.
 *
 * It also has the sharpest failure mode in the product. Saturday 20:14–01:40
 * contains the screenshot, the photo of a text thread, the parking spot. A
 * suggestion that surfaces one of those does not merely miss — the contributor
 * learns the feature cannot be trusted and never uses it again, and it spends
 * the photo-library permission at the same moment. So:
 *
 *   PRECISION OVER RECALL, ALWAYS.
 *
 * Thirty photos that are all correct beats forty-seven with three wrong ones,
 * because the costs are asymmetric: a missed photo is one tap on "show
 * everything from this window", and a wrong photo is not recoverable.
 *
 * The same algorithm is implemented in tools/geotag-probe (analyze.py and the
 * probe app) to measure whether it will work on real camera rolls. The
 * thresholds below are the ones the probe reports against; a fixture shared
 * with it lives in this package's tests, so a divergence fails here.
 *
 * Pure — no React Native, no Expo. The platform supplies Candidates.
 */

/** Share of window candidates that must carry GPS for a confident suggestion. */
export const MIN_GEO_RATE = 0.6;
/** Share of geotagged candidates that must fall in one cluster. */
export const MIN_CLUSTER_SHARE = 0.8;
/** How far apart two photos can be and still count as the same place. */
export const DEFAULT_CLUSTER_RADIUS_M = 150;

export type Candidate = {
  id: string;
  /** Epoch ms. */
  createdAt: number;
  lat: number | null;
  lon: number | null;
  isScreenshot: boolean;
};

export type Window = { start: number; end: number };

export type Confidence = 'high' | 'low';

export type SuggestionReason =
  /** Tight spatial cluster — pre-select it. */
  | 'clustered'
  /** Too few photos carry GPS to trust the filter. */
  | 'sparse-location'
  /** Photos have GPS but are spread over several places. */
  | 'diffuse-location'
  /** Nothing in the window at all. */
  | 'empty';

export type Suggestion = {
  window: Window;
  /** Everything in the window except screenshots, in capture order. */
  candidates: Candidate[];
  /** Ids to tick on arrival. Empty when confidence is low — deliberately. */
  preselected: string[];
  confidence: Confidence;
  reason: SuggestionReason;
  /** Median distance from the cluster centre, for diagnostics. */
  clusterSpreadM: number | null;
  /** Dropped before the user ever sees them. */
  screenshotsExcluded: number;
};

export function haversineM(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Largest set of points within `radiusM` of a common member. O(n²); n is small. */
export function dominantCluster(
  points: Candidate[],
  radiusM = DEFAULT_CLUSTER_RADIUS_M,
): Candidate[] {
  let best: Candidate[] = [];
  for (const seed of points) {
    if (seed.lat === null || seed.lon === null) continue;
    const members = points.filter(
      (p) =>
        p.lat !== null &&
        p.lon !== null &&
        haversineM(seed.lat!, seed.lon!, p.lat, p.lon) <= radiusM,
    );
    if (members.length > best.length) best = members;
  }
  return best;
}

/**
 * Narrow a window's worth of library assets down to a suggestion.
 *
 * Three filters, in order: the time window (applied by the caller, since the
 * library query does it), screenshots, then the dominant location cluster.
 *
 * The location filter earns its place twice. Screenshots, saved images, photos
 * of text threads and photos taken somewhere else all lack the event's GPS, so
 * one geometric rule removes most of the embarrassing categories at once —
 * better than enumerating them, because the enumeration is always incomplete.
 */
export function narrow(
  assets: Candidate[],
  window: Window,
  radiusM = DEFAULT_CLUSTER_RADIUS_M,
): Suggestion {
  const candidates = assets
    .filter((a) => !a.isScreenshot)
    .sort((a, b) => a.createdAt - b.createdAt);
  const screenshotsExcluded = assets.length - candidates.length;

  const base = {
    window,
    candidates,
    screenshotsExcluded,
    clusterSpreadM: null as number | null,
  };

  if (candidates.length === 0) {
    return { ...base, preselected: [], confidence: 'low', reason: 'empty' };
  }

  const geotagged = candidates.filter((c) => c.lat !== null && c.lon !== null);
  const geoRate = geotagged.length / candidates.length;

  // Confidence decides how much is pre-selected, not whether the screen
  // appears. Degrading to "here is a useful grid, you pick" is a good outcome;
  // degrading to forty-seven pre-ticked photos with three landmines is not.
  if (geoRate < MIN_GEO_RATE) {
    return { ...base, preselected: [], confidence: 'low', reason: 'sparse-location' };
  }

  const cluster = dominantCluster(geotagged, radiusM);
  const clusterShare = cluster.length / geotagged.length;

  if (clusterShare < MIN_CLUSTER_SHARE) {
    return { ...base, preselected: [], confidence: 'low', reason: 'diffuse-location' };
  }

  const centreLat = cluster.reduce((s, p) => s + p.lat!, 0) / cluster.length;
  const centreLon = cluster.reduce((s, p) => s + p.lon!, 0) / cluster.length;
  const distances = cluster
    .map((p) => haversineM(centreLat, centreLon, p.lat!, p.lon!))
    .sort((a, b) => a - b);

  return {
    ...base,
    preselected: cluster.map((c) => c.id),
    confidence: 'high',
    reason: 'clustered',
    clusterSpreadM: Math.round(distances[Math.floor(distances.length / 2)] ?? 0),
  };
}

/**
 * Where the window comes from — design §7.3, in order of preference.
 *
 * Set at creation is the primary path, and inference is the fallback,
 * specifically because of the ordering problem: inferring from photos already
 * uploaded works for contributor five and not for contributor one — who is
 * frequently the heavy shooter with 200 photos, the most valuable contributor
 * at the event.
 */
export function resolveWindow(input: {
  startsAt?: number | null;
  endsAt?: number | null;
  /** Capture times of photos already contributed, if any. */
  existing?: number[];
  now?: number;
}): Window | null {
  if (input.startsAt) {
    return {
      start: input.startsAt,
      // An open-ended event is still running: offer up to now.
      end: input.endsAt ?? (input.now ?? Date.now()),
    };
  }

  const existing = (input.existing ?? []).filter(Number.isFinite);
  if (existing.length > 0) {
    const hour = 3600_000;
    return {
      start: Math.min(...existing) - hour,
      end: Math.max(...existing) + hour,
    };
  }

  // Nothing to go on. The caller falls back to a date picker rather than
  // guessing — a wrong window is worse than no window.
  return null;
}

/** Human-readable, and honest about which case the user is in. */
export function describe(suggestion: Suggestion): string {
  const n = suggestion.preselected.length;
  switch (suggestion.reason) {
    case 'clustered':
      return `${n} ${n === 1 ? 'photo' : 'photos'} from this event`;
    case 'sparse-location':
      return `${suggestion.candidates.length} photos from this time. Pick the ones from the event.`;
    case 'diffuse-location':
      return `${suggestion.candidates.length} photos from this time, taken in a few different places. Pick the ones you want.`;
    case 'empty':
      return 'No photos from this time.';
  }
}
