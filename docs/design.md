# Technical design — v1

Companion to [`concept.md`](./concept.md). That document says what to build and
why. This one says how, and records the decisions that are expensive to change
later.

Status: built, undeployed. Everything below exists in the repository and is
tested; nothing has met a real device, bucket or user. Open decisions are
collected in §17, and what stands between here and a launch is in the
repository README.

**Amends the concept.** Section 4 of `concept.md` leaves web-vs-native open.
It is now decided: **React Native (Expo) is the primary client, and a stripped
browser path stays for people who won't install.** Two clients, one protocol.
§1 explains what that buys and what it costs.

## 0. What the architecture has to survive

Six constraints drive nearly every choice below. The first five come from the
concept; the sixth is a consequence of going native.

1. **No account on the upload path.** Identity has to exist (you can delete your
   own uploads) without authentication existing. Structurally the most unusual
   requirement in the product.
2. **Egress kills photo products.** A 250-photo event is ~1GB; twenty people
   pulling the full set is 20GB. Bulk download is the *core action*, not a rare
   one. Bytes must never traverse a metered egress path.
3. **Bulk upload of HEIC originals from a phone, on cellular, from someone who
   will lock their screen halfway through.**
4. **Access control must be a policy layer, not an assumption.** Paid galleries
   are deferred, not ruled out.
5. **Originals, not compressed copies.** Constrains what we may do to the bytes
   at ingest (§7.6).
6. **An install is a wall in front of contribution.** The concept is right that
   requiring one would gut contribution rates. Native is justified only if it
   *removes more friction than the install adds* — which is a claim about the
   contribution flow, not about upload plumbing (§7).

## 1. Two clients, one protocol

### Why native at all

Better background uploads are the obvious reason and the weak one. The real
reason is that **a native client can select the photos for you.**

The concept identifies the chore precisely: "go into their camera roll, find the
ones with you in them, and send them over." A web file picker cannot help with
that — it hands over files and nothing else, so the human does the finding. A
native client with photo-library access can query the camera roll by capture
time and open on *"47 photos from Saturday 8–2. Add them all?"*

That collapses the central friction of the product from a fifteen-minute sorting
task to one tap. It is the only thing in this design that attacks the actual
problem statement rather than the plumbing around it, and it is impossible on
the web. That is what pays for the install.

### What the install costs, honestly

Everyone who won't install is a contributor lost, and at a party that is a real
fraction — the plus-one, the coworker, the person on 3% battery. The concept
calls this correctly. So the web path survives:

| | Native (Expo) | Web |
|---|---|---|
| Auto-select by event time window | ✅ the reason it exists | ✗ impossible |
| Background / terminated upload | ✅ (iOS true, Android foreground service) | ✗ tab must stay open |
| Offline queueing at a bad-signal venue | ✅ | ✗ |
| Contribute | ✅ | ✅ degraded but complete |
| View, download originals, bulk zip | ✅ | ✅ full parity |
| Push nudge, group notifications | ✅ | ✗ |
| Persistent group identity | ✅ | link/code only |

**The web client is not a demo or a teaser.** It contributes and it downloads at
full quality. Its only real deficits are automatic selection, background upload,
and notifications. A four-photo contributor loses nothing worth naming; the
200-photo shooter is exactly who the app is for.

### One protocol

Both clients speak the same HTTP API, and both upload by `PUT`ing to a presigned
R2 URL. The server does not know or care which client it is talking to. This is
what makes two clients affordable — the second client is a UI, not a system.

Consequence to hold onto: **no upload feature may live in the server that only
one client can reach.** If the native client needs a new capability, it becomes
part of the shared protocol or it stays in the client.

## 2. Shape of the system

```
  ┌───────────────┐   ┌───────────────┐
  │ Expo app      │   │ Browser       │      HTML/JSON only
  │ iOS + Android │   │ (contribute,  │───────────────────────┐
  └───────────────┘   │  view, get)   │                       │
          │           └───────────────┘                       ▼
          │                   │              ┌────────────────────────────────┐
          └───────────────────┴─────────────▶│ Next.js (app + API)  Vercel    │──▶ Postgres
                                             │ auth, policy, metadata,        │    (Neon)
                                             │ presigning, deep-link pages    │
                                             └────────────────────────────────┘
          │
          │  photo bytes never touch the box above
          ▼
  ┌────────────────────────────────────────────────────────────┐
  │ Cloudflare                                                 │
  │   R2 bucket           originals + derivatives              │
  │   Worker /img/*       signed reads, CDN-cacheable          │
  │   Worker /zip/*       streaming archive of an event        │
  │   Queue → deriver     thumbnails, EXIF strip, hashes, CRC  │
  └────────────────────────────────────────────────────────────┘
```

**Control plane and data plane are separate on purpose.** Next.js serves HTML
and JSON and issues signed URLs; it never proxies image bytes. Every photo byte
moves client ↔ R2 directly, or client ↔ Cloudflare Worker ↔ R2. R2 has no egress
fee and Worker→R2 reads are free.

The failure mode this avoids is mundane and fatal: writing
`return new Response((await r2.get(key)).body)` in a Vercel route, which routes
20GB per event through metered bandwidth. Easy to do by accident, invisible
until the bill. Treat "no photo bytes through the Next.js origin" as an
invariant with a test (§15).

Rejected alternatives: **all-AWS** (CloudFront at ~$0.085/GB makes one popular
event cost more than a month of everything else); **all-Cloudflare** with
Next.js on Workers via OpenNext (removes the split, but puts the app framework
on the less-trodden runtime while we're also doing the hard client work —
revisit later, the app tier is deliberately thin enough to move).

### Stack

| Layer | Choice | Note |
|---|---|---|
| Mobile | Expo (React Native), EAS Build + EAS Update | dev builds, not Expo Go — native modules throughout |
| Web | Next.js App Router, TypeScript | also the API and the deep-link landing pages |
| DB | Postgres — Neon | serverless driver over HTTP |
| ORM | Drizzle | SQL-first, migrations checked in |
| Objects | Cloudflare R2 | zero egress, S3-compatible |
| Edge | Cloudflare Workers | image reads, zip streaming |
| Async | Cloudflare Queues → container consumer | libvips/libheif won't run in a Worker (§7.7) |
| Push | expo-notifications → APNs/FCM | one nudge, group events (§12) |

## 3. Identity without accounts

Three concepts, deliberately distinct:

- **Actor** — *who did this*. Owns uploads, removals, memberships. Either a
  guest (a credential on a device, no login) or a user (an account).
- **Credential** — *what this client is allowed to do right now*. Possession of
  a link or code, or an actor's own token.
- **Account** — optional, asked for only after value has been delivered.

```sql
actor
  id            uuid pk
  kind          text        -- 'guest' | 'user'
  display_name  text null   -- the optional name field
  account_id    uuid null   -- set when a guest claims an account
  created_at    timestamptz

account
  id            uuid pk
  email         citext unique
  created_at    timestamptz

device                       -- one row per install; native only
  id            uuid pk
  actor_id      uuid fk
  platform      text         -- 'ios' | 'android'
  push_token    text null
  last_seen_at  timestamptz
```

A guest actor is minted lazily — on first *contribution*, not first launch — and
is site-wide rather than per-event. The same guest at three parties is one
actor, which is what makes "you have 60 photos across 3 events, want to keep
them?" a true statement rather than a signup wall.

**Claiming an account is `UPDATE actor SET account_id = …`.** Nothing moves, no
uploads are reassigned. Signing in on a second device merges that device's guest
actor into the account's canonical actor (uploads repointed, guest tombstoned) —
the one merge path in the system, and it runs only on explicit sign-in.

### Where the credential lives

| Client | Storage | Notes |
|---|---|---|
| Native | `expo-secure-store` (Keychain / Keystore), bearer token | survives app updates; **may or may not survive uninstall** on iOS depending on OS version — do not depend on it |
| Web | signed httpOnly `SameSite=Lax` cookie, 400 days | site-wide, actor id only |

Different transport, one server-side notion. `authorize()` (§6) takes an
already-resolved actor; credential extraction is the only place that branches on
client type.

### The link is a credential, so it must not leak

On the web, a valid link visit exchanges the token for a scoped capability
cookie (`cap_<eventId>`, signed, carrying a per-event `cap_epoch`), so the
secret appears in exactly one URL, once. `Referrer-Policy: no-referrer`
site-wide, or the capability rides along in referer headers to every third-party
asset and outbound click. Native holds the equivalent as a scoped token.

Rotating the link bumps `cap_epoch`, invalidating outstanding cookies, tokens,
and signed image URLs at once. That — not "close uploads" — is the real answer
to *a stranger got the link*.

### What breaks, and what we accept

Losing the device credential loses the ability to delete your own uploads. There
is no fix that doesn't require an account, and requiring one costs contributors.
Mitigations: the removal-request path (§13) works for anyone, the host can
always remove, and the account prompt appears exactly when someone has something
worth protecting. **Accepted.**

## 4. Data model

```sql
"group"
  id uuid pk, name text, slug text unique
  findable boolean default false      -- asked once at creation
  created_at timestamptz, deleted_at timestamptz null

group_member
  group_id uuid, actor_id uuid, role text, joined_at timestamptz
  primary key (group_id, actor_id)

event
  id            uuid pk
  link_token    text unique           -- 22-char base62 (~131 bits); the credential
  cap_epoch     integer default 1     -- bumped on rotate
  name          text
  event_date    date null
  starts_at     timestamptz null      -- drives auto-select (§7.1)
  ends_at       timestamptz null
  group_id      uuid null fk
  created_by    uuid fk actor
  access_policy text default 'link_open'    -- §6
  joins_open    boolean default true
  uploads_open  boolean default true
  nudged_at     timestamptz null      -- hard cap of one, in the schema
  expires_at    timestamptz null      -- retention lever; null when grouped
  last_active_at timestamptz
  created_at timestamptz, deleted_at timestamptz null

code
  id uuid pk, words text unique       -- 'amber-fox'
  event_id uuid null fk               -- null while in the free pool
  claimed_at timestamptz null, released_at timestamptz null

photo
  id            uuid pk
  event_id      uuid fk
  uploader_id   uuid fk actor
  storage_key   text                  -- content-addressed: ev/<eventId>/<sha256>
  content_hash  bytea
  crc32         bigint                -- precomputed for zip (§10)
  byte_size     bigint
  mime          text
  width, height integer null
  captured_at   timestamptz null      -- EXIF; falls back to uploaded_at
  captured_offset_minutes integer null
  uploaded_at   timestamptz
  status        text                  -- 'pending' | 'ready' | 'failed' | 'removed'
  deleted_at    timestamptz null

derivative
  photo_id uuid, kind text, storage_key text, width int, height int, mime text
  primary key (photo_id, kind)

report
  id, photo_id, reporter_actor_id null, kind, note, created_at, resolved_at
```

Decisions embedded above:

- **`link_token` is separate from `id`.** Rotation is a column update, not an
  identity change. As a primary key it would make revocation a rewrite of every
  foreign key.
- **`starts_at` / `ends_at` exist for the native picker.** They are what turn
  "your camera roll" into "photos from this party." Nullable, inferred from the
  first uploads when the creator doesn't set them (§7.3).
- **Content-addressed keys** make re-uploads idempotent. A photo forwarded and
  contributed by two people collapses to one object, via a unique index on
  `(event_id, content_hash) where deleted_at is null`. This is also what lets
  the resume path be dumb and aggressive.
- **`captured_at` is untrusted, and sometimes absent.** Six phones with six
  clocks will interleave a chronological grid wrongly by minutes to hours. Worse,
  iOS Safari strips EXIF on upload, so web-contributed iPhone photos may arrive
  with no capture time at all (§8). v1 sorts on
  `coalesce(captured_at, uploaded_at)` and accepts both problems; see §17.
- **Soft delete everywhere**, purge job after a grace window (§14). Hard delete
  makes undo impossible and abuse investigation impossible.

## 5. Event lifecycle and the three switches

| Switch | Column | Default | Closing it |
|---|---|---|---|
| Can new people join? | `joins_open` | true | link stops admitting new actors; existing keep access |
| Is the code valid? | `code.event_id` | claimed | released on dormancy or host action |
| Can people still upload? | `uploads_open` | true | reads unaffected |

Plus **rotate link** (above), the one that actually revokes.

**Codes.** ~1,024 curated adjectives × ~1,024 nouns ≈ 1M pairs, pre-filtered for
unfortunate combinations, wordlist checked in and reviewed. Allocation is
`SELECT … WHERE event_id IS NULL ORDER BY random() LIMIT 1 FOR UPDATE SKIP
LOCKED` — no retry loop, no birthday-collision reasoning, and the free pool is
explicit. A code returns to the pool after 90 days of dormancy. Codes only stay
short if they recycle, and late arrivals only work if they recycle *slowly*; 90
days is a guess worth revisiting.

## 6. Access as a policy layer

Every read, write, and download passes through one function — not a middleware,
not scattered conditionals — with a lint rule forbidding queries against `photo`
outside the data-access layer that calls it.

```ts
type Capability = 'view' | 'contribute' | 'download' | 'administer'

function authorize(
  actor: Actor | null,
  capability: Capability,
  resource: { event: Event; group?: Group },
  presented: { linkToken?: string; code?: string; capEpoch?: number },
): Decision   // { allow: true } | { allow: false; reason: … }
```

v1 ships one policy, `link_open`: a valid link or code grants `view`,
`contribute`, and `download`; creator and group admins also get `administer`. A
handful of lines. The point isn't the policy — it's that `event.access_policy`
is a column with one value today, so `paid_gallery` later is a branch in one
function plus an entitlement check, not archaeology across forty call sites.

Correspondingly: **events own photos, groups own events.** No photo is reachable
except through an event. This is what makes a future per-collection rule
expressible at all.

The concept's rule — *groups can be findable, photos never are* — is enforced
structurally. Group search hits an index containing no photo join. There is no
event index and no photo index. Search returns a door.

## 7. Contribution — the native flow

This is the part that justifies the app. Everything else is plumbing.

### 7.1 Auto-selection

On opening an event, the app queries the local photo library for the event's
time window (`expo-media-library`'s `getAssetsAsync({ createdAfter, createdBefore })`),
narrows the result (§7.2), and presents what survives: *"31 photos from Saturday
night."* Confirm, tap once, done.

**The failure mode is not "we missed some," it is "we showed you something
private."** Saturday 8:14pm–1:40am also contains the screenshot, the photo of a
text thread, the parking spot, and the thing you photographed in the bathroom
mirror. A suggestion that surfaces one of those is not a small miss — the
contributor learns the feature cannot be trusted, and they never use it again.
Worse, it burns the photo-library permission at the same moment, and the
permission is not re-askable in practice.

So the governing rule is **precision over recall, always**. Thirty photos that
are all correct beats forty-seven with three wrong ones, and it beats it by a
lot, because the costs are asymmetric: a missed photo is recovered with one tap
on "show everything from this window," and a wrong photo is not recovered at
all.

### 7.2 Narrowing, and how confidence sets the default

Three filters, applied on-device, in order:

1. **Time window** — the event's `starts_at`/`ends_at` (below).
2. **Location cluster** — take the dominant spatial cluster among candidates
   that carry GPS, and keep only that cluster. Most events happen in one place,
   so this is the filter that does the real work.
3. **Not a screenshot** — subtract the Screenshots album membership rather than
   inspecting each asset, which is one extra query instead of hundreds.

Filter 2 deserves its own note, because it earns its place twice: screenshots,
saved images from other apps, photos of text threads, and photos taken somewhere
else all lack the event's GPS, so a single geometric rule removes most of the
embarrassing categories at once. That is a better mechanism than enumerating the
categories. Earlier drafts of this design deferred location narrowing as a
nice-to-have; it is load-bearing for precision and belongs in v1.

**Confidence decides how much is pre-selected, not whether the screen appears.**

| Signal | Behaviour |
|---|---|
| Most candidates carry GPS and cluster tightly | pre-select the cluster |
| Location sparse (camera geotagging off) or diffuse | show the time window with **nothing pre-selected** — the grid is still a shortcut, but the user does the choosing |
| No usable window at all | plain library picker |

Degrading to "here's a useful grid, you pick" is a good outcome. Degrading to
"here are 47 pre-ticked photos, three of which you'd be mortified to send" is
the outcome that kills the feature. When in doubt, suggest less.

A single **"show everything from this window"** affordance restores recall for
anyone who wants it, which is what makes the tight default safe.

**All of this happens on-device.** Capture times and locations are read from the
local library to decide *what to offer*. They are not uploaded, no clustering
happens server-side, and GPS is stripped from the files that are uploaded
(§7.5). The app knows where your photos were taken only in the sense that your
phone already does.

### 7.3 Where the window comes from, and the bootstrap problem

Three sources, in order of preference:

1. **Set at creation.** The create flow captures a window with a live default
   ("happening now" → opens at `now − 3h`, closes 6h later, both draggable).
   This is one interaction on a screen the host is already on.
2. **Inferred from existing uploads** — the span of what's already there,
   widened by an hour each side.
3. **A date picker**, if there's nothing to go on.

Inference is the fallback, not the primary path, specifically because of the
ordering problem: inferring from existing uploads works for contributor five and
not for contributor one — who is frequently the heavy shooter with 200 photos,
the single most valuable contributor at the event. Making the window a
creation-time field with a sensible default is what stops the best experience
from arriving last.

It does not fully solve it. A creator who skips the field, or sets it wrong,
leaves the first contributor on the manual path — which is precisely the
experience the app is selling against. Location clustering at least works from
the first contributor onward, since it is computed locally over their own
candidates and needs no server-side data from anyone else. **Known, narrowed,
not eliminated.** Watch it in the numbers (§18).

### 7.4 Permissions, staged like the account ask

iOS offers two paths with a real trade-off, so the app uses both:

- **`expo-image-picker`** wraps PHPicker: no permission prompt at all, but no
  library metadata, so no auto-selection. This is the default first-run path —
  someone can contribute without granting anything.
- **`expo-media-library`** with full library access enables §7.1, and requires
  a prompt.

The prompt is therefore an *upgrade*, offered after a manual contribution, with
the honest pitch: "next time we can find them for you." Same philosophy as the
account ask — the permission sits at the moment of demonstrated value, not in
front of the first upload.

iOS "limited library" selection must be handled as a first-class state, not an
error: auto-select over the subset the user granted, with a clear path to widen.
Android maps to `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` (API 33+) with the
older storage permission below that.

### 7.5 Upload engine

```
1. client   POST /api/events/:id/uploads   { files: [{name, size, type}, …] }
2. server   authorize(contribute) → presigned PUT per file (15 min)
            → `photo` rows at status='pending'
3. client   PUT each file directly to R2, concurrency 3
4. R2       event notification → Cloudflare Queue
5. deriver  sha256, EXIF strip, crc32, derivatives → R2
            → photo: status='ready', dimensions, captured_at, hash
6. clients  grid fills in as photos flip to 'ready'
```

Bytes go client → R2. Nothing else is on that path, on either client.

**Background behaviour is asymmetric across platforms and the UI must not
pretend otherwise:**

| Platform | Mechanism | Survives |
|---|---|---|
| iOS | `URLSession` background configuration, via Expo's upload task with a background session | app backgrounded, and app terminated |
| Android | foreground service with a persistent notification | app backgrounded; killed by aggressive OEM battery managers on some devices |
| Web | none | nothing — tab must stay open |

The Android foreground service is the piece most likely to need a config plugin
or a community module rather than stock Expo; budget for it, and see §16.

Other measures, each against a specific failure:

- **Never read a file into memory.** Stream from the asset URI. One
  `arrayBuffer()` over a 200-file selection is an out-of-memory crash on both
  clients.
- **Concurrency 3.** Higher hurts throughput on cellular and multiplies memory
  pressure. Tune by measurement.
- **Durable queue in SQLite on device** (`expo-sqlite`), holding asset ids and
  per-file state, so a cold start resumes rather than restarts.
- **Offline queueing.** Venues have bad signal. The queue accepts photos with no
  connectivity and drains when there is some — a native-only capability that
  matters more at a party than the background transfer does.
- **Idempotent retries** via content-addressed keys, so re-PUTting a file that
  actually completed is a no-op.

### 7.6 What we do to the bytes

"Originals, not compressed copies" and "strip precise location metadata by
default" are in tension. Resolution:

**Pixel data is never re-encoded.** Metadata is rewritten in place at ingest:
GPS blocks, device serial numbers, and owner-name fields removed; orientation,
capture timestamp, camera model, and exposure kept. The stored object is not
byte-identical to what left the phone; it is pixel-identical. That is the right
trade, and the UI should say "location removed" rather than bury it.

Stripping happens server-side in the deriver, not on the client — a client-side
guarantee is bypassable by anyone who wants to bypass it. Consequence: the
un-stripped original sits in R2 briefly. Acceptable; it is never served in that
state, since photos are only readable at `status='ready'`.

**HEIC is uploaded as-is and never converted on-device.** Decoding 200 files on
a phone is minutes of blocked CPU and a dead battery, and the original is what
we promised. Derivatives are made server-side.

### 7.7 Deriving

libheif/libvips will not run in a Workers isolate, so the deriver is a container
(Fly.io or Railway) consuming a Cloudflare Queue, with R2 over the S3 API.

| Kind | Longest edge | Format | Use |
|---|---|---|---|
| `thumb` | 320px | AVIF **and** JPEG | grid |
| `grid` | 1280px | AVIF **and** JPEG | retina grid, quick look |
| `full` | 2560px | JPEG only | lightbox, and the "give me something I can open" download |

Both encodings are stored, not one with the other generated on demand. Which
one a viewer gets is decided by the browser, not the edge — see §11. `full`
stays JPEG-only because it is the member of the download-as-JPEG archive, so
its format is load-bearing elsewhere.

**AVIF encoding is slow enough to need a setting.** At libvips' default effort
of 4, a 1280px AVIF encode measured ~5.6s against ~185ms for the JPEG of the
same image; at effort 2 it was ~0.7s. The deriver is one machine that cannot
yet be scaled out (two would race on the same pending rows), so a 250-photo
event at the default would add twenty-odd minutes to ingest — time during
which nothing is visible, because `ready` is the gate. Effort 2 is the
setting; raising it is the first thing worth revisiting if the deriver ever
scales out.

**The size win is unmeasured.** AVIF is smaller than JPEG on typical
photographic content, but "typical" is doing work in that sentence and this
codebase has no real photo set to measure against — synthetic test images
compress nothing like a camera's output. The encode cost above is measured;
the saving is not. Worth checking against a real event before treating the
bandwidth argument as settled.

That last row matters more than it looks: an Android recipient downloading HEIC
originals gets files their gallery may not open. Both clients offer **download
originals** and **download as JPEG** side by side, which is the honest framing
of the format problem rather than a hidden downgrade.

Two consequences of building it that way, both non-obvious:

- **The `full` derivative needs its own size and CRC-32**, recorded at ingest
  alongside the original's, or the JPEG archive cannot carry an exact
  `Content-Length` (§10). Both columns are nullable, because a derivative
  written before they existed has neither and backfilling means re-deriving
  every photo. The download path refuses the whole archive rather than guessing
  or silently dropping the photo.
- **An original that is already JPEG is not converted.** It goes into the JPEG
  archive as-is, at full resolution. The ask is "files that open", which it
  already satisfies; substituting a 2560px re-encode would be quality lost for
  nothing. The response reports how many were actually converted, so a client
  can say whether the two downloads differ at all.

Alternative: Cloudflare Images handles HEIC and removes the container, at a
per-image cost on exactly the axis that grows. Container first; switch if
operating it becomes the tax rather than the saving.

### 7.8 Rate limits

Anyone with a link can upload anything. These are anti-catastrophe bounds, not
product limits — every one of them logs when it bites, because they are set far
above real use and one firing means either abuse or a wrong assumption about
real use.

| Bound | Value | What it stops |
|---|---|---|
| Files per presign request | 50 | one absurd request |
| Bytes per file | 200MB | one absurd file |
| Per actor, per event | 500 photos / 5GB | an honest heavy shooter running away with it |
| **Per event, total** | **20,000 photos / 100GB** | **one leaked link, whoever presents it** |
| Presign requests per source | 300/hour | an unattended script |
| Events created per source | 20/hour | minting events to escape every per-event bound |

**The per-actor cap does not bound anyone hostile, and it never did.** An actor
is minted on demand and costs nothing, so clearing a cookie buys a fresh 500
photos. Anything that survives that has to be counted somewhere the client does
not control, which is why the event total is the important row in that table:
a link grants access to exactly one event, so the event is the unit whose blast
radius can actually be capped, and an aggregate over rows is not something a
client can reset.

The two rate limits are *rates*, not volumes, and that is deliberate. A
per-source volume cap would fire on the exact case the product exists for —
twenty people at a wedding behind one NAT address, uploading at once. A rate
limit does not care how much they upload, only how fast the requests arrive,
and twenty humans tapping a file picker never approach what one loop does in a
second.

Rate-limit buckets are keyed by an HMAC of the address, not the address, so the
table is opaque to anyone who reads it and holds no personal data to retain or
delete. Closed windows are dropped by a scheduled job.

Worth being honest about the limit of this: `x-forwarded-for` is only as
truthful as the proxy in front of it. Vercel overwrites it and does not pass a
client-supplied one through, so on the intended deployment it is the connecting
address; behind a proxy that appends, or none, a caller can claim any source
and the two rate limits bound nothing. That is why they are the second line.
The per-event cap depends on none of it.

## 8. Contribution — the web path

Same API, same presigned PUTs, no auto-selection. A single-screen flow:
`<input type="file" multiple accept="image/*">`, files streamed straight to
`fetch` bodies, concurrency 3, queue persisted in IndexedDB **including the
`File` handles**, so a reloaded tab resumes instead of restarting.

The queue's state machine is shared with the native client (`@parea/upload`)
rather than written twice. The failure modes are identical and subtle enough
that two copies would drift; a queue item names its source with an opaque
string, and only the platform layer knows whether that is an asset URI or a key
into IndexedDB.

### A stored `File` handle can outlive its bytes

This subsection replaces an earlier claim that structured-cloning the handles
was sufficient. The clone is the easy half.

A `Blob` carries a **snapshot** of its underlying storage, and the File API
requires a read to fail once the real thing no longer matches that snapshot.
A `File` from `<input type=file>` is a reference to something on disk, so the
handle can survive a reload perfectly while the bytes behind it do not — and on
iOS this is ordinary rather than exotic, because photos chosen from the library
are temp copies the OS later reclaims. The reload we are trying to survive can
be the very thing that outlives them.

Three consequences:

- **Probe before trusting.** On resume every handle gets a one-byte read.
  `file.size` and `file.name` answer from the snapshot and keep answering
  happily after the bytes are gone, so checking those is worse than not
  checking. The probe also has to happen before the PUT, because a `fetch`
  whose body cannot be read rejects with the same opaque network error as a
  dropped connection, and those two want opposite responses.
- **A dead handle is a fifth queue state, not a failure.** `stale` skips the
  retry budget — no attempt will find the bytes — and the UI asks for those
  files to be picked again rather than offering a retry that cannot work. The
  native client can reach the same state when an asset is deleted from the
  camera roll mid-batch, which is why it lives in the shared package.
- **Do not copy the bytes as insurance.** The tempting fix is to read each file
  and store its contents. That puts 200 photos — most of a gigabyte — into
  origin storage to protect against a reload, and Safari evicts an origin's
  storage all at once. It buys resilience against the cheap failure by risking
  the expensive one: losing the queue *and* the copies together.

Item ids are derived from name, size and mtime rather than generated, so the
same file re-picked after going stale lands on the same record and the live
handle replaces the dead one. A persisted queue is not resumed after 24 hours;
resume is for the tab that just reloaded, not for someone returning next week
to a page that silently starts uploading.

**Unverified on a real device.** That a browser preserves a `File` across a
reload at all is asserted from the spec, not measured — no in-process
IndexedDB fake carries a real `File`, so the tests supply handles directly and
check the logic around them. How often the handles are actually alive after a
reload on iOS Safari belongs on the launch checklist next to the geotag
measurement; if the answer is "rarely", the resume path degrades to the
re-pick prompt, which is why that prompt is built rather than bolted on later.

### iOS Safari strips EXIF on upload, and it costs us the timeline

Safari on iOS removes EXIF from files handed over by `<input type="file">`. This
is deliberate Apple privacy behaviour rather than a bug
([WebKit #207088](https://bugs.webkit.org/show_bug.cgi?id=207088)), and Android
and desktop browsers do not do it.

One consequence is free: for iPhone web contributors our own GPS stripping
(§7.6) is redundant, though it still has to run for native and Android uploads.

The other consequence is real. If `DateTimeOriginal` goes with the rest, those
photos arrive with **no capture time**, and `coalesce(captured_at, uploaded_at)`
puts them at the moment of upload rather than the moment they were taken. In a
mixed event — native contributors carrying accurate timestamps, iPhone web
contributors carrying none — the chronological grid does not interleave slightly
wrongly, it interleaves *categorically* wrongly: a whole contributor's evening
lands in a block wherever they happened to upload.

There is no client-side fix. The `File` object the page receives has already
been stripped; the metadata is gone before any of our code runs.

Three options, none free:

1. **Accept it**, and sort web-contributed photos by upload time. Simplest, and
   the damage is proportional to how many contributors use the web path on iOS.
2. **Group by contributor** in the grid when a batch has no timestamps, rather
   than interleaving on a time we know is wrong. Honest, and arguably a better
   grid anyway.
3. **Sort within-batch by file order** and anchor the batch to the event's
   window rather than to upload time. A guess, but a better-shaped one.

Ship (1), measure how often it bites, and treat (2) as the likely fix. Verify
the exact tag set Safari removes on the target iOS version before committing —
if `DateTimeOriginal` survives and only GPS goes, this whole subsection collapses
to a footnote.

Worth noting where this lands: the timeline — a core feature, not a nicety —
degrades on the web in a way it cannot on native. That is a second argument for
the app that emerged from testing rather than from design, and it is more
concrete than the upload-plumbing one.

### Two things the web client must do that the app doesn't

- **Tell the truth about the tab.** iOS web has no background completion. The UI
  states how many remain and that the tab must stay open, and a `beforeunload`
  handler makes closing it mid-batch deliberate — a statement is not a guard.
  Progress is per-file, so a partial upload is partial photos rather than zero.
  The concept's "close the tab" affordance is honest for four photos and a lie
  for two hundred.
- **Offer the app at the right moment** — after a successful contribution, or
  when a selection is large enough that the tab-open constraint will hurt. Not
  an interstitial on arrival. A contributor who bounces off an install prompt is
  the exact failure the web path exists to prevent.

## 9. Links, codes, and getting into the app

The link has to work identically for someone with the app, someone without it,
and someone who has never heard of the product.

- **Universal Links (iOS) / App Links (Android)** on the event URL: opens the app
  when installed, the web page when not. Requires `apple-app-site-association`
  and `assetlinks.json` served from the app domain, plus `associatedDomains` in
  the Expo config. Get this right early — it is fiddly, it is cached by the OS,
  and everything about distribution routes through it.
- **The web page is the fallback and the preview surface.** Open Graph tags
  carry event name, contribution count, and the action — *"Sarah's birthday · 88
  photos from 6 people · add yours"* — generated dynamically and cached briefly.
  **No photo appears in the preview image.** Unfurlers fetch without credentials
  and previews get rendered in places the photos should never reach; the card is
  a generated graphic, not a thumbnail.
- **QR and code entry in-app** via `expo-camera` barcode scanning, and a plain
  text field for `amber-fox`. This is the at-the-party path.
- **Deferred: iOS App Clips.** A QR scan that runs a lightweight contribution
  flow with no install is almost exactly this product's join moment, and it
  would partially collapse the two-client problem on iOS. It needs a separate
  native target outside the Expo managed flow and a hard size budget, so it is
  not v1 — but it is the highest-value thing on the other side of v1.
- **There is no Android equivalent, and there won't be.** Google Play Instant
  was removed from Play in December 2025: publishing disabled, APIs dead,
  tooling pulled from Android Studio, and Google's own migration guidance is to
  deeplink into the installed app. So the instant-contribution path on Android
  is the web client, permanently. That is not a stopgap — it upgrades the web
  path from "concession to non-installers" to "the only zero-install
  contribution route on half the phones at the party," and it should be resourced
  accordingly.


### The server half of a deep link

An app that declares `applinks:` is making a claim the platform verifies before
it honours: iOS fetches `/.well-known/apple-app-site-association` and looks for
`<TeamID>.<bundle id>`, Android fetches `/.well-known/assetlinks.json` and
matches the *signing certificate* of the installed app. Both are served by the
web app, from route handlers rather than static files, because the Team ID and
the fingerprints are deployment configuration and the identifiers are not.

Both **404 when unconfigured rather than serving a file with a placeholder in
it.** Apple caches the AASA aggressively, so a file naming the wrong team is a
link that stays broken long after the variable is fixed; Android verifies only
at install time, so a fingerprint corrected after release does not repair
already-installed apps at all. Absent is recoverable. Wrong is not.

Only `/e/*` is claimed. `/event/<id>` works in a browser because the token has
already been exchanged for a capability cookie, and carries nothing a native
client could use.

The failure mode when any of this is wrong is the quietest in the product: the
link opens a browser, which is exactly what it does for someone who has not
installed the app. Nothing errors, and nobody reports it.

## 10. Download

Bulk download of originals is the product's terminal action and its main cost
centre.

**A Worker streams the zip**, reading objects from R2 (free) and writing a
`STORE`-method Zip64 archive to the response as it goes. No compression — JPEG
and HEIC are already compressed, so deflate burns CPU for ~0%. Nothing is
staged: no temporary archive object, no job queue.

The refinement that matters: **crc32 and byte size are precomputed at ingest**
— for the `full` derivative as well as the original, so both formats in §7.7
get this — and file ordering is deterministic, so the exact archive length is
computable up front and the response carries a real `Content-Length`. That means a real
progress bar and time estimate on a 1GB download instead of an indeterminate
spinner — and deterministic layout makes `Range` resume implementable later
without a format change.

Zip64 unconditionally from day one. Events crossing 4GB are ordinary once video
exists, and a format switch under load is a bug waiting to happen.

Selection downloads use the same endpoint: POST an id list to mint a short-lived
manifest token, then GET the zip with it, so the download is a plain navigation
the browser or OS can own.

On native, "save all to camera roll" is the more natural terminal action than a
zip, and it is a per-file loop with `expo-media-library` rather than an archive.
Both exist; the app defaults to camera roll, the web to zip.

### Nothing behind a link is indexable

Possession of the link is the whole access model, so a link that reaches a
crawler is a set of someone's photos in a search index — served back to
strangers, at scale, for as long as the cache lives.

`X-Robots-Tag: noindex, nofollow, noarchive, noimageindex` on `/e/*`,
`/event/*`, `/group/*` and `/api/*`, plus `robots.txt` and a page-level
directive. Three layers because they fail differently: `robots.txt` asks a
crawler not to *fetch*, which does not stop a URL found elsewhere from being
indexed anyway and covers no non-HTML response; the header travels with the
response but is applied by the server, which is a deployment property; the page
directive survives the header not being applied. `noimageindex` is not
decoration — the photos come from the image Worker on another origin, so the
page's directive is what speaks for them.

`Referrer-Policy: no-referrer` is the same threat through the other channel:
without it the event link rides along to every outbound click.

The landing page stays indexable. It is the only page with nothing private on
it.

## 11. Serving images

A grid requests 200 thumbnails. Two bad options and one good one:

- Presigned R2 URLs per image — cheap to generate, but every URL is unique per
  request, so CDN hit rate is zero and every thumbnail is an origin read forever.
- Worker checks the credential — correct, but credential-varying responses are
  effectively uncacheable at the edge.
- **Signed path with a coarse expiry.**
  `/img/<eventId>/<hash>/<kind>.<ext>?v=<epoch>&e=<hourBucket>&s=<hmac>`, where
  the signature covers event, photo, kind, format, the event's `cap_epoch`, and
  an expiry rounded up to the next hour. Every viewer of the same event within
  the same hour generates *identical* URLs, so the edge cache actually works,
  and the URL dies within the hour. `Cache-Control: private, max-age=3600` at
  the client.

### The encoding is in the URL, not in `Accept`

Content negotiation is the textbook answer for AVIF-with-a-JPEG-fallback and it
is the wrong one here.

A response that varies by `Accept` is only correct if the cache in front of it
keys on that header. Cloudflare's Workers Cache grew `Vary` support in mid-2026
— weeks before this was written — and the grid's entire cache-hit rate is the
thing §11 exists to protect. More to the point, the failure mode is silent and
severe: one viewer's AVIF served to the next viewer whose browser cannot decode
it is not a slow grid, it is an empty one.

AVIF is around 94% globally, and the missing few percent are iOS 15 and older
plus a tail of in-app webviews. This product's links live in group chats, so
in-app webviews are its traffic, not a rounding error.

So `thumb.avif` and `thumb.jpg` are two URLs, two signatures and two cache
entries, and the client renders `<picture>` with the AVIF as a `<source>` and
the JPEG as the `<img>`. The browser picks, because it is the only party that
knows what its decoder can do. The `<img>` is not optional — a `<picture>`
whose sources are all rejected renders nothing.

The format is inside the signature like everything else in the path, so a valid
JPEG URL cannot be edited into an AVIF one, and `full.avif` — an object nobody
writes — is rejected as malformed rather than 404ing.

Native clients ask for a URL and cannot negotiate, so they take the JPEG. If
`expo-image` turns out to decode AVIF on both platforms, switching is a
one-line change to which format the app requests.

Because the signature includes `cap_epoch`, rotating the link invalidates
outstanding image URLs too.

## 12. Notifications

Native unlocks the concept's "one well-timed reminder," and the concept is
emphatic that it is *one*. The cap lives in the schema (`event.nudged_at`), not
in config, so it cannot be lost to a deploy.

Three notification types, total:

1. **The nudge** — once per event, to attendees who joined but haven't uploaded.
2. **New event in a group you're in** — the thing that makes groups worth
   joining, and the answer to the distribution problem.
3. **Your removal request was answered** — transactional.

Nothing else. No "someone added 3 photos," no re-engagement, no digests. The
feature test from the concept applies: *does this help people contribute, find,
or retrieve shared photos?*

## 13. Safety, moderation, and the App Store gate

Day-one needs from the concept, concretely:

- **Remove your own upload** — actor-scoped, immediate soft delete, no review.
- **Request removal of a photo of you** — available to anyone with view access,
  no account. Routes to the creator with a 48h auto-hide if unanswered.
  Auto-*hide* rather than auto-delete: wrong in either direction is bad, but
  invisible is recoverable and gone isn't.
- **Report** — to us, not the host.
- **Delete event** — creator or group admin, soft delete then purge.
- **Block a contributor** — hides their uploads from you and prevents them
  rejoining events you administer.
- **Location metadata stripped** by default (§7.6).

Going native makes two of these non-negotiable on a schedule:

- **App Store Guideline 1.2 (user-generated content)** requires a content
  filtering method, a reporting mechanism, the ability to block abusive users,
  and published developer contact info. An app that accepts anonymous photo
  uploads without all four does not get approved. These are launch gates now,
  not backlog. Expect an age rating conversation as well.
- **CSAM detection.** Anonymous image upload from unverified contributors is
  precisely the risk surface. Cloudflare's CSAM Scanning Tool works against R2
  and is free; wire it at ingest. A detection carries a legal reporting duty to
  NCMEC (18 U.S.C. §2258A) and a preservation duty — which means a runbook and a
  named human before launch. Get counsel on the reporting workflow; this design
  only guarantees the hooks and a preservation-safe soft delete exist.

On **minors**, the concept's position is "avoid as a target market; private-only
and no matching if it happens organically." Nothing in the schema encourages it,
and there is no face matching to disable, which is most of the protection.

### Schedule this, do not checklist it

Everything above reads like six small features and is not. Blocking touches the
query layer everywhere photos are listed. Auto-hide needs a timer, a state, and
a notification. The report queue needs somewhere for reports to *go* and a human
who looks. CSAM wiring needs a runbook, a named responder, and legal review of
the reporting workflow before a single detection can be handled correctly. Then
the whole thing gets judged by a reviewer who can reject on any one of them, and
a rejection costs a review cycle, not an afternoon.

**This is the most likely two weeks nobody put in the plan.** Treat it as a
workstream with its own slice of the schedule, starting before the app is
feature-complete — not as the checklist you run the week you intend to submit.

## 14. Consequence for monetization

Worth stating because it changes the numbers in `concept.md` §5 — but the
correct conclusion is *"do not assume a fixed cut,"* not *"subtract 30%."*

**Status as of August 2026, and it is genuinely unsettled.** In the US
storefront, Apple currently takes **no commission on purchases made through an
external link** out of the app, and cannot impose the anti-steering restrictions
that used to make link-outs pointless. That is a consequence of the Epic
contempt ruling, not a policy Apple chose, and it is under active challenge: on
11 December 2025 the Ninth Circuit upheld the contempt finding but held that a
*total* ban on link-out commissions was overbroad and remanded for the district
court to set what Apple may charge. Apple has since sought Supreme Court review.
So the live number is zero, the eventual number is being litigated, and it will
land somewhere between zero and prohibitive.

Meanwhile the ordinary in-app purchase path is unchanged: StoreKit or Google
Play Billing at 15% (Small Business Program / after year one on subscriptions)
to 30%. Outside the US, separate regimes apply — the EU's DMA terms and other
storefronts' external-purchase entitlements each carry their own fees.

What follows for a $4–8/mo group subscription:

1. **Do not price as if the cut is fixed.** Model the margin across a range from
   0% to 30% and make sure the price works at the bad end. A plan that only
   works at 0% is a plan that depends on an appeal.
2. **The link-out path is now economically real in the US, and it is worse in
   every other way** — the user leaves the app to pay, conversion drops, and you
   own the Stripe integration, tax handling, and dunning that StoreKit would
   have done. "Zero commission" is not free. Offer both if it comes to that, and
   let the numbers decide.
3. **Entitlements become server-side regardless.** A subscription record on our
   side, reconciled against whichever receipt source paid for it. Building it
   platform-agnostic from the start is what keeps the choice open, and costs
   nothing while there is no revenue.
4. **Physical artifacts (concept §5.4) are exempt** — physical goods go through
   normal payments with no platform cut in any storefront. That quietly improves
   their standing relative to the concept's ranking, and it is the one direction
   whose economics no court can move.

Nothing here needs building now. Two things need *not* to be assumed: that
payments go through Stripe, and that they don't.

> Re-check before setting a price. This paragraph has a shelf life measured in
> months, and the whole point of the note is that the number moves.

Sources: [Ninth Circuit opinion, 11 Dec 2025](https://cdn.ca9.uscourts.gov/datastore/opinions/2025/12/11/25-2935.pdf) ·
[Fenwick analysis](https://www.fenwick.com/insights/publications/ninth-circuit-largely-upholds-ruling-in-epic-v-apple) ·
[Shinder Cantor Lerner, on the narrowed remedy](https://scl-llp.com/ninth-circuit-upholds-apple-contempt-finding-but-narrows-scope-of-remedial-relief/) ·
[Apple's Supreme Court stay application, May 2026](https://www.supremecourt.gov/DocketPDF/25/25A1213/407958/20260504154515930_2026-05-04%20Apple-Epic%20SCT%20Application%20to%20Stay%20Mandate.pdf) ·
[TechCrunch, 22 May 2026](https://techcrunch.com/2026/05/22/apple-says-epic-lawsuit-shouldnt-reshape-app-store-rules-for-all-developers/)

## 15. Jobs

| Job | Cadence | Does |
|---|---|---|
| `purge-deleted` | hourly | hard-deletes R2 objects soft-deleted > 30d |
| `expire-events` | daily | ungrouped events past `expires_at` → soft delete |
| `recycle-codes` | daily | releases codes for events dormant 90d |
| `nudge` | event-scoped | one reminder, once, capped in schema (§12) |

Retention default: ungrouped events get `expires_at = created_at + 60 days`,
grouped events null. **Not enforced in v1** — the column is populated and the
job is written, but the switch stays off until there's a reason. Backfilling an
expiry policy onto events created without one is a support nightmare; carrying
the column from day one costs nothing.

## 16. Testing the things that actually break

1. **Egress invariant.** Build fails if any Next.js route handler returns a body
   sourced from R2. The cost failure is silent, gradual, and unrecoverable after
   the fact.
2. **Authorization matrix.** Table-driven over (actor kind × capability × policy
   × switch state × client type). This is the file that will be wrong in a year.
3. **Upload resume, per platform.** Kill the app mid-queue on iOS, on Android,
   and mid-queue in a reloaded Safari tab; assert no duplicates and no missing
   files. Content-addressing makes this assertable.
4. **Zip correctness.** A >4GB archive with unicode filenames, verified by a real
   unzip. Zip64 and filename encoding are where homegrown zip writers fail, and
   they fail on the user's machine after a twenty-minute download.
5. **Universal Link routing.** Installed / not installed / different platform,
   on real devices. It is cached by the OS and cannot be debugged from a
   simulator alone.

## 17. Open decisions

- **Android background upload.** Stock Expo may not cover a long-running
  foreground-service upload; likely a config plugin or community module, and
  OEM battery managers will kill it on some devices anyway. Prototype this
  before committing to the schedule — it is the highest-variance unknown in the
  build.
- **Expo background upload API surface.** `expo-file-system`'s upload task and
  background session support has moved across recent SDKs. Verify against the
  target SDK on a device before designing UI around it; fall back to a thin
  native module over `URLSession` if needed.
- **Deriver: container vs. Cloudflare Images.** Cost crossover needs real
  numbers on stored-vs-delivered. Container first.
- **Clock skew in the timeline.** Ignored in v1. May look obviously broken the
  first time six phones contribute to one grid. Fix is per-uploader offset
  estimation, not a schema change.
- **Geotagging coverage — the biggest unknown in the native bet.** Location
  clustering is the filter that buys precision (§7.2), and it only works for
  people whose camera writes GPS. If that's a large majority, auto-select feels
  like magic; if it's half, most contributors fall to the time-only path with
  nothing pre-selected, and the app's central justification is a nicer grid.
  **Instrumented, two ways — see [`tools/geotag-probe`](../tools/geotag-probe/).**
  `analyze.py` measures a folder of exported originals; [`app/`](../tools/geotag-probe/app/)
  is an Expo build that reads the photo library directly through the same
  `expo-media-library` calls this design specifies, and runs in Expo Go so
  testers scan a QR instead of installing anything. Use the app for coverage
  across several phones — one camera roll is n=1 for that question — and the
  script for clustering quality on your own. Read the README on collection paths
  before trusting any number from the script: several obvious ways of getting
  photos off a phone strip the exact metadata being measured.
- **Exactly what iOS Safari strips.** If GPS goes but `DateTimeOriginal`
  survives, §8's timeline problem is a footnote. If both go, web-contributed
  photos can't be placed on the timeline at all and the grid needs a
  contributor-grouped fallback. One device, ten minutes, and it decides a
  feature — check it against the target iOS version.
- **Auto-select window quality.** Whether creators reliably set a window at
  creation, and whether "existing uploads widened by an hour" is good enough
  when they don't (§7.3). The failure is asymmetric — a wrong window is worse
  than no window. **Now askable:** the native create screen offers four phrases
  and "not sure", nothing pre-selected, and the server refuses a window that
  does not run forwards. Until that screen existed no client sent `starts_at`
  at all, so every event in the product had been falling back to inference.
  Both clients ask, from the same list in `@parea/autoselect`, beside the
  `resolveWindow` that consumes it. The open part is now only the measurement
  — §18's "what fraction of events have a creator-set window", and whether the
  phrases match how people actually describe when a thing happened.
- **App Clips.** Deferred, but the strongest candidate for the next thing built,
  and now iOS-only for good: Play Instant is gone (§9), so Android's
  zero-install path is the web client permanently.
- **Nudge timing.** Next morning? 48h? A product question the first real events
  should answer.
- **Video.** Named as a candidate paywall. Nothing here forbids it — keys, zip
  streaming, derivatives all generalize — but transcoding is a second pipeline
  and should stay out until photos work.
- **Group-search abuse.** Findable groups are a namespace, and namespaces get
  squatted and impersonated. Low urgency while groups are rare; revisit before
  promoting group search.
- **Whether the web should list your groups too.** `GET /api/groups` was added
  for the native client and is part of the shared protocol, so the web can use
  it — but the web has no persistent place to put it, and a group list on a
  page reached from a link is a strange thing. Deliberately unbuilt rather than
  overlooked.

## 18. Instrumentation

The concept's §6 test — *does anyone other than the creator upload?* — is also
the primary product metric once code exists. Wire these in the first release:

- contributors per event (1 is the failure case)
- time from event creation to first upload by a non-creator
- photos per contributor (one heavy shooter vs. several light)
- download rate — did anyone actually leave with the photos
- return rate — a second event with an overlapping set of people
- group formation rate — decides whether the monetization model exists at all

Two more that exist only because of the native decision, and that judge it:

- **Install conversion at the join moment**, and contribution rate for people
  who *didn't* install. This is the number that says whether the app was worth
  it. If web contributors are a large and healthy share, the install wall is
  cheaper than feared; if they're a small and failing share, the wall is doing
  the damage the concept predicted.
- **Auto-select precision** — what fraction of the pre-selected set survives to
  upload, and how many taps a contribution took. If people are deselecting most
  of the suggestion or falling back to manual picking, the central justification
  for native is not holding and should be re-argued.
- **Return rate among heavy deselectors**, split against everyone else. This is
  the companion that makes the metric above mean something. A suggestion someone
  had to untick thirty times is *worse than no suggestion*: it cost them thirty
  seconds, and it spent the photo-library permission and their trust in the
  feature at the same moment — neither of which is recoverable. If heavy
  deselectors don't come back for a second event, the precision problem is not a
  tuning issue, it's the product failing at its one differentiated moment.
- **First-contributor experience**, specifically: what fraction of events have a
  creator-set time window, and whether contributor #1 got a suggestion or fell
  through to manual picking (§7.3). The bootstrap gap is known and narrowed but
  not closed, and this is the number that says whether it matters.

### How it is actually wired

**Most of this is a query, not tracking.** Contributors per event, photos per
contributor, time to the first non-creator upload, group formation, and the
fraction of events carrying a creator-set window are all facts the schema
already holds. Collecting them a second time through a pipeline would move
user data somewhere new and answer nothing extra.

Five things are not derivable, and they are a closed list in one first-party
table — `observation`, in the same spirit as the three notifications. Nothing
is sent anywhere and there is no third-party SDK, which is also what keeps the
app's privacy manifest honest: it declares no tracking and no tracking
domains, and that has to stay true.

| Observation | Recorded by | Because |
|---|---|---|
| `joined` | the join route | nothing else knows which client someone arrived on |
| `download` | the download route | the zip Worker has no database; minting the URL is the only trace |
| `autoselect_shown` | the app | a suggestion happens on a device |
| `autoselect_confirmed` | the app | precision is the gap between offered and kept |
| `picker_used` | the app | without it, "precision is fine" and "almost nobody saw a suggestion" read alike |

Only the three the device is the sole witness to are accepted from a client.
An endpoint that let a client assert *someone downloaded this* would make the
one metric about delivery unfalsifiable.

Read out with `deriver metrics`, which prints each number alongside what a bad
one would mean — a number without a reading is not a signal. It is a CLI
command rather than a page because there is no admin authentication in this
product, and inventing one so a dashboard can exist is a larger security
surface than these numbers are worth.

Rows expire after a year. Return rate is the slowest metric and needs enough
history to see a second event; beyond that this is the only table in the
product holding anything purely because it was interesting, and it should not
grow forever.
