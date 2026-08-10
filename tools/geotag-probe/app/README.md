# Geotag probe — on-device

The faithful instrument. `../analyze.py` measures a folder of exported files;
this measures the photo library itself, through the same `expo-media-library`
API the real app would use. It is the only way to get a coverage number across
*other people's* phones, which is the question one camera roll cannot answer.

Reads metadata only. Never reads, copies, or uploads a photo.

## What it measures

Exactly what `docs/design.md` §7.2 specifies, with the thresholds in
`src/analysis.ts`:

1. List images from the last 12 months — `Query.exeForMetadata()`, which reads
   the media store cheaply without resolving files.
2. Split into candidate events on a 4-hour gap.
3. For members of candidate events only, read `getLocation()` and (iOS)
   `getMediaSubtypes()` to spot screenshots.
4. Per event: GPS coverage, dominant-cluster share, cluster spread. Confident
   pre-selection needs ≥60% coverage and ≥80% of geotagged photos in one cluster.

The two-pass structure is the same one the app would use — location lookups are
the expensive part, so they only run for photos that could plausibly belong to an
event. The time this takes is roughly the time the real feature would take.

## Run it

```
npm install
npm start      # then scan the QR code
```

`npm test` cross-checks `src/analysis.ts` against `../analyze.py` on a shared
fixture. Both implement §7.2 and they must agree, or the phone numbers and the
camera-roll numbers aren't comparable. `npm run typecheck` for types.

### Getting it onto testers' phones

**Try Expo Go first.** `expo-media-library` ships in Expo Go, so a tester should
be able to install Expo Go, scan a QR, and run this with no build, no account,
and no device registration. That is worth a great deal for a probe you want a
dozen people to run.

**Verify with one tester before sending it wide**, on both platforms. Two things
to watch:

- **iOS** should be fine — Expo Go supplies its own photo-library usage
  description and the permission prompt appears as normal.
- **Android is the risk.** `getLocation()` needs `ACCESS_MEDIA_LOCATION`, which
  is a manifest permission — so it depends on what Expo Go itself declares, not
  on this project's `app.json`. If it isn't there, every lookup throws.

The probe is built for that failure: a throwing lookup is counted as
`locationErrors`, reported separately, and called out in the caveats as *"could
not look"* rather than folded into *"no GPS."* **A high `locationErrors` count
means the run is invalid, not that coverage is zero.** If that happens on
Android, build a dev client:

```
npx eas build --profile development --platform android
```

The config plugin in `app.json` requests `ACCESS_MEDIA_LOCATION` and
`READ_MEDIA_IMAGES`, and skips the save-photos permission entirely since nothing
is ever written.

## What leaves the phone

Nothing, unless the tester taps Share — and the app shows the exact JSON first.

The payload is counts, rates, and one distance in metres. It carries **no
coordinates, no filenames, no asset ids, no dates, and no image data.**
`startHour` and `weekday` are included because "was this an evening thing" is
worth analysing and neither identifies a day. The contract is enforced by
construction in `src/report.ts` — the report is built from aggregates, so
there is no path by which a coordinate reaches it.

Show people that screen. They are doing you a favour by running this, and being
able to read exactly what you are asking for is the standard the product itself
is supposed to hold.

## Reading results

Same thresholds as the desktop probe, so see [`../README.md`](../README.md) §4.
Headline is the share of candidate events that would get a confident
pre-selection: **≥70%** viable, **40–70%** mixed, **<40%** does not hold.

Caveats shown in-app, all of which invalidate the headline if present:

| Caveat | Meaning |
|---|---|
| `limited` access | iOS/Android granted a hand-picked subset. Measures those photos, not the library. Not representative. |
| `locationErrors > 0` | Lookups failed. On Android, almost certainly the missing permission above. |
| `truncated` | Hit the 2,000-lookup cap; later events unassessed. Scan a shorter period. |

## Collecting across people

One roll answers clustering quality. Coverage needs several phones. Ask testers
to share the result text back — it is small enough to paste into a chat, and it
carries its own caveats, so a caveated result can't arrive stripped of them.

Note down platform alongside each result. iOS and Android differ in how
geotagging defaults are presented, and a coverage number pooled across both
hides the thing you most need to know.
