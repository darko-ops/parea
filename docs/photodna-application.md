# PhotoDNA Cloud Service — application draft

Answers for the PhotoDNA Cloud Service application
(<https://myphotodna.microsoftmoderator.com/Profile>). The portal's exact
questions are only visible once signed in, so these are written to cover what
such applications ask: who you are, what the service is, how images flow, what
you do on a match, and volume. Anything in **[brackets]** is yours to fill in.

Register with NCMEC's CyberTipline as an electronic service provider first
(<https://esp.ncmec.org/registration>). Vetting commonly asks for it,
and a match has to be reportable the day it happens.

---

## Organisation

- **Legal name:** [the `LEGAL_ENTITY` named on parea.photos/terms]
- **Country of registration:** [country]
- **Registered address:** [address]
- **Website:** https://parea.photos
- **Primary contact:** [name], [role], [email], [phone]
- **Child-safety contact:** [name], [the `SAFETY_ALERT_EMAIL` address]
- **NCMEC ESP registration:** [ESP ID once registered]

## What the service is

Parea is a photo-sharing app for events and private groups. A person creates
an album (a "roll") for an evening, a trip or a gathering, invites the people
who were there, and everyone adds the photos they took, so the group ends up
with one shared set. Groups hold a series of rolls for the same circle of
friends over time. There is also a short-lived "moment": a single photo shared
with the poster's friends for 24 hours.

It is available on the web and as iOS and Android apps. Accounts are for people
aged 13 and over; a date-of-birth check at sign-up refuses anyone younger, and
the date is not stored. Albums are private by default: reachable only through
an invitation, a group, a link or a spoken code the creator shares. There is no
public feed, no discovery of other people's photos, and no messaging with
strangers.

## How images enter and are published

1. The client uploads the original directly to our object storage (Cloudflare
   R2) through a short-lived presigned URL. At this point it is stored
   privately and served to nobody.
2. Our processing service (Node.js on Fly.io, London region) is notified
   through a queue. It removes location and personal metadata, computes a
   SHA-256 of the result, and **calls the child-safety scanner with the image
   before anything else happens to it**.
3. Only a photo that the scanner has cleared is marked ready, resized and
   served. Until then no URL for it exists. If the scanner cannot be reached,
   the photo stays unpublished and the job is retried; nothing is published
   unscanned.
4. The same check runs on every other image a person can upload: moments,
   profile pictures, group pictures and album covers.

The integration is server-side only. Our API key would live in the processing
service's secret store and never reach a client.

## What happens on a match

Built and tested today, waiting only on a scanner:

- The photo is **quarantined** immediately: never published, and any existing
  links to it stop working within a minute.
- The original is **preserved** in a separate, restricted location for one
  year (the preservation period under 18 U.S.C. §2258A as amended by the
  REPORT Act), and cannot be deleted by the uploader or by routine clean-up.
- A **safety incident** is recorded with the content hash, the match details
  and the account involved, and our responder is **alerted by email** at once.
- We **report every match through the PhotoDNA reporting API within 72
  hours** of the match response, and act on the account. The deadline is
  tracked by the system: a reminder goes to our safety address at 24 hours,
  then every hour from 48 hours until the report is recorded, and past 72
  hours it escalates as overdue.
- Staff do **not** open or view matched images. The incident record carries
  what a report needs.

Users can also report any photo, moment, comment, message, profile or group.
A report of child abuse quarantines a photo on receipt, before anyone
reviews it, and alerts the responder the same way. Our written process is
the child-safety runbook (`docs/csam-runbook.md`).

## Volume

- **Images today:** [about 100 stored; we are pre-launch]
- **Expected in the first year:** [e.g. 10,000–50,000 images a month]
- **Peak:** photos arrive in bursts after an event, up to a few hundred from
  one album within an hour.
- **Image types:** JPEG, HEIC/HEIF (iPhone), PNG, WebP and AVIF, checked by
  their file signature rather than the name.
- **Largest upload:** 200 MB, though phone photos are typically 2–8 MB.
  [Confirm PhotoDNA's accepted formats and size limit. For anything it does
  not take, such as HEIC or a very large file, we will send a full-resolution
  JPEG made from the original instead.]

## Why PhotoDNA

Parea's users share photos in closed groups, the setting where known material
is most likely to circulate unreported: nobody inside a group sharing it will
flag it. Hash matching at upload is the only control that catches it there,
and PhotoDNA is the established standard for it. We have built quarantine,
preservation, alerting and reporting around the scan and are ready to turn it
on as soon as we have access.

---

## After approval (for us, not the form)

The scanner hook (`HttpHashScanner` in `packages/core/src/scanner.ts`) speaks a
generic JSON shape. PhotoDNA's Match API is different: an
`Ocp-Apim-Subscription-Key` header, an inline base64 image, and an `IsMatch`
response. It needs a small adapter, then these Fly secrets on `parea-deriver`
and Vercel (the web app scans the images it handles itself):
`CSAM_SCANNER_URL`, `CSAM_SCANNER_KEY`, `CSAM_SCANNER_NAME=photodna`. The
privacy page switches to saying scanning is on when those are present.
