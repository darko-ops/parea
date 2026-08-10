#!/usr/bin/env python3
"""
Geotag-coverage probe for the auto-selection design (docs/design.md §7.2).

Answers one question: if we filter a camera roll to an event's time window and
then keep only the dominant location cluster, does that produce a tight, correct
suggestion — or does it collapse because the photos have no GPS?

Run it against a directory of ORIGINAL photo files. Read README.md first: most
obvious ways of getting photos off a phone destroy the exact metadata this
measures, and will make a healthy library look like a dead one.

Requires exiftool (`brew install exiftool` / `apt install libimage-exiftool-perl`).
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import statistics
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta

# Tags we ask exiftool for. GPS carries a '#' suffix to force numeric output for
# just those tags — a global -n would also switch off date formatting, which is
# how this script was wrong the first time.
TAGS = [
    "SourceFile", "MIMEType", "FileType", "FileName", "FileSize#",
    "DateTimeOriginal", "CreateDate", "FileModifyDate",
    "GPSLatitude#", "GPSLongitude#",
    "Make", "Model",
    "ImageWidth", "ImageHeight",
]

DATE_FMT = "%Y-%m-%dT%H:%M:%S"
# exiftool's own default is "YYYY:MM:DD HH:MM:SS"; accept it too so the parser
# doesn't depend on -d surviving future flag changes.
DATE_FORMATS = (DATE_FMT, "%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S")

# Confidence thresholds — these mirror the rule in docs/design.md §7.2, where
# confidence decides how much gets pre-selected. Kept here so the probe measures
# the design rather than a vibe.
MIN_GEO_RATE = 0.60       # share of window candidates carrying GPS
MIN_CLUSTER_SHARE = 0.80  # share of geotagged candidates inside the dominant cluster


@dataclass(eq=False)  # identity comparison: two photos are never "equal"
class Photo:
    path: str
    name: str
    when: datetime | None
    lat: float | None
    lon: float | None
    make: str | None
    model: str | None
    mime: str
    size: int

    @property
    def has_gps(self) -> bool:
        return self.lat is not None and self.lon is not None

    @property
    def is_screenshot(self) -> bool:
        # iOS/Android screenshots carry no camera Make and are PNG, or are named
        # as such. This is the cheap proxy the app would use via album membership.
        if self.name.lower().startswith(("screenshot", "screen shot")):
            return True
        return not self.make and self.mime == "image/png"

    @property
    def device(self) -> str:
        if not self.make and not self.model:
            return "(no camera tags)"
        return " ".join(p for p in (self.make, self.model) if p)


@dataclass
class Session:
    """A run of photos with no long gap — a candidate 'event' in the roll."""
    photos: list[Photo] = field(default_factory=list)

    @property
    def start(self) -> datetime:
        return self.photos[0].when  # type: ignore[return-value]

    @property
    def end(self) -> datetime:
        return self.photos[-1].when  # type: ignore[return-value]

    @property
    def candidates(self) -> list[Photo]:
        """What the time window alone would offer: everything but screenshots."""
        return [p for p in self.photos if not p.is_screenshot]


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    r = 6371000.0
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def dominant_cluster(pts: list[Photo], radius_m: float) -> list[Photo]:
    """Largest set of points within radius_m of a common member. O(n^2), fine here."""
    if not pts:
        return []
    best: list[Photo] = []
    for seed in pts:
        origin = (seed.lat, seed.lon)  # type: ignore[arg-type]
        members = [p for p in pts if haversine_m(origin, (p.lat, p.lon)) <= radius_m]  # type: ignore[arg-type]
        if len(members) > len(best):
            best = members
    return best


def run_exiftool(paths: list[str]) -> list[dict]:
    if not shutil.which("exiftool"):
        sys.exit("exiftool not found. brew install exiftool | apt install libimage-exiftool-perl")
    cmd = ["exiftool", "-j", "-q", "-q", "-r", "-d", DATE_FMT,
           "-api", "largefilesupport=1"]
    cmd += [f"-{t}" for t in TAGS]
    cmd += paths
    out = subprocess.run(cmd, capture_output=True, text=True)
    if not out.stdout.strip():
        sys.exit(f"exiftool returned nothing. stderr:\n{out.stderr.strip()}")
    return json.loads(out.stdout)


def parse_when(rec: dict) -> datetime | None:
    for key in ("DateTimeOriginal", "CreateDate", "FileModifyDate"):
        raw = rec.get(key)
        if not raw:
            continue
        # exiftool may append a zone offset; the wall-clock time is what matters
        # for windowing, so take the first 19 chars and treat it as naive local.
        stamp = str(raw)[:19]
        for fmt in DATE_FORMATS:
            try:
                return datetime.strptime(stamp, fmt)
            except ValueError:
                continue
    return None


def load(paths: list[str]) -> tuple[list[Photo], int]:
    photos, skipped = [], 0
    for rec in run_exiftool(paths):
        mime = rec.get("MIMEType") or ""
        if not mime.startswith(("image/", "video/")):
            skipped += 1
            continue
        lat, lon = rec.get("GPSLatitude"), rec.get("GPSLongitude")
        photos.append(Photo(
            path=rec.get("SourceFile", ""),
            name=rec.get("FileName", ""),
            when=parse_when(rec),
            lat=float(lat) if isinstance(lat, (int, float)) else None,
            lon=float(lon) if isinstance(lon, (int, float)) else None,
            make=(rec.get("Make") or "").strip() or None,
            model=(rec.get("Model") or "").strip() or None,
            mime=mime,
            size=int(rec.get("FileSize") or 0),
        ))
    return photos, skipped


def sessionise(photos: list[Photo], gap_hours: float, min_size: int) -> list[Session]:
    dated = sorted((p for p in photos if p.when), key=lambda p: p.when)  # type: ignore[arg-type]
    sessions, current = [], Session()
    for p in dated:
        if current.photos and (p.when - current.photos[-1].when) > timedelta(hours=gap_hours):  # type: ignore[operator]
            sessions.append(current)
            current = Session()
        current.photos.append(p)
    if current.photos:
        sessions.append(current)
    return [s for s in sessions if len(s.candidates) >= min_size]


def assess(session: Session, radius_m: float) -> dict:
    cands = session.candidates
    geo = [p for p in cands if p.has_gps]
    geo_rate = len(geo) / len(cands) if cands else 0.0

    cluster = dominant_cluster(geo, radius_m)
    cluster_share = len(cluster) / len(geo) if geo else 0.0

    spread = None
    if len(cluster) > 1:
        clat = statistics.fmean(p.lat for p in cluster)  # type: ignore[misc]
        clon = statistics.fmean(p.lon for p in cluster)  # type: ignore[misc]
        spread = statistics.median(
            haversine_m((clat, clon), (p.lat, p.lon)) for p in cluster  # type: ignore[arg-type]
        )

    confident = geo_rate >= MIN_GEO_RATE and cluster_share >= MIN_CLUSTER_SHARE
    # Only meaningful when we'd actually pre-select. In a degraded session the
    # filter never runs, so nothing was "excluded" — the user just picks.
    excluded = [p for p in cands if p not in cluster] if confident else []

    return {
        "start": session.start.isoformat(timespec="minutes"),
        "end": session.end.isoformat(timespec="minutes"),
        "hours": round((session.end - session.start).total_seconds() / 3600, 1),
        "photos_in_window": len(cands),
        "screenshots_dropped": len(session.photos) - len(cands),
        "geotagged": len(geo),
        "geo_rate": round(geo_rate, 3),
        "cluster_size": len(cluster),
        "cluster_share_of_geotagged": round(cluster_share, 3),
        "cluster_spread_m": round(spread) if spread is not None else None,
        "would_preselect": confident,
        "preselect_count": len(cluster) if confident else 0,
        "excluded_by_cluster": [p.name for p in excluded],
        "devices": sorted({p.device for p in cands}),
    }


def report(photos: list[Photo], sessions: list[Session], results: list[dict],
           radius_m: float, show_excluded: bool) -> None:
    imgs = [p for p in photos if not p.is_screenshot]
    undated = [p for p in photos if not p.when]
    geo_all = [p for p in imgs if p.has_gps]

    print("=" * 72)
    print("GEOTAG COVERAGE PROBE")
    print("=" * 72)
    print(f"\nFiles analysed        {len(photos)}")
    print(f"  screenshots         {len(photos) - len(imgs)}")
    warn = "   <-- see README §2, a stripping collection path looks like this" \
        if len(undated) > len(photos) * 0.1 else ""
    print(f"  missing a timestamp {len(undated)}{warn}")
    if imgs:
        print(f"Library-wide GPS      {len(geo_all)}/{len(imgs)} ({len(geo_all) / len(imgs):.0%})")

    devices: dict[str, list[Photo]] = {}
    for p in imgs:
        devices.setdefault(p.device, []).append(p)
    if len(devices) > 1:
        print("\nBy device (weak proxy for per-person coverage — see README):")
        for dev, ps in sorted(devices.items(), key=lambda kv: -len(kv[1])):
            n_geo = sum(1 for p in ps if p.has_gps)
            print(f"  {dev:<34} {n_geo:>5}/{len(ps):<5} {n_geo / len(ps):>4.0%}")

    print(f"\n{'-' * 72}")
    print(f"CANDIDATE EVENTS  (cluster radius {radius_m:.0f}m)")
    print(f"{'-' * 72}")
    if not results:
        print("\nNo sessions large enough to assess. Lower --min-session or widen --gap-hours.")
        return

    hdr = f"{'when':<17}{'hrs':>5}{'n':>6}{'gps':>6}{'clust':>7}{'spread':>8}  verdict"
    print(hdr)
    for r in results:
        spread = f"{r['cluster_spread_m']}m" if r["cluster_spread_m"] is not None else "-"
        verdict = f"pre-select {r['preselect_count']}" if r["would_preselect"] else "SHOW, TICK NOTHING"
        print(f"{r['start'][:16]:<17}{r['hours']:>5}{r['photos_in_window']:>6}"
              f"{r['geo_rate']:>6.0%}{r['cluster_share_of_geotagged']:>7.0%}{spread:>8}  {verdict}")

    confident = [r for r in results if r["would_preselect"]]
    offered = sum(r["photos_in_window"] for r in confident)
    kept = sum(r["preselect_count"] for r in confident)

    print(f"\n{'=' * 72}")
    print("HEADLINE")
    print(f"{'=' * 72}")
    print(f"\n  {len(confident)}/{len(results)} candidate events "
          f"({len(confident) / len(results):.0%}) would get a confident pre-selection.")
    print("  The rest degrade to a grid with nothing ticked — usable, not magic.")

    if confident:
        print(f"\n  Within those {len(confident)}:")
        print(f"    time window alone would tick   {offered}")
        print(f"    location filter ticks          {kept}")
        if offered:
            print(f"    removed by location            {offered - kept} "
                  f"({(offered - kept) / offered:.0%})")
        print("\n  Those removals are the whole point: eyeball them with --show-excluded.")
        print("  Every one genuinely from the event is a recall miss (cheap — one tap")
        print("  on 'show everything'). Every one that was private is the failure the")
        print("  filter exists to prevent (expensive — you don't get that trust back).")

    if show_excluded:
        print(f"\n{'-' * 72}\nEXCLUDED BY THE LOCATION FILTER\n{'-' * 72}")
        for r in results:
            if r["excluded_by_cluster"]:
                print(f"\n  {r['start'][:16]}  ({len(r['excluded_by_cluster'])} excluded)")
                for n in r["excluded_by_cluster"]:
                    print(f"    {n}")

    print(f"\n{'=' * 72}")
    print("HOW TO READ THIS")
    print(f"{'=' * 72}")
    rate = len(confident) / len(results)
    if rate >= 0.7:
        print("\n  Auto-selection is viable. The location filter is doing real work,")
        print("  and most events get a tight suggestion. Build it.")
    elif rate >= 0.4:
        print("\n  Mixed. Auto-selection works for some events and degrades for others.")
        print("  The degraded path (grid, nothing ticked) has to be genuinely good,")
        print("  because a large minority of contributors will land on it.")
    else:
        print("\n  Auto-selection as designed does not hold on this library. Before")
        print("  concluding that, verify the collection path (README) — a stripping")
        print("  path produces exactly this result on a perfectly healthy roll.")
    print("\n  This is ONE library, so it is n=1 for the population question:")
    print("  'what share of party guests have geotagging on'. It is a good sample")
    print("  for clustering quality and a bad one for coverage. See README §3.\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+", help="directories or files of ORIGINAL photos")
    ap.add_argument("--gap-hours", type=float, default=4.0,
                    help="gap that separates one candidate event from the next (default 4)")
    ap.add_argument("--min-session", type=int, default=8,
                    help="ignore sessions smaller than this (default 8)")
    ap.add_argument("--cluster-radius-m", type=float, default=150.0,
                    help="dominant-cluster radius in metres (default 150)")
    ap.add_argument("--show-excluded", action="store_true",
                    help="list files the location filter removed, for eyeballing")
    ap.add_argument("--json", metavar="FILE", help="also write raw results as JSON")
    args = ap.parse_args()

    photos, skipped = load(args.paths)
    if not photos:
        sys.exit("No image or video files found.")
    if skipped:
        print(f"(skipped {skipped} non-media files)\n", file=sys.stderr)

    sessions = sessionise(photos, args.gap_hours, args.min_session)
    results = [assess(s, args.cluster_radius_m) for s in sessions]
    report(photos, sessions, results, args.cluster_radius_m, args.show_excluded)

    if args.json:
        with open(args.json, "w") as fh:
            json.dump({"sessions": results}, fh, indent=2)
        print(f"Wrote {args.json}")


if __name__ == "__main__":
    main()
