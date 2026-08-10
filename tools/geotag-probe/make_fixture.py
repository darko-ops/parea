#!/usr/bin/env python3
"""
Build a synthetic photo library with known ground truth, to validate analyze.py.

Not part of the product. It exists so the probe can be trusted before it is
pointed at a real camera roll and used to make a build decision.

  python3 make_fixture.py /tmp/fixture && python3 analyze.py /tmp/fixture
"""

from __future__ import annotations

import base64
import os
import random
import subprocess
import sys
from datetime import datetime, timedelta

# 1x1 JPEG and PNG, just enough for exiftool to treat them as real media.
JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy"
    "MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA"
    "AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA"
    "AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3"
    "ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm"
    "p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEA"
    "AwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSEx"
    "BhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElK"
    "U1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3"
    "uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iii"
    "gD//2Q=="
)
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM"
    "IQAAAABJRU5ErkJggg=="
)

# ~150m in degrees at mid latitudes, near enough for a fixture.
DEG_150M = 0.00135


def jitter(lat: float, lon: float, metres: float, rng: random.Random) -> tuple[float, float]:
    d = metres / 150.0 * DEG_150M
    return lat + rng.uniform(-d, d), lon + rng.uniform(-d, d)


def write(out: str, name: str, blob: bytes, when: datetime,
          gps: tuple[float, float] | None, device: tuple[str, str] | None) -> None:
    path = os.path.join(out, name)
    with open(path, "wb") as fh:
        fh.write(blob)

    args = ["exiftool", "-q", "-q", "-overwrite_original",
            f"-FileModifyDate={when:%Y:%m:%d %H:%M:%S}"]
    if blob is JPEG:
        args.append(f"-DateTimeOriginal={when:%Y:%m:%d %H:%M:%S}")
        args.append(f"-CreateDate={when:%Y:%m:%d %H:%M:%S}")
        if device:
            args += [f"-Make={device[0]}", f"-Model={device[1]}"]
        if gps:
            lat, lon = gps
            args += [
                f"-GPSLatitude={abs(lat)}", f"-GPSLatitudeRef={'N' if lat >= 0 else 'S'}",
                f"-GPSLongitude={abs(lon)}", f"-GPSLongitudeRef={'E' if lon >= 0 else 'W'}",
            ]
    args.append(path)
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"exiftool failed on {name}: {r.stderr}")
    # exiftool rewrites mtime when it writes tags, so set it last.
    subprocess.run(["exiftool", "-q", "-q", "-overwrite_original",
                    f"-FileModifyDate={when:%Y:%m:%d %H:%M:%S}", path], check=True)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: make_fixture.py <outdir>")
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    rng = random.Random(20260810)
    iphone = ("Apple", "iPhone 15 Pro")

    # --- Session A: a party. Tight GPS cluster, plus three strays and two
    #     screenshots that a time-only filter would wrongly include. -----------
    venue = (51.5145, -0.1270)
    t = datetime(2026, 7, 18, 20, 5)
    for i in range(40):
        write(out, f"A_party_{i:03d}.jpg", JPEG, t,
              jitter(*venue, 60, rng), iphone)
        t += timedelta(minutes=rng.randint(3, 12))

    # the walk home, the parking spot, the thing photographed the next street over
    for i, offset_m in enumerate((2500, 4100, 3300)):
        stray = (venue[0] + offset_m / 111000.0, venue[1])
        write(out, f"A_stray_{i}.jpg", JPEG,
              datetime(2026, 7, 18, 23, 40) + timedelta(minutes=i * 7), stray, iphone)

    # screenshots taken during the party — no camera tags, PNG
    for i in range(2):
        write(out, f"A_Screenshot_{i}.png", PNG,
              datetime(2026, 7, 18, 21, 30) + timedelta(minutes=i * 20), None, None)

    # --- Session B: geotagging off. Should degrade, not pre-select. -----------
    t = datetime(2026, 7, 25, 13, 0)
    for i in range(18):
        write(out, f"B_nogps_{i:03d}.jpg", JPEG, t, None, ("Google", "Pixel 8"))
        t += timedelta(minutes=rng.randint(4, 15))

    # --- Session C: half geotagged. Below threshold, should not pre-select. ---
    park = (51.5388, -0.1530)
    t = datetime(2026, 8, 1, 18, 0)
    for i in range(20):
        gps = jitter(*park, 70, rng) if i % 2 == 0 else None
        write(out, f"C_mixed_{i:03d}.jpg", JPEG, t, gps, iphone)
        t += timedelta(minutes=rng.randint(4, 14))

    n = len(os.listdir(out))
    print(f"Wrote {n} files to {out}")
    print("\nExpected:")
    print("  A (18 Jul) 43 in window, 2 screenshots dropped, ~100% gps,")
    print("             cluster 40/43 -> PRE-SELECT 40, excluding the 3 strays")
    print("  B (25 Jul) 18 in window, 0% gps                 -> TICK NOTHING")
    print("  C (01 Aug) 20 in window, 50% gps                -> TICK NOTHING")


if __name__ == "__main__":
    main()
