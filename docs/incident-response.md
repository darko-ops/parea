# Incident response

What to do when something goes wrong, who decides, and the clocks that start
running. One page on purpose: it is read under pressure.

Child sexual abuse material has its own runbook with statutory deadlines —
**[csam-runbook.md](csam-runbook.md)**. It takes priority over everything here.

## Who

Parea is run by one person today, who is the incident lead for everything
below and holds every production credential (see [access.md](access.md)).
When a second person joins, name a deputy here and give them the same access.

## Where alerts arrive

| Alert | From | Goes to |
|---|---|---|
| A child-safety quarantine | deriver, photo report route | `SAFETY_ALERT_EMAIL` / `SAFETY_ALERT_WEBHOOK` |
| Any report of a photo, moment, comment, message, profile or group | web (`alertReport`) | the same |
| The hourly job has not succeeded in 3 hours | Vercel cron `/api/cron/jobs-heartbeat` | Sentry, and `OPS_ALERT_EMAIL` |
| Server errors, CSP violations | web | Sentry |
| Mail to `SAFETY_ALERT_EMAIL` or `OPS_ALERT_EMAIL` bounced, was marked spam or is suppressed | Resend webhook `/api/webhooks/resend` | Sentry (fatal), and the *other* alert address |
| Any other bounce, complaint or suppressed send, grouped by kind of mail | the same | Sentry (warning) |
| Photos the deriver failed (with the reasons), at most hourly | Vercel cron `/api/cron/derive-backlog` | Sentry, and `OPS_ALERT_EMAIL` |
| Photos waiting more than five minutes | the same cron | the same |
| Deriver refusing to start | Fly logs (`flyctl logs -a parea-deriver`); it stops taking photos, so the backlog alarm above fires | the same, via the backlog |

If `SAFETY_ALERT_EMAIL` is unset, reports are filed and nobody is told. Set it.

Somebody says their sign-in codes never arrive: Resend has probably put the
address on its suppression list after a bounce or a spam complaint, and will
not send to it again by itself. Look it up in Resend → Suppressions, and remove
it once the person confirms the address is right.

## Reports

Reviewed within **72 hours** — the time the terms and the safety page promise.
Child-safety reports: straight away, per the CSAM runbook.

Open reports:

```sql
select * from content_report where status = 'open' order by created_at;
select * from report where status = 'open' and kind <> 'removal_request' order by created_at;
```

Act (remove the content, block, or delete the account) and then set
`status = 'actioned'` or `'declined'` and `resolved_at = now()`. Removal
requests go to the album's host, and hide automatically after 48 hours.

## Severity

- **Sev 1** — data exposed to people who should not have it, credentials
  leaked, the database or photo store lost or altered, CSAM served. Drop
  everything.
- **Sev 2** — the product is down or uploads are failing for everyone.
- **Sev 3** — one feature broken, one person affected.

## A Sev 1, in order

1. **Contain.** Rotate whatever leaked (the table in [access.md](access.md)
   says what each secret unlocks and how to rotate it). Revoke sessions:
   `update session set revoked_at = now() where revoked_at is null;` signs
   everyone out. Rotate an album's link from its settings to end every image
   URL and download link already handed out for it.
2. **Preserve.** Before fixing, save what you will need to understand it:
   Vercel and Fly logs (they age out), the relevant rows, a Neon branch of
   production (see [backup-restore.md](backup-restore.md)).
3. **Fix**, through git, as always ([deploy-practice.md](deploy-practice.md)).
4. **Write down** what happened, when, who was affected and what was done, as
   it happens — in a private note, with times in UTC. It is the record every
   notification below is built from.

## Personal data breach: the clocks

A breach is personal data being lost, altered, or seen by somebody it was not
meant for — accidentally or not.

- **UK / EU (GDPR):** tell the supervisory authority (ICO in the UK) within
  **72 hours** of becoming aware, unless it is unlikely to harm anyone. Tell
  the people affected without undue delay if it is likely to be a high risk to
  them. Record every breach, notified or not.
- **US:** state laws vary; most require notifying affected residents "without
  unreasonable delay", some within 30–60 days, and some the state attorney
  general too. Take legal advice on which apply.
- **App Store / Play:** no separate breach duty, but a compromised app build
  or signing key is reported to them.

Legal review of this section is on the launch list.

## Law enforcement requests

- Requests come to the safety contact address. Nothing is disclosed without
  valid legal process (a subpoena, court order or warrant appropriate to the
  data asked for), except in an emergency involving risk of death or serious
  injury, and then only what is needed.
- **Preservation requests** (e.g. US 18 U.S.C. §2703(f)): preserve the named
  records for 90 days, extendable once, by taking a Neon branch and copying
  the named R2 objects under `preserved/` — before the normal deletion jobs
  reach them.
- Tell the person affected unless the law or the order forbids it.
- Keep a log: date, agency, what was asked, what was given, and why.

## Copyright (DMCA)

- A designated agent must be registered with the US Copyright Office
  (`dmca.copyright.gov`) for the safe harbour to apply — **not done yet**.
  Until it is, notices go to the safety contact address.
- On a valid notice: remove the photo (as its uploader could), tell the
  uploader, and keep the notice. On a valid counter-notice: restore after 10–14
  business days unless the claimant says they have gone to court.
- An account with repeated valid notices is closed (repeat-infringer policy).

## Afterwards

Within a week: what happened, why, what changed so it cannot happen the same
way again. Update this file if it was wrong.
