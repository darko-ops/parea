# Parea

**Every photo from everyone who was there.**

A place to put everyone's photos from one thing that happened. Someone creates
an event and drops the link in the group chat; anyone with the link adds their
photos — no account, no app, no setup — and everyone gets the full collection
at full quality.

The problem is social rather than technical. The photos exist and someone has
them; asking is a favour, and nobody wants to ask.
[`docs/charter.md`](docs/charter.md) is what the product is and what decides
whether a proposal belongs in it; [`docs/concept.md`](docs/concept.md) is the
founding argument it grew out of, and [`docs/design.md`](docs/design.md) is how
it is built.

## Status

Every feature in the v1 design exists and is tested. **Nothing has been
deployed, and nothing has met a real device, a real R2 bucket or a real user.**
Two things gate launch and neither is code:

- the geotag coverage measurement (`tools/geotag-probe`), which decides how well
  auto-selection actually works;
- the child-safety launch checklist in [`docs/csam-runbook.md`](docs/csam-runbook.md)
  — a scanning provider onboarded, credentials in place *before* the first
  detection, counsel briefed, and a named human who receives alerts.

[`docs/launch.md`](docs/launch.md) is the ordered checklist — what is blocked
on what, and which items are not code at all. [`docs/deploy.md`](docs/deploy.md)
is the reference for each piece, including the three secrets that are shared
between services and fail silently when they disagree.

## Running it

```
npm install
cp apps/web/.env.example apps/web/.env.local   # set SESSION_SECRET, DATABASE_URL
npm run dev --workspace @parea/web
```

Without R2 credentials, photos go to `./.storage` through a development-only
endpoint that cannot exist in a production build. Without mail credentials,
sign-in codes are printed to the console — a real deployment sets
`MAIL_PROVIDER`, `MAIL_API_KEY` and `MAIL_FROM`, and checks them with
`npm run mail:test -- you@example.com`, because the sign-in endpoint answers
the same however it went and will not tell you the mailer is broken.

Ingest is a separate process:

```
CSAM_SCANNER=disabled npm run watch --workspace @parea/deriver
```

`npm test` and `npm run typecheck` cover the workspace. The suite shells out to
real tools rather than mocking them — `exiftool`, `unzip`, libheif — so those
need to be installed; see `.github/workflows/ci.yml` for the exact list.

## Shape

```
packages/core        schema, access policy, credentials, visibility,
                     session retention, naming a client from its user agent
packages/zip         streaming Zip64 writer, download manifests
packages/urls        signed, cacheable image URLs
packages/autoselect  find the event on the phone, decide which of its photos
                     to offer, and know when not to guess
packages/push        the three notifications this product is allowed to send
packages/upload      the upload queue, shared by both clients
packages/cards       what an event card says about itself, shared likewise
apps/web             Next.js — the app, the API, and the browser client
                     (three surfaces behind a left rail: events, find, you)
apps/mobile          Expo — the native client
services/deriver     ingest: strip, scan, derive, dedup; plus scheduled jobs
services/image-worker  Cloudflare Worker serving images from R2
services/zip-worker    Cloudflare Worker streaming archives from R2
tests/e2e            one photo, all the way through
tools/geotag-probe   measures whether auto-selection will work
```

The control plane and the data plane are deliberately separate. Next.js serves
HTML and JSON and issues signed URLs; **photo bytes never pass through it**.
Bulk download is the product's core action, so the difference between free
R2 egress and metered origin bandwidth is the difference between a cheap
product and an expensive one. A test fails the build if anything reaches around
that.

## A few decisions worth knowing before reading the code

**`ready` is the gate.** Nothing is listed, served or downloaded before ingest
completes, which is what stops an un-stripped original — or an unscanned one —
reaching a viewer. Ingest fails closed in both directions.

**Pixel data is never re-encoded**, and it is verified rather than assumed:
metadata is rewritten in place and the compressed image data is hashed before
and after.

**Access is one function.** `authorize()` in `@parea/core` is pure and total;
the data layer resolves relationship facts and asks it. It fails closed on an
unrecognised policy, and denials that would confirm an event exists answer 404
rather than 403.

**A photo can be invisible for four different reasons** — deleted, removed,
hidden, blocked — and they undo differently, so they are four states behind one
shared predicate.

**The image encoding is in the URL, not the `Accept` header.** `thumb.avif` and
`thumb.jpg` are two signed URLs and two cache entries, and `<picture>` lets the
browser choose — the only party that knows what its decoder can do. Negotiating
at the edge would let one cached AVIF answer for a viewer who cannot decode it,
which is an empty grid rather than a slow one.

**The credential names a row now, and that reverses a decision.** It used to be
a signed actor id and nothing else, which was cheaper and could not answer
"where am I signed in?" — or end a sign-in from anywhere but the device holding
it, for the four hundred days the cookie lasts. So there is a `session` row per
credential, it is the authority on who a credential means, and revoking it is
what a remote sign-out is. It costs no extra query: resolving a merge pointer
was already a read per request, and a live session names the current actor.

**The bounds that matter are the ones a client cannot reset.** An actor is
minted on demand, so a per-actor upload cap is a cap on honesty — clearing a
cookie buys a fresh allowance. The cap that actually bounds a leaked link is
per *event*, because a link grants access to exactly one, and rate limits per
source close the "just make more events" door behind it.

**Instrumentation is mostly SQL.** Design §18 names the numbers the first
release needs, and the database already holds most of them. Only five facts
are not derivable, and those are a closed list in one first-party table — no
SDK, nothing leaves the deployment, and the app's privacy manifest declaring
no tracking stays true. `deriver metrics` prints them with what a bad number
would mean.

**An account is an email address and nothing else.** It grants nothing an
actor does not already have; its one job is that a new phone is still you.
A passkey is a second way of proving one — Face ID instead of a trip to an
inbox — offered once, on the sign-in that creates the account, and never the
only way in: the case an account exists for is a new phone, where the device
holding the passkey is by definition absent.
Signing in on a second device merges two actors, and the rows *move* rather
than reads following a pointer — resolving an alias per call site is how one
gets missed, and a missed one is "you cannot delete your own photo". Both
clients sign in the same way against the same endpoints; only the carrier
differs, and a browser is never handed the bearer form of its own cookie.

**The app finds the event rather than asking for it.** A night out is a run of
photos with hours of nothing either side, so the create screen reads the last
few days and offers the runs it finds — the window comes from the real first
and last shutter press instead of from someone picking "Last night" off a list.
The question survives only where there is no library to read.

**Confidence decides how much auto-selection pre-selects**, never whether the
screen appears. A suggestion containing one private photo costs more than
twenty missing ones, and finding the run more accurately is not a reason to
start guessing harder about what is in it.

**A stored `File` handle can outlive its bytes.** The web upload queue survives
a reload by persisting the handles rather than the contents — copying a
gigabyte of photos into origin storage to insure against a refresh trades a
cheap failure for an expensive one. The cost is that a handle can come back
dead, so every one is read before it is trusted, and a photo whose bytes are
gone asks to be picked again instead of pretending a retry would help.
