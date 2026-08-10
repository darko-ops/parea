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

**Fails closed.** If no scanner is configured, or the scanner is unreachable,
the photo never reaches `ready` — and `ready` is the gate every listing,
download and image URL keys off. Unscanned content is therefore never served,
at the cost of ingest stalling during an outage. That is the correct way round,
and `deriver probe` refuses to start a watcher without a scanner configured.

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

**Alerts a responder.** Identifiers only, over `SAFETY_ALERT_WEBHOOK`. No
image, no thumbnail, no link that renders one.

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

## Configuration

| Variable | Meaning |
|---|---|
| `CSAM_SCANNER_URL` | Provider endpoint. |
| `CSAM_SCANNER_KEY` | Bearer credential. |
| `CSAM_SCANNER_NAME` | Recorded on incidents, so old records say what checked them. |
| `CSAM_SCANNER_SEND_BYTES` | `true` only if the provider cannot match on a hash. Prefer hash-only: nearly everything passing through is somebody's birthday party. |
| `CSAM_SCANNER=disabled` | Development only. Refuses to load in production. |
| `SAFETY_ALERT_WEBHOOK` | Where alerts go. |

`CSAM_SCANNER=disabled` exists so that running without scanning is a
deliberate, greppable act rather than something achieved by forgetting a
variable.

## A note on the minors question

`docs/concept.md` rules out targeting use cases centred on children — youth
sports, school events — because they combine guest uploads from unverified
accounts with images of minors. Nothing in the schema encourages it, and there
is no face matching to disable, which is most of the protection. That position
is a product decision that reduces this risk surface; it does not remove the
obligation, which is why this exists.
