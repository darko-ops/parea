# Deriver

Ingest — docs/design.md §7.5–7.7. Takes an uploaded original and makes it safe
and usable: strips location, extracts the capture time, builds derivatives,
moves the object to a content-addressed key, and flips the photo to `ready`.

Nothing in the product lists, serves or downloads a photo before `ready`, so
this is also the gate that stops an un-stripped original ever reaching a viewer.
If ingest fails, the photo stays invisible rather than becoming visible in an
unsafe state.

```
npm run probe          # can this machine actually do the job?
npm run once           # drain pending photos and exit
npm run watch          # poll forever
```

Needs `DATABASE_URL`, and either R2 credentials or (in development) the same
`.storage` directory the web app writes to.

## Run the probe first

Two dependencies are easy to get wrong and both fail in ways that look like
something else:

```
ok    exiftool             12.76
ok    sharp:heif           reported
FAIL  decode:hevc/sharp    no HEVC decoder — fallback required
ok    decode:hevc/libheif  heif-convert available
```

**`sharp:heif` being green means nothing.** sharp's prebuilt libvips parses the
HEIF container without being able to decode HEVC, so `sharp(photo).metadata()`
returns a confident `{ format: 'heif', width: 4032 }` and then rasterising the
same buffer fails with `bad seek`. Every iPhone photo is HEVC-coded HEIC, so a
build that only passes the format-table check fails on essentially every real
upload. The probe decodes an embedded 442-byte HEVC sample instead of asking.

When sharp cannot decode HEVC — which is the normal case — the pipeline shells
out to `heif-convert` from libheif for a lossless PNG intermediate and resizes
that. It costs one process and one temp file per HEIC. The `Dockerfile`
installs `libheif-plugin-libde265` for this, and runs the probe at build time
so an image that cannot ingest photos fails to build.

## What it does to an original

Removed: GPS in every container it hides in (EXIF, XMP, QuickTime), device
serial numbers, owner and artist fields.

Kept: orientation, `DateTimeOriginal` and its UTC offset, camera make and model,
exposure.

**Pixel data is never re-encoded**, and that is verified rather than assumed.
exiftool can hash the compressed image data alone, so the pipeline compares that
hash before and after stripping and fails the photo if it changed. It then
re-reads the file to confirm location is actually gone — some formats accept a
write and keep the tag. Both are cheap, and both protect a promise made to users
in the UI.

Derivatives (`thumb` 320px, `grid` 1280px, `full` 2560px) *are* re-encoded, to
JPEG, with all metadata dropped. `full` doubles as the "download as JPEG"
option, so an Android recipient handed a folder of HEICs has something openable.

## Dedup

The content hash is taken over the *stripped* bytes, so two people contributing
the same photo produce the same hash — which only holds because stripping is
deterministic. There is a test for that; if exiftool ever starts writing a
timestamp or version of its own, dedup silently stops working and that test is
what catches it.

First writer wins. The duplicate is tombstoned and its object deleted, so the
second uploader still sees their upload complete rather than an error.

## Known gaps

**It polls.** The design has R2 event notifications driving a Cloudflare Queue,
which reacts immediately and does not scan. `watch` polls Postgres every 5s
instead, because that needs no Cloudflare account and keeps ingest working in
development. The pipeline does not care how work arrives, so the queue is a
change to `index.ts` only.

**Derivatives are JPEG, not AVIF.** The design specifies AVIF with a JPEG
fallback for the two smaller sizes. That means two encodings per size and
`Accept`-based selection at the edge, which belongs with the image Worker that
does not exist yet. Until then this is a bandwidth cost, not a correctness one,
and R2 egress is free.

**Serial processing.** One photo at a time per drain. Fine at current volumes;
the obvious first change if ingest ever becomes the bottleneck.
