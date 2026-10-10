# Child-safety scanning: what is built, and what a person has to do

Not legal advice. **Get counsel before launch.** This document describes the
system's behaviour and the decisions it deliberately leaves to a human; it does
not tell you what the law requires of you.

## Why this exists

The product accepts photo uploads from unverified contributors with no account.
That is the risk surface, and it exists whether or not anyone plans for it.
`docs/design.md` §13 calls scanning a launch gate rather than a backlog item.

## What the code does

**Scans at ingest, before publication.** The deriver scans every photo after
metadata stripping and before derivatives, key assignment or anything that
makes it addressable. `services/deriver/src/safety.ts`.

**Fails closed on an outage, not on an absence.** A scanner that is configured
and unreachable stalls the photo at `pending` — `ready` is the gate every
listing, download and image URL keys off, so unscanned content is never
served. A scanner that is *not configured at all* is a different thing and no
longer stops ingest: see [The two slots](#the-two-slots).

**Quarantines a match.** Status becomes `quarantined`, which no surface serves.
The object is not moved to a content-addressed key, not re-encoded, not
deleted, and no derivatives are built. The original bytes are also copied, as
they arrived, to `preserved/photo/<photoId>`: the upload's presigned PUT stays
valid for fifteen minutes and scanning takes seconds, so the upload key alone
could be overwritten by the uploader before anyone looked. A `safety_incident`
row records the provider, its classification and reference, the preserved
key, the content hash, the event, and the uploading actor — everything a
reviewer needs months later, copied onto the row so it survives the photo
being purged. A quarantined photo can never be processed again: the deriver
only processes `pending` rows, and `complete` refuses anything else.

**Protects the evidence from routine cleanup.** The purge job skips anything
under an open hold. This is the interaction most likely to fail silently: a
quarantined photo is soft-deleted like any other, so without the exemption the
ordinary 30-day cleanup would destroy preserved material *and report success*.
A hold with no end date is open-ended, not expired — the clock starts when a
report is filed, not when detection happened.

**Alerts a responder.** Identifiers only, by webhook or email — set either, or
both. No image, no thumbnail, no link that renders one, because whatever
receives it is likely a client that would render anything renderable. A
deployment with neither refuses to start in production.

## What the code deliberately does not do

**It does not report.** Reporting to NCMEC is a legal act with statutory
consequences for getting it wrong in either direction, and in the US it
requires being a registered electronic service provider with credentials
obtained in advance. There is no code path that files a report, and
`reported_at` is not settable by any automated path. What it does do is keep the
deadline: see "The 72-hour reporting deadline" below.

**It does not tell the uploader, or the host.** Neither is notified, and the
quarantined photo appears in no host-facing queue.

**It does not delete anything, ever.** Not the object, not the photo row, not
the incident.

**It does not ban anyone automatically.** A human decides.

**It sees every kind of image, once a provider is configured on both sides.**
Roll photographs are scanned in the deriver. Four kinds of image are stored by
the web app itself and never reach the deriver: moments, group pictures,
profile pictures and roll covers. Those are scanned in their own routes, with
the same client (`scannerFromEnv` in `@parea/core`), before anything is
stored — `apps/web/src/safety.ts`. A match there stores nothing visible: the
original goes to `preserved/<kind>/<id>`, an incident is written with its
`subject`, and the responder is alerted. An outage refuses the upload (503).
The web app reads its own copy of the `CSAM_SCANNER_*` settings from Vercel,
so they have to be set in both places for everything to be covered.

What is still open is a cover whose photograph was later quarantined through a
report, which remains the event's face on somebody's home screen. Step 2 below
closes it by hand.

## The review SLA

`PAREA_MODERATION=manual` is a promise that a person looks. This is the
promise, and it is stated here because the deriver announces on every boot that
it lives at this path — an undocumented commitment is the same as none.

These are ceilings for a one-person operation, not targets. If they stop being
achievable, change them here rather than quietly missing them: a written SLA
that is routinely broken is worse evidence than an honest one that is longer.

| What arrives | Automatic effect | A human looks within |
|---|---|---|
| Report of suspected child sexual abuse material | **Quarantined on receipt**, incident opened, responder alerted | **24 hours** |
| Report of other abuse | None — recorded to the queue | 72 hours |
| Removal request ("that is a photo of me") | Auto-hidden if the host has not answered in 48 hours | Host first; we only act if unanswered |
| Classifier flag, once one is configured | None — queued | 7 days |

The first row is the one that matters and the reason the others can be slower.
Nothing is exposed while it waits: the quarantine has already happened, is
automatic, and needs no human to be timely. What the 24 hours buys is the
decision — whether to file, and whether to release a false positive — and that
decision has a clock attached that the operator does not control.

Flags are reviewed in the admin hub. A reviewer can clear one, remove the
photo, or — if it looks like a child — escalate it, which quarantines the photo
and opens an incident (`provider` `staff_review`) on the same 72-hour clock as a
person's report. Seeing the photo is a separate, recorded request, and is
refused for anything already under a child-safety hold. If what you see may be
a child, stop looking and escalate: step 1 above applies from that moment.

The last row is deliberately long. A classifier flag hides nothing and is a
probabilistic opinion about ordinary adult content; treating it as urgent would
mean treating swimwear as urgent, and a queue that cries wolf is a queue nobody
opens.

**A single reviewer is a single point of failure.** One person unreachable for
a week means the 24 hours is fiction. Until there is a rota, the honest
statement is that this SLA holds while the operator is contactable, and the
mitigating fact is that the automatic effects — quarantine, incident,
preservation — do not wait for anyone.

## The 72-hour reporting deadline

**Every child-safety incident is reported, or released as a false match,
within 72 hours of `detected_at`.** This is a commitment made when applying
for PhotoDNA: every match is reported within 72 hours of the match response,
and missing it can get the service suspended. US law asks for "as soon as reasonably possible"; this is the
number that makes that checkable, and it applies to incidents opened by a
user's report too.

The product keeps the clock, so a person does not have to:

| Since detection | What happens |
|---|---|
| 0 hours | Quarantine, incident, responder alerted (the alert above) |
| 24 hours | One reminder to `SAFETY_ALERT_EMAIL` and Sentry |
| 48 hours onward | A reminder every hour |
| 72 hours | Every hour, marked **OVERDUE**, Sentry at `fatal` |

Reminders stop the moment `reported_at` or `released_at` is set. They come
from the Vercel cron `/api/cron/safety-deadlines` (hourly, at :40), not from
the Fly jobs machine, so they do not depend on the job whose heartbeat is
separately watched.

Every report — a PhotoDNA match and a user report that proves real alike —
goes **directly to NCMEC**, through its CyberTipline with Parea's ESP account.
PhotoDNA can also submit a report for us, but Microsoft's approval letter
(2 October 2026) recommends sending to NCMEC directly, whose interface is the
more complete one, and both routes need the same ESP account anyway. One
route for every report also means one way to record it, step 4 below.

## If you get an alert

1. **Do not open the image.** Viewing or downloading suspected material is
   itself restricted in most jurisdictions, and there is no product reason to:
   the incident row carries the hash, the provider's classification and its
   reference, which is what a report needs.
2. **Confirm the quarantine held, and clear the copies the scanner cannot
   see.** The photo should be `quarantined` and invisible everywhere. If it is
   not, stop and fix that first. Then check the two paths the deriver does not
   run on, because a quarantined photograph can still be somebody's event cover
   or profile picture:

   ```sql
   -- Covers on any event this uploader contributed to, and their own picture.
   select id, name, cover_key from "event" where cover_key is not null
     and id in (select event_id from "photo" where uploader_id = :actor);
   select id, avatar_key from "actor" where id = :actor and avatar_key is not null;
   ```

   Null the column and delete the object for each one. Do not open either
   image to decide — step 1 applies to these as much as to the photograph.
3. **File within 72 hours of detection,** directly with the NCMEC
   CyberTipline under Parea's ESP account, whatever opened the incident.
   Quote the incident's `provider_reference` (PhotoDNA's `TrackingId`) when
   it was a match.
   Involve counsel as they have directed in advance, but do not let that
   stretch the deadline above — the reminders will say how long is left.
4. **Record the outcome.** Set `reported_at` and `report_reference` on the
   incident by hand. Setting `reported_at` starts the one-year preservation
   window (`PRESERVATION_DAYS` in `@parea/core`), after which the purge job
   becomes free to clean up.
5. **If it was a false positive**, set `released_at`. That lifts the hold and
   returns the photo to ordinary handling. Leave a note saying who decided and
   on what basis.

Steps 4 and 5 can be done from the admin hub instead of by hand: **File**
takes the reference and sets the preservation date from it; **Release** needs
the reason and refuses an incident already filed. Both write `staff_action`
with the reviewer's email. The hub never shows the image — step 1 holds there
too.

## Before launch

None of these are code, and all of them gate shipping:

- [x] A scanning provider chosen, onboarded, and credentialed — PhotoDNA, approved 2026-10-06, keys live on Vercel and the deriver. The code speaks
      to a generic hash-matching HTTP endpoint; which provider is appropriate
      depends on eligibility rather than anything technical. PhotoDNA Cloud
      Service, Thorn's Safer, Google's Content Safety API and Cloudflare's CSAM
      Scanning Tool all occupy this slot.
- [x] **A named human** who receives alerts and is reachable. A rota if there
      is more than one. Demetri Hodges, the operator: `SAFETY_ALERT_EMAIL` is
      `safety@parea.photos`, which Cloudflare Email Routing forwards to
      demetri@daed.io (as it does `ops@`, so the two are one inbox — see
      incident-response.md). Recorded 2026-10-10.
- [ ] Registration and reporting credentials in place *before* the first
      detection, not after.
- [ ] Counsel briefed on the reporting workflow and on preservation.
- [x] The alert tested end to end with a synthetic incident — by email
      (`SAFETY_ALERT_EMAIL`; no webhook is configured). 2026-10-10, 05:00 UTC:
      Microsoft's sample `img_130.jpg` uploaded on the web was Edge-hashed,
      matched in the live service (Test, A1), quarantined, preserved under
      `preserved/photo/`, recorded as incident `de9410cf…` with its moderation
      row, and the alert reached demetri@daed.io. Then released as a test.
- [x] Someone has confirmed the purge exemption works against the real
      database, not only in tests. The same incident through the 05:09 UTC
      hourly run: `purge: 0`, the preserved object still 17,219 bytes, the
      photo still quarantined. (The purge deletes only tombstoned photos, so
      this shows a quarantined photo is left alone; the narrower case — a
      held photo somebody deleted — is covered by the jobs tests.)

## The audit trail

`moderation_action` is one append-only row per visibility change: which photo,
which event, what happened, who did it, and why. It answers "why is this photo
hidden and who hid it" without joining three tables and inferring from
timestamps, which is what the answer used to require.

Nothing updates or deletes a row in it, and it has **no foreign keys at all** —
not to the photo, not to the actor. Both omissions are the point. The purge job
hard-deletes photo rows thirty days after they are tombstoned, and a cascade
would take the record of the removal along with the thing removed. An actor
reference with `on delete set null` would erase who acted at the moment that
person deleted their account, which is exactly when the record matters most,
and following an actor merge would rewrite who did something after the fact.
Ids are frozen as they were; `actor.merged_into_id` still resolves one to a
person if anyone needs it.

A null `actor_id` means a rule acted rather than a person, and `reason` names
which: `auto_hide_48h`, `dedup`, `purge_grace`. A null actor with no named rule
would be an unexplained disappearance, and a test refuses one.

## Configuration

| Variable | Meaning |
|---|---|
| `CSAM_SCANNER_PROVIDER` | `photodna` for Microsoft PhotoDNA Cloud Service (approved 2026-10-06). Unset means the generic HTTP scanner below. |
| `CSAM_SCANNER_URL` | Provider endpoint. Required for the generic scanner; for PhotoDNA it only moves the call to a regional host (default `https://api.microsoftmoderator.com/photodna/v1.0/Match`). |
| `CSAM_SCANNER_KEY` | The credential — for PhotoDNA, the subscription key from the portal, sent as `Ocp-Apim-Subscription-Key`. |
| `CSAM_SCANNER_NAME` | Recorded on incidents, so old records say what checked them (generic scanner; PhotoDNA records `photodna`). |

### PhotoDNA: Edge Hashes, not images

Microsoft's approval letter says the cloud service is to be called with
**PhotoDNA Edge Hashes** — about a kilobyte, made here with Microsoft's SDK,
not reversible into the image — at `/MatchHash`, as
`[{ "DataRepresentation": "PreHashV2", "Value": "<base64>" }]`, up to five a
request. Today Parea still sends the image itself to `/Match`, which the
service answers, but which is not the approved use and sends every photo to
Microsoft.

- **Done, 10 October 2026: the deriver.** `src/edgeHash.ts` hashes each
  upload's scan rendition with Microsoft's WebAssembly library
  (`photoDnaEdgeHashS.js`, SDK 1.05.009), and `PhotoDnaHashScanner` sends the
  hash to `/MatchHash`; anything but status 3000 and `IsMatch` is
  `ScanUnavailable`, so the upload is not published. The Dockerfile sets
  `PHOTODNA_EDGEHASHGENERATOR` and refuses to build without the library, and
  the boot probe hashes a test card, so a broken copy fails the build.
- **A flat image is "nothing to match", and only that.** The library refuses
  a featureless picture — all black, all white, a lens cap — with `-7009,
  "Image is flat"`: no edges, so no fingerprint, and nothing a hash list could
  match. That one code is read as no match, logged, and not sent to
  Microsoft (decided 10 October 2026), so a pocket photo does not hang at
  "Processing" for ever. Every other refusal, unreadable file and service
  failure is still `ScanUnavailable`, and the upload is not published.
- **Checked by hand** with `scripts/edgehash-check.ts` before switching: the
  letter's test hash and both of Microsoft's sample images, hashed here, came
  back from the live service as matches from "Test" (A1) at distances 0 and
  2, in 2–8 ms a hash. The answer is
  `{ TrackingId, MatchResults: [{ Status, IsMatch, MatchDetails, TrackingId }] }`.
  The strings are not byte-identical to Microsoft's own sample hashes — two
  JPEG decoders read a file a few values apart — and the distance is the test.
- **The library is not in git.** It is copied into
  `services/deriver/vendor/photodna/` on the machine that deploys (see the
  README there). Microsoft's notice on AI agents forbids an agent from
  opening it: a person copies it in.
- **The web app's own images** — moments, group photos, profile pictures,
  covers — are checked by the deriver too: `apps/web/src/deriverScanner.ts`
  posts each scan copy to the deriver's `/scan` (`SCAN_PATH`), which hashes
  it and asks `/MatchHash`, and answers the verdict; the web app still does
  the preserving, the incident and the alert. Vercel builds from git and so
  cannot carry the library, which is why. On with `DERIVER_SCAN_URL` and
  `DERIVER_SCAN_TOKEN` on Vercel and the same `DERIVER_SCAN_TOKEN` secret on
  the deriver; anything but a verdict from it refuses the upload, as an
  outage always has. The privacy page says "only a fingerprint" exactly when
  the route is configured.
| `MODERATOR_PROVIDER` | `sightengine` or `generic`. A named one brings its own endpoint. |
| `MODERATOR_URL` | Classifier endpoint. Required for `generic`; overrides a named one. |
| `MODERATOR_KEY` | Bearer credential for it. |
| `MODERATOR_NAME` | Recorded on flags. |
| `MODERATOR_THRESHOLD` | Score at or above which a photo is flagged. Default 80. |
| `PAREA_MODERATION` | `automated` or `manual`. Required — a watcher refuses to start without it. |
| `CSAM_SCANNER_SEND_BYTES` | Defaults to sending the image. Read [What the hash-only path cannot do](#what-the-hash-only-path-cannot-do) before setting it to `false`. |
| `SAFETY_ALERT_WEBHOOK` | Where alerts go, for a team with a chat client. |
| `SAFETY_ALERT_EMAIL` | Where alerts go, for one person. Either is enough; both is fine. |

`CSAM_SCANNER=disabled` and `PAREA_ALLOW_UNSCANNED` are gone. They existed to
make running without scanning a deliberate, greppable act, which was right —
but the thing they made deliberate was the wrong thing. See below.

## The two slots

Two independent checks, and neither substitutes for the other.

**`CSAM_SCANNER_*` — hash matching.** Compares against curated lists of known
child sexual abuse material. A match quarantines the photo immediately, writes
a `safety_incident`, and wakes a responder. Access to these providers is gated
behind vetting and a commercial agreement, so a legitimate operator may not
have one for weeks. **Optional.**

**`MODERATOR_*` — content classification.** A probabilistic opinion about
explicit content, self-serve and cheap. A flag writes a `moderation_flag` and
**hides nothing** — it orders a human queue. Acting on a probability would take
down swimwear at a rate no small team can review. **Optional.**

**What it covers: album photos only.** The deriver is the only caller
(`services/deriver/src/moderation.ts`), so a classifier sees photos added to
albums and nothing else. Moments, group photos, avatars and covers, which the
web app re-encodes and stores itself, get hash matching
(`apps/web/src/safety.ts`) but are never classified; a report is the only way
one of them reaches a person.

Providers are a table, the same shape as the mail providers: choosing one is
configuration, adding one is an entry. `sightengine` is implemented against
their nudity-2.1 model; `generic` is JSON in, labels and a score out, which is
what a self-hosted classifier or a small wrapper would speak.

Only the explicit classes count toward a flag. `suggestive` — bikinis,
cleavage, bare male chests — is recorded as a label and does not flag, because
at an event photo product that is a beach holiday and a swimming pool, and a
queue full of them is a queue nobody opens. That threshold is a product
decision and should be revisited from real flag data rather than from a guess.

**Cloudflare Workers AI cannot do this job**, in case it looks like it should:
the catalog has ImageNet classification, a text-only safety model and a
vision-language model, and none of them is an explicit-content classifier.

A nudity model does not detect CSAM. A photo can be flagrant to one and
invisible to the other, in both directions, and putting classifier hits in
`safety_incident` would bury the records that have to stay trustworthy under
scrutiny. The tables are separate for that reason and must stay separate.

### Why the gate moved

The old rule was that a watcher refused to start without a CSAM scanner. That
conflated "we have no hash-matching provider" with "it is unsafe to accept a
photo", and the second does not follow from the first. Because approval takes
weeks, the only route to launching was `PAREA_ALLOW_UNSCANNED=private-deployment`
— a flag announcing you were running unsafely. An operator doing the
responsible thing and one cutting corners set the same variable and printed the
same banner.

What is required now is that somebody decided, not that they bought something:

| `PAREA_MODERATION` | Means |
|---|---|
| `automated` | A classifier is configured and flags to a queue. Refused if `MODERATOR_URL`/`KEY` are unset — claiming automation you do not have is worse than claiming nothing. |
| `manual` | A person reviews reports, on an SLA documented here. |
| unset | The watcher refuses to start. |

Hash matching is reported separately by `deriver probe` and is not part of this
check, in either direction: having it does not answer how the rest of the
photos are reviewed, and lacking it does not stop a deployment that has
answered.

**If you are running `manual`, write the SLA down here.** An undocumented
promise to look at reports is the same as no promise.

## What the hash-only path cannot do

`CSAM_SCANNER_SEND_BYTES=false` sends the provider a SHA-256 of the stripped
file and nothing else. **That will not match a known-CSAM list**, and the
reason is worth understanding before anyone configures it that way.

Known-material matching works one of two ways. Either a **cryptographic hash
of the original file** — the lists are mostly MD5 and SHA-1 — or a
**perceptual hash** computed from the pixels, which is what survives a resize,
a re-encode or a crop. A SHA-256 is neither of those, and it is taken *after*
`exiftool` has rewritten the file, so it does not describe any original that
could be on a list. Stripping metadata deliberately changes the bytes; that is
its whole job.

The failure mode is the bad one. The scanner is reachable, answers
`{"match": false}` for every photo, and the deployment looks healthy. Every
other part of this system fails closed; this path fails open and silent, which
is precisely what §13 is meant to prevent.

Two ways out, and the provider decides which:

- **Send the bytes.** `CSAM_SCANNER_SEND_BYTES=true`, and the provider hashes
  them. Simple, and the photos leave the system.
- **Compute the provider's perceptual hash locally** and send that instead.
  Keeps the pixels in, and needs `HttpHashScanner` taught to produce whatever
  the provider's client library produces — a code change, not configuration.
  A perceptual hash is computed from pixels, so metadata stripping does not
  disturb it and the current ordering is fine.

The second is better and is what the "prefer hash-only" instinct was reaching
for. It is not what the code does today.

## A note on the minors question

`docs/concept.md` rules out targeting use cases centred on children — youth
sports, school events — because they combine guest uploads from unverified
accounts with images of minors. Nothing in the schema encourages it, and there
is no face matching to disable, which is most of the protection. That position
is a product decision that reduces this risk surface; it does not remove the
obligation, which is why this exists.
