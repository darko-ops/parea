/**
 * Cross-validates src/analysis.ts against the desktop probe (../../analyze.py).
 *
 * Both implement docs/design.md §7.2, and they have to agree — otherwise the
 * on-device numbers and the camera-roll numbers aren't comparable and neither
 * can be trusted. This rebuilds the same scenario make_fixture.py writes to
 * disk and asserts the same verdicts.
 *
 *   npm test
 */

import {
  assess,
  sessionise,
  summarise,
  verdict,
  type Candidate,
} from '../src/analysis';

const MIN = 60_000;
const M_PER_DEG_LAT = 111_000;

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? '  ok  ' : ' FAIL '} ${label}` +
      (ok ? '' : `\n         expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`),
  );
}

/** Deterministic pseudo-jitter, so runs are reproducible. */
function jitter(i: number, metres: number): [number, number] {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 43758.5453;
  const f = (x: number) => (x - Math.floor(x)) * 2 - 1;
  const d = metres / M_PER_DEG_LAT;
  return [f(a) * d, f(b) * d];
}

function photo(
  at: number,
  loc: [number, number] | null,
  isScreenshot = false,
): Candidate {
  return {
    createdAt: at,
    lat: loc ? loc[0] : null,
    lon: loc ? loc[1] : null,
    isScreenshot,
    locationUnavailable: false,
  };
}

// --- the same three sessions make_fixture.py writes ------------------------
const VENUE: [number, number] = [51.5145, -0.127];
const PARK: [number, number] = [51.5388, -0.153];
const items: Candidate[] = [];

// A: a party — 40 tight, 3 strays far enough to be their own clusters,
//    2 screenshots that a time-only filter would wrongly include.
const aStart = new Date(2026, 6, 18, 20, 5).getTime();
for (let i = 0; i < 40; i++) {
  const [dLat, dLon] = jitter(i, 60);
  items.push(photo(aStart + i * 7 * MIN, [VENUE[0] + dLat, VENUE[1] + dLon]));
}
[2500, 4100, 3300].forEach((offsetM, i) => {
  items.push(
    photo(new Date(2026, 6, 18, 23, 40).getTime() + i * 7 * MIN, [
      VENUE[0] + offsetM / M_PER_DEG_LAT,
      VENUE[1],
    ]),
  );
});
for (let i = 0; i < 2; i++) {
  items.push(photo(new Date(2026, 6, 18, 21, 30).getTime() + i * 20 * MIN, null, true));
}

// B: geotagging off entirely.
const bStart = new Date(2026, 6, 25, 13, 0).getTime();
for (let i = 0; i < 18; i++) items.push(photo(bStart + i * 9 * MIN, null));

// C: half geotagged — below the coverage threshold.
const cStart = new Date(2026, 7, 1, 18, 0).getTime();
for (let i = 0; i < 20; i++) {
  const [dLat, dLon] = jitter(100 + i, 70);
  items.push(
    photo(cStart + i * 8 * MIN, i % 2 === 0 ? [PARK[0] + dLat, PARK[1] + dLon] : null),
  );
}

// --- assertions ------------------------------------------------------------
console.log('\nanalysis.ts vs analyze.py — same fixture, same rules\n');

const sessions = sessionise(items);
check('finds 3 candidate events', sessions.length, 3);

const [a, b, c] = sessions.map((s) => assess(s));

check('A photos in window (screenshots excluded)', a.photosInWindow, 43);
check('A screenshots dropped', a.screenshotsDropped, 2);
check('A geotag rate', a.geoRate, 1);
check('A cluster share of geotagged', a.clusterShareOfGeotagged, 0.93);
check('A pre-selects', a.wouldPreselect, true);
check('A pre-select count excludes the 3 strays', a.preselectCount, 40);
check('A removed by location', a.removedByLocation, 3);
check('A cluster is tight (<150m spread)', (a.spreadM ?? 999) < 150, true);
check('A starts in the evening', a.startHour, 20);

check('B photos in window', b.photosInWindow, 18);
check('B geotag rate', b.geoRate, 0);
check('B degrades rather than pre-selecting', b.wouldPreselect, false);
check('B ticks nothing', b.preselectCount, 0);
check('B reports no removals when it never filtered', b.removedByLocation, 0);

check('C photos in window', c.photosInWindow, 20);
check('C geotag rate', c.geoRate, 0.5);
check('C below coverage threshold, degrades', c.wouldPreselect, false);

const s = summarise([a, b, c]);
check('1 of 3 events confident', [s.confidentEvents, s.events], [1, 3]);
check('window-vs-location counted only within confident events',
  [s.windowWouldTick, s.locationTicks, s.removedByLocation], [43, 40, 3]);
check('verdict at 33%', verdict(s.confidentRate), 'does-not-hold');
check('verdict thresholds', [verdict(0.7), verdict(0.55), verdict(0.2)],
  ['viable', 'mixed', 'does-not-hold']);

console.log(
  failures === 0
    ? '\nAll checks passed — matches analyze.py on the shared fixture.\n'
    : `\n${failures} check(s) FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
