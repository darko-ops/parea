/**
 * Auto-selection — docs/design.md §7.1–7.3.
 *
 * The first block uses the same fixture as tools/geotag-probe (analyze.py and
 * the probe app), because the probe exists to predict what this code will do
 * on a real camera roll. If they disagree, the measurement was measuring
 * something else and these tests are where that shows up.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLUSTER_RADIUS_M,
  MIN_CLUSTER_SHARE,
  MIN_GEO_RATE,
  describe as describeSuggestion,
  dominantCluster,
  narrow,
  resolveWindow,
  type Candidate,
} from '../src/index';

const VENUE: [number, number] = [51.5145, -0.127];
const PARK: [number, number] = [51.5388, -0.153];
const M_PER_DEG = 111_000;
const MIN = 60_000;

/** Deterministic pseudo-jitter, matching the probe's fixture generator. */
function jitter(i: number, metres: number): [number, number] {
  const f = (x: number) => (x - Math.floor(x)) * 2 - 1;
  const d = metres / M_PER_DEG;
  return [f(Math.sin(i * 12.9898) * 43758.5453) * d, f(Math.sin(i * 78.233) * 43758.5453) * d];
}

function photo(
  id: string,
  at: number,
  loc: [number, number] | null,
  isScreenshot = false,
): Candidate {
  return { id, createdAt: at, lat: loc?.[0] ?? null, lon: loc?.[1] ?? null, isScreenshot };
}

const START = new Date('2026-07-18T20:05:00Z').getTime();
const WINDOW = { start: START - 3600_000, end: START + 8 * 3600_000 };

/** The probe's session A: a party, three strays, two screenshots. */
function partyFixture(): Candidate[] {
  const items: Candidate[] = [];
  for (let i = 0; i < 40; i++) {
    const [dLat, dLon] = jitter(i, 60);
    items.push(photo(`p${i}`, START + i * 7 * MIN, [VENUE[0] + dLat, VENUE[1] + dLon]));
  }
  [2500, 4100, 3300].forEach((offset, i) => {
    items.push(
      photo(`stray${i}`, START + 200 * MIN + i * 7 * MIN, [
        VENUE[0] + offset / M_PER_DEG,
        VENUE[1],
      ]),
    );
  });
  items.push(photo('shot0', START + 85 * MIN, null, true));
  items.push(photo('shot1', START + 105 * MIN, null, true));
  return items;
}

describe('agreeing with the probe', () => {
  it('pre-selects the cluster and excludes the strays', async () => {
    const s = narrow(partyFixture(), WINDOW);

    expect(s.confidence).toBe('high');
    expect(s.reason).toBe('clustered');
    expect(s.candidates).toHaveLength(43);
    expect(s.screenshotsExcluded).toBe(2);
    expect(s.preselected).toHaveLength(40);
    for (const id of ['stray0', 'stray1', 'stray2']) {
      expect(s.preselected, id).not.toContain(id);
    }
    expect(s.clusterSpreadM!).toBeLessThan(DEFAULT_CLUSTER_RADIUS_M);
  });

  it('degrades when geotagging is off', async () => {
    const items = Array.from({ length: 18 }, (_, i) =>
      photo(`n${i}`, START + i * 9 * MIN, null),
    );
    const s = narrow(items, WINDOW);
    expect(s.confidence).toBe('low');
    expect(s.reason).toBe('sparse-location');
    expect(s.preselected).toEqual([]);
    // Still a useful grid — the screen appears, nothing is ticked.
    expect(s.candidates).toHaveLength(18);
  });

  it('degrades at half coverage, below the threshold', async () => {
    const items = Array.from({ length: 20 }, (_, i) => {
      const [dLat, dLon] = jitter(100 + i, 70);
      return photo(
        `m${i}`,
        START + i * 8 * MIN,
        i % 2 === 0 ? [PARK[0] + dLat, PARK[1] + dLon] : null,
      );
    });
    const s = narrow(items, WINDOW);
    expect(s.confidence).toBe('low');
    expect(s.preselected).toEqual([]);
  });
});

describe('precision over recall', () => {
  it('ticks nothing when the photos are spread across places', async () => {
    // Fully geotagged, but three separate locations — a day out, not an event.
    const items: Candidate[] = [];
    for (let place = 0; place < 3; place++) {
      for (let i = 0; i < 6; i++) {
        items.push(
          photo(`x${place}-${i}`, START + (place * 20 + i) * MIN, [
            VENUE[0] + (place * 2000) / M_PER_DEG,
            VENUE[1],
          ]),
        );
      }
    }
    const s = narrow(items, WINDOW);
    expect(s.reason).toBe('diffuse-location');
    expect(s.preselected).toEqual([]);
  });

  it('drops screenshots before anyone sees them', async () => {
    const items = [
      photo('a', START, VENUE),
      photo('shot', START + MIN, null, true),
    ];
    const s = narrow(items, WINDOW);
    expect(s.candidates.map((c) => c.id)).toEqual(['a']);
    expect(s.screenshotsExcluded).toBe(1);
  });

  it('excludes an ungeotagged photo from a confident pre-selection', async () => {
    // The photo of a text thread taken at the party. It sits in the window and
    // in the grid, but it is not ticked, which is the entire point.
    const items = Array.from({ length: 20 }, (_, i) => {
      const [dLat, dLon] = jitter(i, 50);
      return photo(`p${i}`, START + i * MIN, [VENUE[0] + dLat, VENUE[1] + dLon]);
    });
    items.push(photo('private', START + 5 * MIN, null));

    const s = narrow(items, WINDOW);
    expect(s.confidence).toBe('high');
    expect(s.candidates.map((c) => c.id)).toContain('private');
    expect(s.preselected, 'in the grid, not ticked').not.toContain('private');
  });

  it('holds the documented thresholds', () => {
    // These are the numbers the probe reports against. Changing one here
    // without changing it there makes the measurement meaningless.
    expect(MIN_GEO_RATE).toBe(0.6);
    expect(MIN_CLUSTER_SHARE).toBe(0.8);
    expect(DEFAULT_CLUSTER_RADIUS_M).toBe(150);
  });
});

describe('clustering', () => {
  it('picks the largest group, not the first', () => {
    const far: [number, number] = [VENUE[0] + 0.05, VENUE[1]];
    const points = [
      photo('lonely', START, far),
      ...Array.from({ length: 5 }, (_, i) =>
        photo(`c${i}`, START + i, [VENUE[0] + i * 0.0001, VENUE[1]]),
      ),
    ];
    const cluster = dominantCluster(points);
    expect(cluster).toHaveLength(5);
    expect(cluster.map((c) => c.id)).not.toContain('lonely');
  });

  it('ignores points with no location', () => {
    expect(dominantCluster([photo('a', START, null)])).toEqual([]);
  });

  it('handles an empty set', () => {
    const s = narrow([], WINDOW);
    expect(s.reason).toBe('empty');
    expect(describeSuggestion(s)).toMatch(/No photos/);
  });
});

describe('resolving the window', () => {
  it('prefers what the host set at creation', () => {
    const window = resolveWindow({ startsAt: 1000, endsAt: 2000 });
    expect(window).toEqual({ start: 1000, end: 2000 });
  });

  it('treats an open-ended event as still running', () => {
    const window = resolveWindow({ startsAt: 1000, endsAt: null, now: 9000 });
    expect(window).toEqual({ start: 1000, end: 9000 });
  });

  it('falls back to inference from photos already there', () => {
    // Works for contributor five and not contributor one, which is exactly
    // why this is the fallback and not the primary path.
    const hour = 3600_000;
    const window = resolveWindow({ existing: [5 * hour, 7 * hour] });
    expect(window).toEqual({ start: 4 * hour, end: 8 * hour });
  });

  it('returns nothing rather than guessing', () => {
    // A wrong window is worse than no window: the caller shows a date picker.
    expect(resolveWindow({})).toBeNull();
    expect(resolveWindow({ existing: [] })).toBeNull();
  });
});

describe('what the screen says', () => {
  it('is specific when confident and honest when not', () => {
    expect(describeSuggestion(narrow(partyFixture(), WINDOW))).toBe(
      '40 photos from this event',
    );
    const sparse = narrow(
      Array.from({ length: 4 }, (_, i) => photo(`n${i}`, START + i, null)),
      WINDOW,
    );
    expect(describeSuggestion(sparse)).toMatch(/Pick the ones/);
  });
});
