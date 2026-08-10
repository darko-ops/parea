# Technical design — v1

Companion to [`concept.md`](./concept.md). That document says what to build and
why. This one says how, and records the decisions that are expensive to change
later.

Status: proposal. Nothing here is built. Open decisions are collected in §12.

## 0. What the architecture has to survive

Five constraints from the concept drive nearly every choice below.

1. **No account on the upload path.** Identity has to exist (you can delete your
   own uploads) without authentication existing. This is the single most
   structurally unusual requirement.
2. **Egress kills photo products.** A 250-photo event is ~1GB; twenty people
   pulling the full set is 20GB. Bulk download is the *core action*, not a rare
   one. Bytes must never traverse a metered egress path.
3. **Bulk upload happens in mobile Safari.** Tab suspension, memory limits,
   HEIC, cellular. The upload client is the hardest piece of engineering in v1.
4. **Access control must be a policy layer, not an assumption.** Paid galleries
   are deferred, not ruled out. "Everyone who is in gets everything" must be one
   policy among possible others, evaluated in one place.
5. **Originals, not compressed copies.** Constrains what we're allowed to do to
   the bytes at ingest (§6.3).

## 1. Shape of the system

```
                    ┌────────────────────────────────────────┐
   browser  ───────▶│  Next.js (app + API)          Vercel   │──▶ Postgres (Neon)
   (HTML/JSON only) │  auth, policy, metadata, presigning    │
                    └────────────────────────────────────────┘
        │
        │  photo bytes never touch the box above
        ▼
   ┌──────────────────────────────────────────────────────────┐
   │  Cloudflare                                              │
   │    R2 bucket            originals + derivatives          │
   │    Worker: /img/*       signed reads, CDN-cacheable      │
   │    Worker: /zip/*       streaming archive of an event    │
   │    Queue → deriver      thumbnails, EXIF, hashes         │
   └──────────────────────────────────────────────────────────┘
```

**The control plane and the data plane are separate on purpose.** Next.js on
Vercel serves HTML and JSON and issues signed URLs; it never proxies image
bytes. Every byte of photo data moves browser ↔ R2 directly, or browser ↔
Cloudflare Worker ↔ R2. R2 has no egress fee, and Worker→R2 reads are free.

The failure mode this avoids is mundane and fatal: writing
`return new Response(await r2.get(key).body)` from a Vercel function, which
routes 20GB per event through metered bandwidth. It is easy to do by accident
and invisible until the bill. Treat "no photo bytes through the Next.js origin"
as an architectural invariant with a test (§11).

### Why not run everything on one platform

Two coherent alternatives, both rejected for v1:

- **All Cloudflare** (Next.js on Workers via OpenNext). Removes the split, but
  puts the app framework on the less-trodden runtime while we're also doing the
  genuinely hard upload work. Revisit once the product is real; the split above
  is designed so the app tier is thin enough to move.
- **All AWS** (S3 + CloudFront). CloudFront egress at ~$0.085/GB means a single
  well-attended event costs more to deliver than a month of everything else.
  Non-starter given bulk download is the point.

### Stack

| Layer | Choice | Note |
|---|---|---|
| App | Next.js (App Router), TypeScript | |
| DB | Postgres — Neon | serverless driver over HTTP, no pooler to run |
| ORM/migrations | Drizzle | SQL-first, migrations checked in |
| Object storage | Cloudflare R2 | zero egress, S3-compatible API |
| Edge compute | Cloudflare Workers | image reads, zip streaming |
| Async work | Cloudflare Queues → container consumer | libvips/libheif won't run in a Worker (§6.2) |
| Rendering | Server components for grid; client island for upload | |

## 2. Identity without accounts

Three concepts, deliberately distinct:

- **Actor** — *who did this*. Every upload, removal, and membership belongs to
  an actor. An actor may be a guest (a signed cookie, no credentials) or a user
  (an account with a login).
- **Capability** — *what this browser is allowed to do right now*. Derived from
  possession of a link or code, or from actor membership.
- **Account** — optional, and only ever asked for after value has been
  delivered.

```sql
actor
  id            uuid pk
  kind          text        -- 'guest' | 'user'
  display_name  text null   -- the optional name field, guest-editable
  account_id    uuid null   -- set when a guest claims an account
  created_at    timestamptz

account
  id            uuid pk
  email         citext unique
  created_at    timestamptz
```

A guest actor is minted lazily — on first *contribution*, not first visit — and
carried in a signed, httpOnly, `SameSite=Lax`, 400-day cookie holding only the
actor id. It is site-wide, not per-event: the same guest at three different
parties is one actor, which is what makes "you already have 60 photos here, want
to keep them?" a truthful upgrade prompt rather than a signup wall.

**Claiming an account is `UPDATE actor SET account_id = …`.** Nothing moves, no
uploads are reassigned, no merge logic. If a user later signs in on a second
device, that device's guest actor is merged into the account's canonical actor
(uploads repointed, guest actor tombstoned) — the one merge path in the system,
and it only runs on explicit sign-in.

### What breaks, and what we accept

Losing the cookie loses the ability to delete your own uploads. There is no way
around this without an account, and adding one costs contributors. Mitigations:
the report/removal-request path (§9) works for anyone, the host can always
remove, and the account upgrade prompt appears exactly when someone has
something worth protecting. **Accepted.**

### Capabilities and the referrer problem

The event link *is* the credential. That means it must not leak. Two measures:

- On a valid link visit, the server sets a scoped capability cookie
  (`cap_<eventId>`, signed, session-length-ish) and every subsequent API call
  authorizes off the cookie. The secret appears in exactly one URL, once.
- `Referrer-Policy: no-referrer` site-wide, so the capability URL never rides
  along to any third-party asset or outbound click.

Rotating the link is a supported host action (§4), and it is the correct answer
to "a stranger got the link" — stronger than closing uploads, since it also
revokes reads.

## 3. Data model

```sql
"group"
  id            uuid pk
  name          text
  slug          text unique          -- vanity-ish, for group search results
  findable      boolean default false -- asked once at creation
  created_at    timestamptz
  deleted_at    timestamptz null

group_member
  group_id      uuid fk
  actor_id      uuid fk
  role          text                 -- 'member' | 'admin'
  joined_at     timestamptz
  primary key (group_id, actor_id)

event
  id            uuid pk
  link_token    text unique          -- 22-char base62 (~131 bits); the credential
  name          text
  event_date    date null
  group_id      uuid null fk
  created_by    uuid fk actor
  access_policy text default 'link_open'   -- see §5
  joins_open    boolean default true
  uploads_open  boolean default true
  expires_at    timestamptz null     -- retention lever; null for grouped events
  last_active_at timestamptz         -- drives code recycling and expiry
  created_at    timestamptz
  deleted_at    timestamptz null

code                                  -- spoken word-pairs, recycled
  id            uuid pk
  words         text unique           -- 'amber-fox'
  event_id      uuid null fk          -- null when in the free pool
  claimed_at    timestamptz null
  released_at   timestamptz null

photo
  id            uuid pk
  event_id      uuid fk
  uploader_id   uuid fk actor
  storage_key   text                  -- r2 key, content-addressed
  content_hash  bytea                 -- sha256 of stored bytes
  crc32         bigint                -- precomputed for zip (§7)
  byte_size     bigint
  mime          text
  width, height integer null
  captured_at   timestamptz null      -- from EXIF; falls back to uploaded_at
  captured_offset_minutes integer null
  uploaded_at   timestamptz
  status        text                  -- 'pending' | 'ready' | 'failed' | 'removed'
  deleted_at    timestamptz null

derivative
  photo_id      uuid fk
  kind          text                  -- 'thumb' | 'grid' | 'full'
  storage_key   text
  width, height integer
  mime          text
  primary key (photo_id, kind)

report
  id, photo_id, reporter_actor_id null, kind, note, created_at, resolved_at
```

Notes on decisions embedded above:

- **`link_token` is separate from `id`.** Rotation is a column update, not an
  identity change. If the token were the primary key, revocation would mean
  rewriting every foreign key.
- **Content-addressed storage keys** (`ev/<eventId>/<sha256>`) make re-uploads
  idempotent. The same photo forwarded and re-contributed by two people
  collapses to one object with a unique index on `(event_id, content_hash)
  where deleted_at is null`. Both uploaders can keep an attribution row if we
  want it later; v1 keeps first-writer.
- **`captured_at` is untrusted.** Phone clocks disagree, and a chronological
  grid across six devices will interleave wrongly by minutes to hours. v1 sorts
  by `coalesce(captured_at, uploaded_at)` and accepts it. If it looks bad in
  practice, the fix is per-uploader offset estimation, not a schema change.
- **Soft delete everywhere**, with a purge job that removes R2 objects after a
  grace window (§10). Immediate hard delete makes "undo" impossible and makes
  abuse investigation impossible.

## 4. Event lifecycle and the three switches

The concept specifies three independent switches, all defaulting open. They map
directly:

| Switch | Column | Default | Closing it |
|---|---|---|---|
| Can new people join? | `joins_open` | true | link stops granting access to new actors; existing keep it |
| Is the code valid? | `code.event_id` | claimed | released on dormancy or host action |
| Can people still upload? | `uploads_open` | true | reads unaffected |

Plus **rotate link** — issues a new `link_token`, invalidates outstanding
capability cookies for that event (bump a per-event `cap_epoch` included in the
cookie signature). This is the "shut it down" button that actually works.

**Codes.** ~1,024 curated adjectives × ~1,024 nouns ≈ 1M pairs, pre-filtered for
unfortunate combinations, wordlist checked into the repo and reviewed. Allocation
is `SELECT … WHERE event_id IS NULL ORDER BY random() LIMIT 1 FOR UPDATE SKIP
LOCKED` — no retry loop, no birthday-collision math, and the free pool is
explicit. A code returns to the pool when its event has been dormant (no view,
no upload) for 90 days. Short codes only stay short if they recycle; late
arrivals only work if they recycle *slowly*. 90 days is a guess to revisit.

## 5. Access as a policy layer

Every read, write, and download passes through one function. Not a middleware,
not scattered `if` statements — one module, and a lint rule that forbids
querying `photo` outside the data-access layer that calls it.

```ts
type Capability = 'view' | 'contribute' | 'download' | 'administer'

function authorize(
  actor: Actor | null,
  capability: Capability,
  resource: { event: Event; group?: Group },
  presented: { linkToken?: string; code?: string; capEpoch?: number },
): Decision   // { allow: true } | { allow: false; reason: … }
```

v1 ships exactly one policy, `link_open`: possession of a valid link or code
grants `view`, `contribute`, and `download`; the creator and group admins also
get `administer`. That is a handful of lines. The point is not the policy — it's
that `event.access_policy` is a column with one value today, so adding
`paid_gallery` later is a new branch in one function plus an entitlement check,
not an archaeology project across forty call sites.

Correspondingly: **events own photos, groups own events.** No photo is reachable
except through an event, and no query fetches photos without an event in scope.
This is what makes a future per-collection access rule expressible at all.

The concept's governing rule — *groups can be findable, photos never are* — is
enforced structurally. Group search hits a `group` index that contains no photo
join. There is no event search index and no photo search index. Search returns a
door.

## 6. Upload

The hard part. Design target: someone dumping 200 HEIC originals from an iPhone
on cellular, who will lock their phone halfway through.

### 6.1 The path

```
1. client   POST /api/events/:id/uploads   { files: [{name, size, type}, …] }
2. server   authorize(contribute) → per-file presigned PUT to R2 (15 min)
            → rows in `photo` with status='pending'
3. client   PUT each file directly to R2, concurrency 3
4. R2       event notification → Cloudflare Queue
5. deriver  read original, sha256, EXIF, crc32, derivatives → R2
            → PATCH photo: status='ready', dimensions, captured_at, hash
6. client   grid subscribes and fills in as photos flip to 'ready'
```

Bytes go browser → R2. Nothing else is on that path.

### 6.2 Deriving thumbnails

HEIC decoding needs libheif; libvips/sharp will not run in a Workers isolate.
So the deriver is a container (Fly.io or Railway) consuming a Cloudflare Queue,
with R2 bindings over the S3 API. Three derivatives per photo:

| Kind | Longest edge | Format | Use |
|---|---|---|---|
| `thumb` | 320px | AVIF, JPEG fallback | grid |
| `grid` | 1280px | AVIF, JPEG fallback | grid on retina / quick look |
| `full` | 2560px | JPEG | lightbox, and the "just give me something I can open" download for non-Apple recipients |

The alternative is Cloudflare Images, which handles HEIC and removes the
container. It costs per image stored and per delivery, and it's a per-unit cost
on exactly the axis that grows. Container first; switch if operating it becomes
the tax rather than the savings.

**HEIC is not converted on the client.** WASM decode of 200 files on a phone is
minutes of blocked CPU and a dead battery. Originals upload as HEIC; the server
makes viewable derivatives. Note the consequence: an Android recipient
downloading originals gets files their gallery may not open. v1 offers "download
originals" and "download as JPEG" (the `full` derivative) side by side, which is
also the honest framing of the format problem.

### 6.3 What we do to the bytes

"Originals, not compressed copies" and "strip precise location metadata by
default" are in tension. Resolution:

**Pixel data is never re-encoded.** Metadata is rewritten in place at ingest:
GPS blocks, device serial numbers, and owner-name fields are removed;
orientation, capture timestamp, camera model, and exposure data are kept. The
stored object is not byte-identical to what left the phone, and it is
pixel-identical. That is the right trade and it should be stated plainly in the
UI ("location removed") rather than buried.

Stripping happens in the deriver, not the client — client-side stripping can be
bypassed by anyone who wants to, and the guarantee needs to hold server-side.
Consequence: for a short window the un-stripped original sits in R2. Acceptable;
it is never served in that state (photos are only readable at `status='ready'`).

### 6.4 Surviving mobile Safari

Specific measures, each against a specific failure:

- **Never read a file into memory.** Pass the `File` straight to `fetch` as the
  body; it streams from disk. One `arrayBuffer()` on a 200-file selection is an
  out-of-memory tab crash.
- **Concurrency 3.** Higher hurts throughput on cellular and multiplies memory
  pressure. Tuned by measurement, not vibes.
- **Persist the queue in IndexedDB, including the `File` handles.** Safari
  structured-clones `File` objects into IndexedDB and they survive a reload, so
  a suspended-and-killed tab resumes rather than restarts. This is the single
  highest-value piece of the upload client.
- **Idempotent retries.** Content-addressed keys plus the unique index mean
  re-PUTting a file that actually completed is a no-op, so the resume path can
  be dumb and aggressive.
- **Screen Wake Lock** while a large upload runs, with a visible "keep this
  screen on" line. Safari 16.4+; a no-op elsewhere.
- **No background completion exists on iOS web.** Do not pretend otherwise. The
  UI states plainly how many remain and that the tab must stay open — the
  concept's "close the tab" affordance is honest for a four-photo contribution
  and a lie for a 200-photo one. Progress is per-file, so a partial upload is
  partial photos, not zero.

This is also where the native-app argument lives. Web handles the many-shooters
mode well and the few-shooters mode adequately. If the 200-photo case turns out
to be where the product's value is, that's the trigger for a native client — and
it changes nothing server-side, which is the point of putting the upload
protocol behind presigned PUTs.

### 6.5 Rate limits

Anyone with a link can upload anything. Per-actor, per-event: 500 photos and
5GB, and 50 files per presign request. Per-IP presign rate limiting on top.
These are anti-catastrophe bounds, not product limits; log when they bite.

## 7. Download

Bulk download of originals is the product's terminal action and its main cost
centre.

**A Worker streams the zip.** It reads objects from R2 (free) and writes a
`STORE`-method (no compression — JPEG and HEIC are already compressed, so
deflate burns CPU for ~0%) Zip64 archive to the response as it goes. Nothing is
staged; there is no temporary archive object and no job queue.

The refinement that matters: **crc32 and byte size are precomputed at ingest**,
and the file ordering is deterministic. With those, the exact archive length is
computable up front, so the response carries a real `Content-Length`. The
browser shows a real progress bar and a real time estimate instead of an
indeterminate spinner on a 1GB download — and deterministic layout makes
`Range` resume implementable later without changing the format.

Zip64 from the start, not conditionally: events crossing 4GB are ordinary for
video, and a format switch under load is a bug waiting to happen.

Selection downloads (`some`) use the same endpoint with an id list, capped at a
length that keeps the URL sane — POST to mint a short-lived manifest token, then
GET the zip with it, so the download is a plain navigation the browser can own.

## 8. Serving images, and CDN cache keys

Grid views request 200 thumbnails. Two bad options and one good one:

- Presigned R2 URLs per image — 200 HMACs per page load is fine, but every URL
  is unique per request, so the CDN cache hit rate is zero and every thumbnail
  is an origin read forever.
- Worker checks the capability cookie — correct, but cookie-varying responses
  are effectively uncacheable at the edge.
- **Signed path with a coarse expiry.** `/img/<photoId>/<kind>?e=<hourBucket>&s=<hmac>`
  where the signature covers the photo, kind, and an expiry rounded up to the
  next hour boundary. Every viewer of the same event within the same hour
  generates *identical* URLs, so the edge cache actually works, and the URL
  stops working within the hour. Cache-Control `private, max-age=3600` at the
  browser, edge-cached by the Worker's own cache API.

The signature is scoped to the event's `cap_epoch`, so rotating the link
invalidates outstanding image URLs too.

## 9. Safety, moderation, and legal floor

The concept lists the day-one needs. Concretely:

- **Remove your own upload** — actor-scoped, immediate soft delete, no review.
- **Request removal of a photo of you** — available to anyone with view access,
  no account. Routes to the event creator with a 48h auto-hide if unanswered.
  Auto-hide rather than auto-delete: the wrong default in either direction is
  bad, but "temporarily invisible" is recoverable and "gone" isn't.
- **Report** — to us, not the host. Queue, no SLA promises we can't keep.
- **Delete event** — creator or group admin, soft delete then purge.
- **Location metadata stripped** by default (§6.3).

Two things that are not optional and should be designed in now rather than
bolted on:

- **CSAM detection.** Anonymous image uploads from unverified contributors is
  precisely the risk surface. Cloudflare's CSAM Scanning Tool works against R2
  and is free; wire it at ingest. Detection carries a legal reporting obligation
  to NCMEC (18 U.S.C. §2258A) and a preservation obligation — which means an
  incident runbook and a named human, before launch, not after the first hit.
  Get counsel on the reporting workflow; this design just ensures the hooks and
  the preservation-safe soft-delete exist.
- **Minors.** The concept's position is "avoid as a target market; if it happens
  organically, private-only and no matching." Nothing in the schema encourages
  it; there is no face matching to disable, which is most of the protection.

## 10. Jobs

| Job | Cadence | Does |
|---|---|---|
| `purge-deleted` | hourly | hard-deletes R2 objects for rows soft-deleted > 30d |
| `expire-events` | daily | ungrouped events past `expires_at` → soft delete (§ monetization lever 2) |
| `recycle-codes` | daily | releases codes for events dormant 90d |
| `nudge` | event-scoped | one reminder, once, at a time TBD |

`nudge` is the only one that touches users, and the concept is explicit that it
is one well-timed reminder and not notification spam. Build it as a
single-shot scheduled message with a hard per-event cap of one, enforced in the
schema (`event.nudged_at is null`), so the cap can't be lost to a config change.

Retention default: ungrouped events get `expires_at = created_at + 60 days`,
grouped events get null. Not enforced in v1 — the column is populated, the job
is written, and the switch stays off until there's a reason. Backfilling an
expiry policy onto events created without one is a support nightmare; having the
column from day one costs nothing.

## 11. Testing the things that actually break

Ordinary unit tests aside, four checks earn their place:

1. **Egress invariant.** A test that fails the build if any Next.js route
   handler returns a body sourced from R2. The cost failure is silent, gradual,
   and unrecoverable after the fact.
2. **Authorization matrix.** Table-driven over (actor kind × capability ×
   policy × switch state). This is the file that will be wrong in a year.
3. **Upload resume.** Integration test that kills the client mid-queue and
   reopens it, asserting no duplicates and no missing files. Content-addressing
   makes this assertable.
4. **Zip correctness.** A generated archive of >4GB with unicode filenames,
   verified by a real unzip implementation. Zip64 and filename encoding are
   where homegrown zip writers fail, and they fail on the user's machine, after
   a 20-minute download.

## 12. Open decisions

Things this document does not settle, roughly by when they need settling.

- **Deriver: container vs. Cloudflare Images.** Cost crossover depends on photos
  stored vs. delivered; needs real numbers, not estimates. Container first.
- **Nudge timing.** Next morning? 48h? Unknown, and it's a product question that
  wants the first real events to answer it.
- **Clock skew in the timeline.** Ignored in v1. May look obviously broken the
  first time six phones contribute to one grid.
- **Video.** Concept names it as a candidate paywall. Nothing here forbids it —
  storage keys, zip streaming, and derivatives all generalize — but transcoding
  is a second pipeline and it should stay out until the photo case works.
- **The 200-photo web upload.** §6.4 mitigates, it does not solve. The honest
  possibility is that it's *good enough* for four-photo contributors and never
  good enough for the heavy shooter, and that a native client is not optional.
  Measure completion rate by selection size from day one; that single metric
  decides it.
- **Group-search abuse.** Findable groups are a namespace, and namespaces get
  squatted and impersonated. Rate limits and a report path may not be enough.
  Low urgency while groups are rare; revisit before promoting group search.
- **Where the app tier lives long-term.** Vercel is right for now. If everything
  interesting ends up in Workers anyway, consolidating is a small migration
  precisely because the app tier stays thin.

## 13. Instrumentation for the §6 question

The concept's next step is an unbuilt-product test: *does anyone other than the
creator upload?* When code exists, the same question is the primary product
metric, and these are the events that answer it. Worth wiring in the first
release rather than the third.

- contributors per event (the number; 1 is the failure case)
- time from event creation to first upload by a non-creator
- distribution of photos per contributor (one heavy shooter vs. several light)
- download rate — did anyone actually leave with the photos
- return rate — did a second event happen with an overlapping set of people
- upload completion rate **bucketed by selection size** (decides web vs. native)
- group formation rate (decides whether the monetization model exists at all)
