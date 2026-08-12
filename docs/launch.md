# Launch

The ordered version of [`deploy.md`](deploy.md). That page says how each piece
is stood up; this one says what order to do it in, what is blocked on what, and
what is not code at all.

Two things here have latency nothing can compress — **mail reputation** (days)
and **child-safety provider onboarding** (days to weeks) — so both start at the
top even though neither is needed until much later.

Tick as you go. §1 is partly done; everything from §2 on is untouched.

A ticked box here means somebody watched it work, not that it was attempted.
Where the evidence is weaker than that, the box stays open and says what is
still unproven — a checklist that records intentions is worse than no
checklist, because it is consulted instead of the thing itself.

## 0. In parallel, starting now

- [ ] **Start the child-safety provider conversation.** This is the hard gate
      and the longest lead time: onboarding is email and paperwork with humans
      on the other end. [`csam-runbook.md`](csam-runbook.md) is the checklist.
      Until it is done, nothing anyone else can reach may be deployed.
- [ ] **Run the geotag probe** against a real photo library
      (`tools/geotag-probe`). It is the only measurement left that can change
      what gets built: if cameras are not writing GPS, auto-selection degrades
      to a nicer file picker and the native client loses its main reason to
      exist. **Read §2 of that README first** — the convenient ways to move
      photos off a phone strip exactly the metadata being measured, and a
      stripping path produces a confident 0% from a healthy camera roll.

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
- [ ] Set SSL/TLS to **Full (strict)**. Not confirmed. It is the one setting
      here that fails quietly in the wrong direction: Flexible serves the site
      over plaintext to the origin and looks perfectly fine in a browser.

Records, once the zone is live. Everything Vercel-facing is **DNS only** — grey
cloud. Proxying Cloudflare in front of Vercel's own edge stacks two CDNs and
commonly breaks certificate issuance outright.

| Name | Type | Value | Notes | State |
|---|---|---|---|---|
| `@` | A | from Vercel | grey cloud | resolving |
| `www` | CNAME | `cname.vercel-dns.com` | grey cloud | resolving |
| `send` | MX + TXT | from the mail provider | return path and SPF | provider reports verified |
| `<selector>._domainkey` | TXT | from the mail provider | DKIM | provider reports verified |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:dmarc@parea.photos` | start at `p=none` | **unconfirmed** |

"Resolving" is the whole claim for the first two: the names answer with the
right values. Nothing is served at them yet, and an A record pointing at
Vercel's anycast address says nothing about whether a project is attached to
it — `curl -s https://parea.photos/api/health` is what answers that, and it is
§4's job.

- [ ] **Inbound email.** Routing is switched on; nothing has been received
      through it. Three addresses have to actually arrive in a real inbox:
      `SAFETY_CONTACT_EMAIL` (published on `/safety`, an App Store 1.2
      requirement a reviewer will check), the `rua` address above, and whatever
      `MAIL_FROM` is — someone will reply to a sign-in code saying "I did not
      ask for this", and that is exactly the person to hear from. Cloudflare
      Email Routing is free and forwards to a real inbox. Send one to each and
      watch it land; a route that was configured and a route that delivers are
      different facts, and the difference is only ever discovered by the person
      who needed to reach you.

`img.` and `zip.` come later: a Worker custom domain is added from the Worker's
own settings and the Worker has to exist first.

## 2. Database and storage

`./scripts/setup-infra.sh` does most of this against your own logins. It
generates all three shared secrets together so they cannot disagree, writes
`apps/web/.env.local`, applies migrations and seeds the code pool. Idempotent,
deletes nothing.

- [ ] Neon project, `npm run db:migrate`.
- [ ] R2 bucket, lifecycle rule on `tmp/manifest/` expiring after 1 day, and no
      public access. Confirm the rule landed —
      `npx wrangler r2 bucket lifecycle list parea` should name
      `expire-manifests`. Nothing else ever deletes those objects.
- [ ] R2 S3-API token — dashboard only, the script stops here and says so.
- [ ] `seed-codes`, or the spoken-code door never opens.

## 3. Workers

- [ ] Deploy `parea-img` and `parea-zip`.
- [ ] Add `img.parea.photos` and `zip.parea.photos` as custom domains **from
      each Worker's settings**, which writes the DNS record itself. Do not
      hand-create a CNAME.
- [ ] Set `IMAGE_BASE_URL` and `ZIP_BASE_URL` to those hostnames.

Both Worker secrets must match the web app's. A mismatch is silent: every
thumbnail 404s, or every download does.

## 4. Web app

- [ ] Deploy `apps/web` to Vercel with the environment in
      [`deploy.md`](deploy.md#full-environment).
- [ ] `LEGAL_ENTITY` and `LEGAL_JURISDICTION` — required in production. Without
      them `/terms` and `/privacy` render a visible placeholder where the
      operator's name should be.
- [ ] `/api/health` returns 200 and reports nothing missing.

## 5. Mail

- [ ] Verify the domain with the provider; DKIM green is the gate.
- [ ] `npm run mail:test -- you@example.com`, then sign in at `/account` for
      real. **Nothing else will tell you this is broken**: the code endpoint
      answers 204 however it went, on purpose, so a misconfigured mailer looks
      exactly like a working one from the outside.
- [ ] Check spam. First mail from a new sending domain often lands there.

## 6. Deriver

- [ ] Fly app, secrets, deploy. The image runs a boot probe and refuses to
      start if it cannot decode HEIC, encode AVIF, find exiftool, or reach a
      scanner — a deriver that starts is one that can do the job.
- [ ] Schedule the jobs. `nudge`, `auto-hide` and `expire-rate-limits` have
      clocks attached: an unanswered removal request only hides after 48 hours
      if `auto-hide` is actually running.

## 7. Private soak

Everything stood up, nobody else invited, no scanning:
`CSAM_SCANNER=disabled` and `PAREA_ALLOW_UNSCANNED=private-deployment`. The
deriver prints a banner on every boot saying uploads are going out unchecked.

Anyone with a link can upload, so "private" means not sharing a link. There is
no auth wall doing it for you.

Work the post-deploy checklist in [`deploy.md`](deploy.md#after-the-first-deploy).
The two items in it that no test can cover:

- [ ] **iOS Safari, large upload, reload mid-batch.** Does it resume or ask for
      the files again? Both are handled; which happens is a device fact and it
      decides how good the web contribution path actually is.
- [ ] **The downloaded photo has no GPS.** `exiftool -GPSLatitude file`.

## 8. Before anyone else can reach it

- [ ] `fly secrets unset PAREA_ALLOW_UNSCANNED CSAM_SCANNER`, real provider set.
      The deriver refusing to start without one is the check.
- [ ] Everything in [`csam-runbook.md`](csam-runbook.md): credentials before the
      first detection, counsel briefed, a named human who receives alerts, and
      a synthetic alert proven to reach them.
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
- [ ] **`expo prebuild`, and run it.** No screen in this client has ever been
      rendered. Everything typechecks; nothing has been looked at. Budget a day
      for layout.
- [ ] `APPLE_TEAM_ID` and `ANDROID_CERT_FINGERPRINTS` on the web deployment
      **before any build goes out**. Both `.well-known` files 404 until they are
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
- [ ] **Nutrition labels**, and the one question in them that is not a
      programmer's to answer: precise location is currently not declared, on the
      reading that it is stripped at ingest and never stored — but the
      unstripped original does sit in R2 between upload and ingest. Declaring it
      makes the label say this app collects precise location, which
      misdescribes the product; not declaring it and being wrong is a rejection.
      `/privacy` discloses the window either way. The facts are in
      `apps/mobile/README.md`.

## Known limits, not blockers

Ingest polls every five seconds rather than using R2 notifications. One deriver
machine — two would race on the same pending rows. No bounce or complaint
handling on outbound mail.
