# Geotag coverage probe

Tests the assumption the native client is built on, before building it.

`docs/design.md` §7.2 makes location clustering the filter that buys precision
in auto-selection: keep the dominant spatial cluster inside the event's time
window, and screenshots, saved images, photos of text threads, and photos taken
elsewhere all fall away, because none of them carry the event's GPS.

That mechanism has one dependency. **If people's cameras don't write GPS, it
doesn't work at all** — and the app degrades from "we found your 31 party
photos" to "here is a grid, you pick," which is a nicer file picker and not a
reason to install anything.

This probe measures whether the mechanism holds. Run it before committing to
the native build. It is cheap and the answer changes what gets built.

## 1. Run it

```
brew install exiftool          # or: apt install libimage-exiftool-perl
python3 analyze.py ~/photo-export --show-excluded
```

No Python dependencies. `--show-excluded` lists the files the location filter
removed, which is the part worth reading with your own eyes.

Useful flags: `--gap-hours` (what separates one candidate event from the next,
default 4), `--min-session` (ignore runs smaller than this, default 8),
`--cluster-radius-m` (default 150), `--json FILE`.

The TypeScript the app actually runs is held to this file's numbers.
`packages/autoselect/test/probe-fixture.json` is the synthetic library below as
`load()` sees it, and `sessions.test.ts` asserts the port reaches the same
verdicts. Regenerate it after changing `make_fixture.py`:

```
python3 make_fixture.py /tmp/fixture
python3 - /tmp/fixture ../../packages/autoselect/test/probe-fixture.json <<'EOF'
import json, sys
from analyze import load
photos, _ = load([sys.argv[1]])
out = [{'id': p.name,
        'createdAt': int(p.when.timestamp() * 1000) if p.when else None,
        'lat': p.lat, 'lon': p.lon, 'isScreenshot': p.is_screenshot}
       for p in photos]
out.sort(key=lambda p: (p['createdAt'] is None, p['createdAt']))
json.dump(out, open(sys.argv[2], 'w'), indent=0)
EOF
```

Export through `load()` rather than a separate `exiftool` call. A hand-rolled
extraction lost the two PNG screenshots, which carry no `DateTimeOriginal` —
and a fixture built differently from the thing it checks proves nothing.

To check the probe itself is behaving, `make_fixture.py` builds a synthetic
library with known ground truth:

```
python3 make_fixture.py /tmp/fixture && python3 analyze.py /tmp/fixture --show-excluded
```

Expect: the July 18 session pre-selects 40 and excludes exactly the three
strays; the other two sessions degrade to "tick nothing."

## 2. Getting the photos off the phone without destroying the measurement

**Read this before collecting anything.** The most convenient ways to move
photos strip precisely the metadata being measured, and a stripping path
produces a confident-looking 0% on a perfectly healthy camera roll. This is the
easiest way to kill a good feature with a bad number.

**Paths that destroy the measurement:**

| Path | What it does |
|---|---|
| Uploading via Safari on iOS (`<input type="file">`) | Strips EXIF. Intentional Apple privacy behaviour, not a bug — [WebKit #207088](https://bugs.webkit.org/show_bug.cgi?id=207088). Android and desktop browsers do not do this. |
| iCloud Shared Albums | Strips location metadata and downsizes. (iCloud *Shared Photo Library* is different and preserves originals.) |
| Most messaging apps | Strip or recompress by default. |

**Paths that preserve it:**

| Path | Notes |
|---|---|
| Cable → Finder / Image Capture / `adb pull` | The cleanest. Untouched originals. |
| macOS Photos → File → Export → **Export Unmodified Original** | Not plain "Export", which re-encodes. |
| AirDrop | Sends the original file, metadata intact. |
| Google Photos shared album, downloaded by a member | Preserves EXIF including location. |
| Google Takeout | Preserves EXIF; also writes JSON sidecars this script ignores. |

If the report says a large share of files are **missing a timestamp**, that is
the tell. Real camera photos always have one. Stop and check the collection
path before believing any of the other numbers.

## 3. What one camera roll can and cannot tell you

Your own library answers one of the two questions well and the other badly.

**Answers well — clustering quality.** Do party-shaped sessions form tight
spatial clusters? How many photos in the time window are *not* from the event,
and does the location filter catch them? Does 150m turn out to be the right
radius, or do venues sprawl? This needs one library, and yours will do.

**Answers badly — population coverage.** "What share of party guests have camera
geotagging switched on" is a fact about many people's settings. Your roll is
n=1 for it. The per-device breakdown in the report is a weak proxy if your
library contains AirDropped photos from other people's phones — treat it as a
hint, not a measurement.

For the real coverage number, two options, and they compose:

1. **Run the on-device probe — [`app/`](./app/).** The faithful instrument: it
   reads the photo library through the same `expo-media-library` API the real
   app would, so nothing sits between the measurement and the truth. It runs in
   Expo Go, so testers scan a QR rather than installing a build. Same thresholds
   as this script, cross-checked against it by `npm test`.
2. **Fold it into the test already planned.** `concept.md` §6 says the next step
   is a plain shared album at the next party, counting whether anyone other than
   you uploads. That collection is also a geotag sample across several people's
   phones, for no extra effort — provided you collect it through a preserving
   path from §2. **Use a Google Photos shared album or AirDrop, not an iCloud
   Shared Album**, or the geotag half of the finding is destroyed and you won't
   be able to tell.

Same party, same effort, two findings — and the app-based probe running on a few
of those same phones turns it into a real coverage sample rather than an
anecdote.

## 4. Reading the result

The headline is *what share of candidate events would get a confident
pre-selection* — GPS on at least 60% of window candidates, and at least 80% of
those inside one cluster. Those thresholds mirror §7.2 and live at the top of
`analyze.py`; change them there if the design changes.

| Result | Meaning |
|---|---|
| **≥70%** | Auto-selection is viable. The location filter is doing real work. Build it. |
| **40–70%** | Mixed. A large minority of contributors land on the degraded path, so that path has to be genuinely good — not an error state. |
| **<40%** | Auto-selection as designed does not hold. Check §2 first; a stripping path produces exactly this. If the collection was clean, the native justification needs re-arguing before the build, not after. |

Then read `--show-excluded` by eye. That list is the precision claim made
concrete. Every file on it that was genuinely from the event is a recall miss,
and cheap — one tap on "show everything from this window." Every file on it that
was private is the failure the filter exists to prevent, and that one is not
cheap: it costs the contributor's trust and the photo-library permission at the
same moment, and neither comes back.

If the excluded list is full of things that clearly belonged to the event, widen
`--cluster-radius-m` and re-run. If it is full of screenshots, receipts, and the
parking spot, the mechanism is working.
