# Launch

The ordered version of [`deploy.md`](deploy.md). That page says how each piece
is stood up; this one says what order to do it in, what is blocked on what, and
what is not code at all.

Two things here have latency nothing can compress — **mail reputation** (days)
and **child-safety provider onboarding** (days to weeks) — so both start at the
top even though neither is needed until much later.

Tick as you go. Status as of **6 October 2026**: the web product, the
Workers, the deriver and the jobs are live, with real people on them, and the
iOS app runs as an EAS `preview` build. Child-safety matching (PhotoDNA) went
live today. What is still open is mostly not code — see §8.

A ticked box here means somebody watched it work, not that it was attempted.
Where the evidence is weaker than that, the box stays open and says what is
still unproven — a checklist that records intentions is worse than no
checklist, because it is consulted instead of the thing itself.

## 0. In parallel, starting now

- [x] **Start the child-safety provider conversation.** Microsoft PhotoDNA
      Cloud Service approved Parea on 2026-10-06, and it is live — see §8.
- [ ] **NCMEC CyberTipline registration** as an electronic service provider
      (<https://esp.ncmec.org/registration>). The privacy page now says a
      confirmed match is reported to NCMEC, so this has to exist before the
      first one, not after. Not confirmed.
- [x] **SMS (A2P 10DLC) campaign.** Approved on the fifth submission
      (9 October 2026), sending from `+14244088809` — see `docs/sms-a2p.md`.
      The two earlier 30908 rejections were the privacy policy, fixed on
      2026-10-05.
      See [`sms-a2p.md`](sms-a2p.md).

## 1. DNS

Everything downstream needs a name, and two things need DNS to have settled
before they can even be verified.

- [x] Move the zone to Cloudflare. Keep the registration where it is — only the
      nameservers change. Required if `img.` and `zip.` are to be real
      hostnames: Worker custom domains only exist for zones on Cloudflare.
- [x] **Check DNSSEC at the registrar first.** If it is on and the nameservers
      change, the registry keeps publishing a DS record signed by keys the new
      nameservers do not have and the domain stops resolving entirely. Disable
      it, wait an hour, then switch.
- [x] Confirm with `dig +short NS parea.photos`. `dig +trace` if a resolver is
      holding the old answer.
- [x] Set SSL/TLS to **Full (strict)**, and **Always Use HTTPS** on — set in
      the dashboard on 2026-10-10 (nothing here can read it back). It only
      matters for a proxied record with an origin behind it, and today there is
      none (Vercel is grey-cloud and `img.`/`zip.` are Worker custom domains),
      so it guards later rather than changing anything now: proxy a record one
      day and Cloudflare insists on a valid certificate at the origin, where
      Flexible would have sent it plaintext and looked fine in a browser.

Records, once the zone is live. Everything Vercel-facing is **DNS only** — grey
cloud. Proxying Cloudflare in front of Vercel's own edge stacks two CDNs and
commonly breaks certificate issuance outright.

| Name | Type | Value | Notes | State |
|---|---|---|---|---|
| `@` | A | from Vercel | grey cloud | resolving |
| `www` | CNAME | `cname.vercel-dns.com` | grey cloud | resolving |
| `send` | MX + TXT | from the mail provider | return path and SPF | provider reports verified |
| `<selector>._domainkey` | TXT | from the mail provider | DKIM | provider reports verified |
| `_dmarc` | TXT | `v=DMARC1; p=quarantine; rua=mailto:dmarc@parea.photos; adkim=r; aspf=r` | already at `p=quarantine` | resolving (checked 2026-10-06) |

"Resolving" is the whole claim for the first two: the names answer with the
right values. Nothing is served at them yet, and an A record pointing at
Vercel's anycast address says nothing about whether a project is attached to
it — `curl -s -H "authorization: Bearer $HEALTH_TOKEN" https://parea.photos/api/health` is what answers that, and it is
§4's job.

- [x] **Inbound email.** All three addresses deliver (2026-10-06). Routing is on (MX → Cloudflare Email Routing). Three
  addresses have to actually arrive in a real inbox, and a route that was
  configured and a route that delivers are different facts — the difference is
  only ever discovered by the person who needed to reach you. Send one to each
  and watch it land:
  - [x] `SAFETY_CONTACT_EMAIL` — safety@parea.photos, published on `/safety`
        (an App Store 1.2 requirement a reviewer will check) and given to NCMEC.
        A test message arrived, 2026-10-06.
  - [x] the DMARC `rua` address above, dmarc@parea.photos. A test message
        arrived, 2026-10-06.
  - [x] whatever `MAIL_FROM` is — someone will reply to a sign-in code saying
        "I did not ask for this", and that is exactly the person to hear from.
        A test message arrived, 2026-10-06.

`img.` and `zip.` come later: a Worker custom domain is added from the Worker's
own settings and the Worker has to exist first.

## 2. Database and storage

`./scripts/setup-infra.sh` does most of this against your own logins. It
generates all three shared secrets together so they cannot disagree, writes
`apps/web/.env.local`, applies migrations and seeds the code pool. Idempotent,
deletes nothing.

- [x] Neon project, `npm run db:migrate`. Only the first time: a production
      deploy runs it from `vercel-build` after this. See `docs/deploy.md`.
- [x] R2 bucket, lifecycle rule on `tmp/manifest/` expiring after 1 day, and no
      public access. Confirmed 2026-10-06 (`moments/incoming/` has a 1-day rule
      too). Confirm the rule landed —
      `npx wrangler r2 bucket lifecycle list parea` should name
      `expire-manifests`. Nothing else ever deletes those objects.
- [x] **R2 CORS.** Confirmed 2026-10-06: PUT/GET/HEAD from `parea.photos`,
      `www.parea.photos`, `*.vercel.app` and localhost. Without it every browser upload fails, silently and in a way
      that points somewhere else — see [`deploy.md`](deploy.md#2-r2). Confirm
      with `npx wrangler r2 bucket cors list parea`, and confirm it names the
      origin actually being used: a policy listing the wrong hostname reads as
      configured and behaves as absent.
- [x] R2 S3-API token — set on Vercel and on both Fly apps; photos ingest.
- [x] `seed-codes`, or the spoken-code door never opens. Runs inside the hourly
      job on `parea-jobs`, which exits 0 each hour.

## 3. Workers

- [x] Deploy `parea-img` and `parea-zip`.
- [x] Add `img.parea.photos` and `zip.parea.photos` as custom domains **from
      each Worker's settings**, which writes the DNS record itself. Do not
      hand-create a CNAME. Both answer from their Worker.
- [x] Set `IMAGE_BASE_URL` and `ZIP_BASE_URL` to those hostnames.

Both Worker secrets must match the web app's. A mismatch is silent: every
thumbnail 404s, or every download does.

## 4. Web app

- [x] Deploy `apps/web` to Vercel with the environment in
      [`deploy.md`](deploy.md#full-environment).
- [x] `LEGAL_ENTITY` and `LEGAL_JURISDICTION` — required in production. Both
      set; `/terms` reads "governed by the law of the State of North Carolina". Without
      them `/terms` and `/privacy` render a visible placeholder where the
      operator's name should be.

      `LEGAL_ENTITY` is **`DAED LLC`** — no comma. Checked against Item 1 of
      the Articles of Organization filed with the North Carolina Secretary of
      State (SOSID 3306838), not against how the name is usually written,
      because this string is printed verbatim as the party making the promise
      on both pages.

      `LEGAL_JURISDICTION` still needs counsel's sign-off, but the answer is
      almost certainly North Carolina: the LLC is formed there under
      §57D-2-20 of its General Statutes and the operator is there too. Mind the
      grammar when setting it — `/terms` reads "governed by the law of
      {`LEGAL_JURISDICTION`}, and its courts have jurisdiction", so the value
      wants to be `the State of North Carolina` rather than a bare `NC`.
- [ ] `/api/health` returns 200 and reports nothing missing. It returns 200;
      the detailed report needs `HEALTH_TOKEN` and has not been read.

## 5. Mail

- [x] Verify the domain with the provider; DKIM green is the gate.
- [x] `npm run mail:test -- you@example.com`, then sign in at `/account` for
      real. People sign in with emailed codes every day. **Nothing else will tell you this is broken**: the code endpoint
      answers 204 however it went, on purpose, so a misconfigured mailer looks
      exactly like a working one from the outside.
- [ ] Check spam. First mail from a new sending domain often lands there.

## 6. Deriver

- [x] Fly app, secrets, deploy. Redeployed 2026-10-06 with PhotoDNA; its boot
      probe reports `ok csam-scanner photodna`. The image runs a boot probe and refuses to
      start if it cannot decode HEIC, encode AVIF, find exiftool, or reach a
      scanner — a deriver that starts is one that can do the job.
- [x] Schedule the jobs. Hourly, on `parea-jobs` — see the note on updating
      its image in `deploy.md`, which `fly deploy` does not do. `nudge`, `auto-hide` and `expire-rate-limits` have
      clocks attached: an unanswered removal request only hides after 48 hours
      if `auto-hide` is actually running.

## 7. Private soak

Everything stood up, nobody else invited, no hash matching configured — the
supported way to run until a provider approves Parea. The privacy page and
terms say matching is not running, because they read the same settings the
scanner does.

Anyone with a link can upload, so "private" means not sharing a link. There is
no auth wall doing it for you.

Work the post-deploy checklist in [`deploy.md`](deploy.md#after-the-first-deploy).
The two items in it that no test can cover:

- [ ] **iOS Safari, large upload, reload mid-batch.** Does it resume or ask for
      the files again? Both are handled; which happens is a device fact and it
      decides how good the web contribution path actually is.
- [ ] **The downloaded photo has no GPS.** `exiftool -GPSLatitude file`.

## 8. Before anyone else can reach it

- [x] A real hash-matching provider set on the deriver *and* Vercel, and the
      privacy page saying matching is running. PhotoDNA, 2026-10-06: a test
      image scanned end to end from the deriver (`match: false`), and
      `/privacy` says every image is checked.
- [ ] Everything in [`csam-runbook.md`](csam-runbook.md): credentials before the
      first detection, counsel briefed, a named human who receives alerts, and
      a synthetic alert proven to reach them. The provider is done; NCMEC
      registration (§0), counsel and the synthetic alert are not confirmed.
- [ ] A lawyer has read `/terms` and `/privacy`. They are written from the
      schema and every number in them is asserted against the constant it came
      from, which makes them accurate — not reviewed.

At this point the **web product is launchable**. Everything below is the app.

## 9. The app

- [x] **Assets.** Icon, Android adaptive foreground and favicon are in
      `apps/mobile/assets/`, rendered from `assets/icon.svg` by `npm run
      icons`, and asserted by `test/assets.test.ts` — 1024×1024, no alpha on
      the iOS icon, alpha on the Android foreground, and `app.json` pointing at
      files that exist. Not yet seen on a device: nothing in this client has
      been rendered, so how the icon looks under a launcher's mask is still
      unobserved.
- [x] **`expo prebuild`, and run it.** Runs daily — on the simulator from
      Metro, and on the owner's iPhone as an EAS `preview` build (internal
      distribution, 2026-10-05) that takes over-the-air updates.
- [x] `APPLE_TEAM_ID` and `ANDROID_CERT_FINGERPRINTS` on the web deployment
      **before any build goes out**. Both set; both `.well-known` files serve. Both `.well-known` files 404 until they are
      set, and Apple caches the AASA hard — absent is recoverable, wrong is not.
      Android needs both certificates: the upload key and the Play signing key.
- [x] `staging.parea.photos` — the `preview` EAS profile pointed at a host
      nobody stood up. Repointed at the deployment, which is what the private
      soak actually runs on; a second environment is a second database, bucket
      and pair of Workers, and none of that is planned. `test/config.test.ts`
      now allows only hosts we operate, so the next invented one fails there
      rather than on a tester's phone. Revisit when real people are on it:
      `preview` then reaches live data with nothing between them but the
      release channel.
- [ ] Age rating. A UGC app does not get to claim 4+.
- [x] App Store / TestFlight submission. Build 7 is in App Review, signed in
      with the review account (`APP_REVIEW_EMAIL`, see `apps/web/src/review.ts`).
- [x] **Nutrition labels.** Precise location is declared (Location → Precise
      location, app functionality, not tracking) in the iOS privacy manifest in
      `apps/mobile/app.json` and in
      [`store-privacy-labels.md`](store-privacy-labels.md). The location inside
      an uploaded photo's metadata reaches our storage and sits there until
      ingest, which strips it from the original itself, stores only the
      stripped copy and deletes the upload (`services/deriver/src/pipeline.ts`)
      — so it is collected, briefly, and never kept or shown. The store forms
      themselves are filled in by hand from that file.

## Known limits, not blockers

One deriver machine — QStash delivers one photo at a time to it, and scaling
out needs claim-based work distribution first. Bounces and complaints on outbound mail are
suppressed by Resend and reported to us through its webhook (`src/mailEvents.ts`).
