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
The object stays exactly where it is: not moved to a content-addressed key, not
re-encoded, not deleted, no derivatives built. A `safety_incident` row records
the provider, its classification and reference, the object key, the content
hash, the event, and the uploading actor — everything a reviewer needs months
later, copied onto the row so it survives the photo being purged.

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
`reported_at` is not settable by any automated path.

**It does not tell the uploader, or the host.** Neither is notified, and the
quarantined photo appears in no host-facing queue.

**It does not delete anything, ever.** Not the object, not the photo row, not
the incident.

**It does not ban anyone automatically.** A human decides.

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

The last row is deliberately long. A classifier flag hides nothing and is a
probabilistic opinion about ordinary adult content; treating it as urgent would
mean treating swimwear as urgent, and a queue that cries wolf is a queue nobody
opens.

**A single reviewer is a single point of failure.** One person unreachable for
a week means the 24 hours is fiction. Until there is a rota, the honest
statement is that this SLA holds while the operator is contactable, and the
mitigating fact is that the automatic effects — quarantine, incident,
preservation — do not wait for anyone.

## If you get an alert

1. **Do not open the image.** Viewing or downloading suspected material is
   itself restricted in most jurisdictions, and there is no product reason to:
   the incident row carries the hash, the provider's classification and its
   reference, which is what a report needs.
2. **Confirm the quarantine held.** The photo should be `quarantined` and
   invisible everywhere. If it is not, stop and fix that first.
3. **Contact counsel and file.** Whatever your counsel directs, through
   whatever channel you have established in advance. The alert is the start of
   a clock you do not control.
4. **Record the outcome.** Set `reported_at` and `report_reference` on the
   incident by hand. Setting `reported_at` starts the 90-day preservation
   window (`PRESERVATION_DAYS` in `@parea/core`), after which the purge job
   becomes free to clean up.
5. **If it was a false positive**, set `released_at`. That lifts the hold and
   returns the photo to ordinary handling. Leave a note saying who decided and
   on what basis.

## Before launch

None of these are code, and all of them gate shipping:

- [ ] A scanning provider chosen, onboarded, and credentialed. The code speaks
      to a generic hash-matching HTTP endpoint; which provider is appropriate
      depends on eligibility rather than anything technical. PhotoDNA Cloud
      Service, Thorn's Safer, Google's Content Safety API and Cloudflare's CSAM
      Scanning Tool all occupy this slot.
- [ ] **A named human** who receives alerts and is reachable. A rota if there
      is more than one.
- [ ] Registration and reporting credentials in place *before* the first
      detection, not after.
- [ ] Counsel briefed on the reporting workflow and on preservation.
- [ ] `SAFETY_ALERT_WEBHOOK` configured and tested end to end with a synthetic
      incident.
- [ ] Someone has confirmed the purge exemption works against the real
      database, not only in tests.

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
| `CSAM_SCANNER_URL` | Provider endpoint. |
| `CSAM_SCANNER_KEY` | Bearer credential. |
| `CSAM_SCANNER_NAME` | Recorded on incidents, so old records say what checked them. |
| `MODERATOR_URL` | Content classifier endpoint. Optional, and not a CSAM scanner. |
| `MODERATOR_KEY` | Bearer credential for it. |
| `MODERATOR_NAME` | Recorded on flags. |
| `MODERATOR_THRESHOLD` | Score at or above which a photo is flagged. Default 80. |
| `PAREA_MODERATION` | `automated` or `manual`. Required — a watcher refuses to start without it. |
| `CSAM_SCANNER_SEND_BYTES` | Almost certainly `true` — read [What the hash-only path cannot do](#what-the-hash-only-path-cannot-do) before setting it to `false`. |
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
