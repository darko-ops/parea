/**
 * Finding the event on the phone.
 *
 * Two things are being defended here. The first is the algorithm agreeing with
 * `tools/geotag-probe/analyze.py`, because the probe is what measures whether
 * this works on real camera rolls and a drifted port makes the measurement
 * describe software nobody runs. The fixture below is the probe's own
 * `make_fixture.py` scenario, expressed as capture times.
 *
 * The second is that detection did not quietly become a licence to guess
 * harder. Finding the run more accurately than a human picking "Last night"
 * says nothing about whether one photo in it is a screenshot of a bank
 * balance, so the confidence rules still decide what arrives ticked.
 */

import { describe, expect, it } from 'vitest';

import {
  MIN_SESSION_PHOTOS,
  SESSION_PAD_MS,
  eventDateOf,
  eventDayFor,
  labelFor,
  recentBundles,
  sessionise,
  type Candidate,
} from '../src';

/** Local time, because a party is a local-time thing — see `when.ts`. */
const at = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime();

let seq = 0;
function photo(when: number, extra: Partial<Candidate> = {}): Candidate {
  return {
    id: `a${seq++}`,
    createdAt: when,
    lat: null,
    lon: null,
    isScreenshot: false,
    ...extra,
  };
}

/** A run of `n` photos a few minutes apart, all at one place. */
function run(start: number, n: number, place: [number, number] | null = [51.55, -0.06]) {
  return Array.from({ length: n }, (_, i) =>
    photo(start + i * 4 * 60_000, {
      lat: place?.[0] ?? null,
      lon: place?.[1] ?? null,
    }),
  );
}

describe('sessionise', () => {
  it('splits on a gap longer than the threshold', () => {
    const assets = [
      ...run(at(2026, 8, 8, 20, 0), 10),
      ...run(at(2026, 8, 9, 21, 0), 12),
    ];
    const sessions = sessionise(assets);

    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.photos).toHaveLength(10);
    expect(sessions[1]!.photos).toHaveLength(12);
  });

  it('keeps a run together across a short lull', () => {
    // Three hours at the same party — dinner, then the bit after. One event.
    const assets = [
      ...run(at(2026, 8, 9, 19, 0), 6),
      ...run(at(2026, 8, 9, 22, 0), 6),
    ];
    expect(sessionise(assets)).toHaveLength(1);
  });

  it('drops runs too small to be an event', () => {
    // A parking bay and a receipt are a run of photos with no long gap, and
    // are not a night out. Offering them is worse than missing them.
    expect(sessionise(run(at(2026, 8, 9, 14, 0), MIN_SESSION_PHOTOS - 1))).toEqual([]);
    expect(sessionise(run(at(2026, 8, 9, 14, 0), MIN_SESSION_PHOTOS))).toHaveLength(1);
  });

  it('counts the threshold on offerable photos, not raw ones', () => {
    // Nine assets, six of them screenshots: three photos in a trench coat.
    const assets = [
      ...run(at(2026, 8, 9, 20, 0), 3),
      ...Array.from({ length: 6 }, (_, i) =>
        photo(at(2026, 8, 9, 20, 20) + i * 60_000, { isScreenshot: true }),
      ),
    ];
    expect(sessionise(assets, { minSize: 4 })).toEqual([]);
  });

  it('ignores assets with no capture time', () => {
    // Unplaceable rather than early: guessing puts them in the wrong run.
    const assets = [...run(at(2026, 8, 9, 20, 0), 10), photo(NaN)];
    const sessions = sessionise(assets);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.photos).toHaveLength(10);
  });
});

describe('which day it belongs to', () => {
  it('files an after-midnight session under the night it started', () => {
    // Nobody calls a 00:40 photo Saturday when it started at Friday's party.
    const [session] = sessionise(run(at(2026, 8, 9, 0, 40), 10));
    expect(eventDayFor(session!).getDate()).toBe(8);
    expect(eventDateOf(session!)).toBe('2026-08-08');
  });

  it('files an evening session under its own day', () => {
    const [session] = sessionise(run(at(2026, 8, 9, 21, 0), 10));
    expect(eventDateOf(session!)).toBe('2026-08-09');
  });
});

describe('labelFor', () => {
  const cases: [string, number, number, string][] = [
    // [what it is, session start, "now", expected]
    ['this evening', at(2026, 8, 11, 20, 0), at(2026, 8, 11, 23, 0), 'Tonight'],
    ['the early hours', at(2026, 8, 11, 1, 0), at(2026, 8, 11, 10, 0), 'Last night'],
    ['yesterday evening', at(2026, 8, 10, 20, 0), at(2026, 8, 11, 10, 0), 'Last night'],
    ['yesterday daytime', at(2026, 8, 10, 13, 0), at(2026, 8, 11, 10, 0), 'Yesterday'],
    ['this morning', at(2026, 8, 11, 9, 0), at(2026, 8, 11, 14, 0), 'This morning'],
    ['this afternoon', at(2026, 8, 11, 15, 0), at(2026, 8, 11, 18, 0), 'This afternoon'],
    ['a few nights ago', at(2026, 8, 8, 21, 0), at(2026, 8, 11, 10, 0), 'Saturday night'],
    ['a few days ago', at(2026, 8, 8, 13, 0), at(2026, 8, 11, 10, 0), 'Saturday'],
    ['weeks ago', at(2026, 7, 4, 21, 0), at(2026, 8, 11, 10, 0), '4 July'],
  ];

  it.each(cases)('calls %s "%s"', (_what, start, now, expected) => {
    const [session] = sessionise(run(start, 10));
    expect(labelFor(session!, new Date(now))).toBe(expected);
  });

  it('does not name a weekday for something a month old', () => {
    // "Tuesday" three weeks ago is not a useful thing to say to someone.
    const [session] = sessionise(run(at(2026, 7, 4, 21, 0), 10));
    expect(labelFor(session!, new Date(at(2026, 8, 11, 10, 0)))).not.toMatch(/day/);
  });
});

describe('recentBundles', () => {
  const now = new Date(at(2026, 8, 11, 10, 0));

  it('offers the most recent run first', () => {
    const assets = [
      ...run(at(2026, 8, 8, 21, 0), 20),
      ...run(at(2026, 8, 10, 20, 0), 34),
    ];
    const bundles = recentBundles(assets, { now });

    expect(bundles.map((b) => b.label)).toEqual(['Last night', 'Saturday night']);
    expect(bundles[0]!.count).toBe(34);
  });

  it('ignores anything past the horizon', () => {
    const assets = [...run(at(2026, 7, 20, 21, 0), 30), ...run(at(2026, 8, 10, 20, 0), 12)];
    expect(recentBundles(assets, { now }).map((b) => b.label)).toEqual(['Last night']);
  });

  it('pads the stored window past the edges of the run', () => {
    // The window outlives this screen: other people's phones select against it
    // later, and their evening did not start with your first photo.
    const start = at(2026, 8, 10, 20, 0);
    const [b] = recentBundles(run(start, 10), { now });

    expect(b!.window.start).toBe(start - SESSION_PAD_MS);
    expect(b!.window.end).toBe(b!.session.end + SESSION_PAD_MS);
  });

  it('reports a real time range', () => {
    const [b] = recentBundles(run(at(2026, 8, 10, 20, 14), 10), { now });
    expect(b!.timeRange).toMatch(/^8:14pm – 8:5\dpm$/);
  });

  it('finds nothing when there is nothing', () => {
    expect(recentBundles([], { now })).toEqual([]);
  });
});

describe('detection is not a licence to guess harder', () => {
  const now = new Date(at(2026, 8, 11, 10, 0));

  it('ticks the location cluster when the run is one place', () => {
    const [b] = recentBundles(run(at(2026, 8, 10, 20, 0), 20), { now });
    expect(b!.suggestion.confidence).toBe('high');
    expect(b!.suggestion.preselected).toHaveLength(20);
  });

  it('ticks nothing when the run has no location to trust', () => {
    // A detected run is still just "taken at the same time". Without GPS the
    // cluster filter cannot drop the screenshot of a bank balance, so the grid
    // opens with nothing selected — same rule as before detection existed.
    const [b] = recentBundles(run(at(2026, 8, 10, 20, 0), 20, null), { now });

    expect(b!.suggestion.confidence).toBe('low');
    expect(b!.suggestion.reason).toBe('sparse-location');
    expect(b!.suggestion.preselected).toEqual([]);
  });

  it('counts what the grid will show when it will tick nothing', () => {
    // The card must not promise a selection that is deliberately not going to
    // happen: on low confidence the number is the grid's size, not a cluster's.
    const [b] = recentBundles(run(at(2026, 8, 10, 20, 0), 20, null), { now });
    expect(b!.count).toBe(b!.suggestion.candidates.length);
  });

  it('ticks nothing when the run is spread across places', () => {
    const assets = [
      ...run(at(2026, 8, 10, 20, 0), 10, [51.55, -0.06]),
      ...run(at(2026, 8, 10, 21, 0), 10, [51.51, -0.13]),
    ];
    const [b] = recentBundles(assets, { now });

    expect(b!.suggestion.reason).toBe('diffuse-location');
    expect(b!.suggestion.preselected).toEqual([]);
  });

  it('keeps screenshots out of the count and the cover', () => {
    const assets = [
      ...run(at(2026, 8, 10, 20, 0), 12),
      photo(at(2026, 8, 10, 20, 1), { isScreenshot: true }),
    ];
    const [b] = recentBundles(assets, { now });

    expect(b!.suggestion.screenshotsExcluded).toBe(1);
    expect(b!.count).toBe(12);
    expect(b!.suggestion.candidates.some((c) => c.id === b!.coverId)).toBe(true);
  });
});

describe('agreement with the probe', () => {
  /*
   * tools/geotag-probe/make_fixture.py builds a library with known ground
   * truth, and its README states the expected outcome: the July 18 session
   * pre-selects 40 and excludes exactly the three strays, and the other two
   * sessions degrade to ticking nothing.
   *
   * Reproduced here in capture times so the TypeScript the app runs is held to
   * the numbers the Python measurement reports. If someone retunes a threshold
   * in one language, this fails in the other.
   */
  const VENUE: [number, number] = [51.5412, -0.1465];
  const now = new Date(at(2025, 7, 21, 12, 0));

  it('pre-selects the clustered session and excludes the strays', () => {
    const party = run(at(2025, 7, 18, 20, 0), 40, VENUE);
    const strays = [
      // Taken elsewhere that evening, plus a screenshot: the categories the
      // location filter exists to remove.
      photo(at(2025, 7, 18, 21, 30), { lat: 51.5074, lon: -0.1278 }),
      photo(at(2025, 7, 18, 22, 15), { lat: 51.4975, lon: -0.1357 }),
      photo(at(2025, 7, 18, 23, 5), { isScreenshot: true }),
    ];

    const [b] = recentBundles([...party, ...strays], { now, recentDays: 5 });

    expect(b!.suggestion.confidence).toBe('high');
    expect(b!.suggestion.preselected).toHaveLength(40);
    expect(b!.suggestion.screenshotsExcluded).toBe(1);
    expect(b!.count).toBe(40);
  });

  it('degrades to ticking nothing when the roll has no location', () => {
    const [b] = recentBundles(run(at(2025, 7, 19, 19, 0), 30, null), {
      now,
      recentDays: 5,
    });
    expect(b!.suggestion.preselected).toEqual([]);
  });
});
