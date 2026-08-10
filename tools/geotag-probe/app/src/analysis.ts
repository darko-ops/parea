/**
 * Pure analysis. No React Native, no Expo — so it can be unit-tested in node
 * and cross-checked against the desktop probe (`../../analyze.py`), which
 * implements the same rules. The two must agree; see scripts/test-analysis.ts.
 *
 * Mirrors docs/design.md §7.2.
 */

export const MIN_GEO_RATE = 0.6; // share of window candidates carrying GPS
export const MIN_CLUSTER_SHARE = 0.8; // share of geotagged inside the dominant cluster
export const DEFAULT_GAP_HOURS = 4;
export const DEFAULT_MIN_SESSION = 8;
export const DEFAULT_CLUSTER_RADIUS_M = 150;

export type Candidate = {
  createdAt: number; // epoch ms
  lat: number | null;
  lon: number | null;
  isScreenshot: boolean;
  /** getLocation() threw — permission, not absence. Counted apart from "no GPS". */
  locationUnavailable: boolean;
};

/**
 * Deliberately share-safe: no coordinates, no filenames, no asset ids, no
 * dates. `startHour` and `weekday` survive because "was this an evening thing"
 * is the one temporal fact worth analysing, and neither identifies a day.
 */
export type SessionResult = {
  startHour: number;
  weekday: number; // 0 = Sunday
  hours: number;
  photosInWindow: number;
  screenshotsDropped: number;
  geotagged: number;
  geoRate: number;
  clusterSize: number;
  clusterShareOfGeotagged: number;
  spreadM: number | null;
  wouldPreselect: boolean;
  preselectCount: number;
  /** How many photos the location filter removed from a pre-selection. */
  removedByLocation: number;
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

/** Split a chronological list wherever there is a gap longer than gapHours. */
export function sessionise(
  items: Candidate[],
  gapHours = DEFAULT_GAP_HOURS,
  minSession = DEFAULT_MIN_SESSION,
): Candidate[][] {
  const sorted = [...items].sort((a, b) => a.createdAt - b.createdAt);
  const gapMs = gapHours * 3600_000;
  const out: Candidate[][] = [];
  let current: Candidate[] = [];

  for (const item of sorted) {
    const prev = current[current.length - 1];
    if (prev && item.createdAt - prev.createdAt > gapMs) {
      out.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length) out.push(current);

  return out.filter((s) => s.filter((c) => !c.isScreenshot).length >= minSession);
}

/** Largest set of points within radiusM of a common member. O(n^2); n is small. */
export function dominantCluster(
  pts: Candidate[],
  radiusM = DEFAULT_CLUSTER_RADIUS_M,
): Candidate[] {
  let best: Candidate[] = [];
  for (const seed of pts) {
    if (seed.lat === null || seed.lon === null) continue;
    const members = pts.filter(
      (p) =>
        p.lat !== null &&
        p.lon !== null &&
        haversineM(seed.lat!, seed.lon!, p.lat, p.lon) <= radiusM,
    );
    if (members.length > best.length) best = members;
  }
  return best;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function assess(
  session: Candidate[],
  radiusM = DEFAULT_CLUSTER_RADIUS_M,
): SessionResult {
  const candidates = session.filter((c) => !c.isScreenshot);
  const geo = candidates.filter((c) => c.lat !== null && c.lon !== null);
  const geoRate = candidates.length ? geo.length / candidates.length : 0;

  const cluster = dominantCluster(geo, radiusM);
  const clusterShare = geo.length ? cluster.length / geo.length : 0;

  let spreadM: number | null = null;
  if (cluster.length > 1) {
    const cLat = cluster.reduce((s, p) => s + p.lat!, 0) / cluster.length;
    const cLon = cluster.reduce((s, p) => s + p.lon!, 0) / cluster.length;
    spreadM = Math.round(
      median(cluster.map((p) => haversineM(cLat, cLon, p.lat!, p.lon!))),
    );
  }

  const wouldPreselect =
    geoRate >= MIN_GEO_RATE && clusterShare >= MIN_CLUSTER_SHARE;

  const start = new Date(session[0].createdAt);
  const end = new Date(session[session.length - 1].createdAt);

  return {
    startHour: start.getHours(),
    weekday: start.getDay(),
    hours:
      Math.round(((end.getTime() - start.getTime()) / 3600_000) * 10) / 10,
    photosInWindow: candidates.length,
    screenshotsDropped: session.length - candidates.length,
    geotagged: geo.length,
    geoRate: round3(geoRate),
    clusterSize: cluster.length,
    clusterShareOfGeotagged: round3(clusterShare),
    spreadM,
    wouldPreselect,
    preselectCount: wouldPreselect ? cluster.length : 0,
    // Only meaningful when we'd pre-select: in a degraded session the filter
    // never runs, so nothing was removed — the user just picks.
    removedByLocation: wouldPreselect ? candidates.length - cluster.length : 0,
  };
}

export type Summary = {
  events: number;
  confidentEvents: number;
  confidentRate: number;
  /** Within confident events only — comparing time-window vs location filter. */
  windowWouldTick: number;
  locationTicks: number;
  removedByLocation: number;
};

export function summarise(results: SessionResult[]): Summary {
  const confident = results.filter((r) => r.wouldPreselect);
  const windowWouldTick = confident.reduce((s, r) => s + r.photosInWindow, 0);
  const locationTicks = confident.reduce((s, r) => s + r.preselectCount, 0);
  return {
    events: results.length,
    confidentEvents: confident.length,
    confidentRate: results.length ? round3(confident.length / results.length) : 0,
    windowWouldTick,
    locationTicks,
    removedByLocation: windowWouldTick - locationTicks,
  };
}

export function verdict(rate: number): 'viable' | 'mixed' | 'does-not-hold' {
  if (rate >= 0.7) return 'viable';
  if (rate >= 0.4) return 'mixed';
  return 'does-not-hold';
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
