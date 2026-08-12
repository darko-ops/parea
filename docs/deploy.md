# Deploying

Five pieces, and they have to agree with each other on three shared secrets.
Most first-deploy failures are a secret that matches in two places out of three
— see [Secrets](#secrets), and check `/api/health` when you are done.

| Piece | Where | Why there |
|---|---|---|
| Web app + API | Vercel | HTML and JSON only; never photo bytes |
| Database | Neon | serverless Postgres, no pooler to run |
| Objects | Cloudflare R2 | zero egress, which is what makes bulk download affordable |
| `parea-img`, `parea-zip` | Cloudflare Workers | R2 reads are free from inside Cloudflare |
| Deriver + jobs | Fly.io | needs libvips and libheif; will not run in a Worker |

The native client is built and submitted separately — see
[`apps/mobile/README.md`](../apps/mobile/README.md). The web app serves the two
`.well-known` files its deep links depend on, but they 404 until
`APPLE_TEAM_ID` and `ANDROID_CERT_FINGERPRINTS` are set, and until then every
tapped link opens a browser on a phone that has the app installed.

## Two kinds of deployment

**Private soak** — everything stood up, only you can reach it, no scanning.
Worth doing first: infrastructure fails in ways tests cannot predict, and it is
better to find that out before anyone else is involved. Set
`CSAM_SCANNER=disabled` and `PAREA_ALLOW_UNSCANNED=private-deployment` on the
deriver; it starts, and prints a banner on every boot saying uploads are going
out unchecked.

The flag is named rather than quiet so it shows up in `fly secrets list`, in
`grep`, and in the logs. The rule attached to it is simple: **the moment anyone
but you can reach the deployment, it has to go.** Anyone with a link can
upload, so "nobody else can reach it" means not sharing a link — there is no
auth wall doing that for you.

**Launch** — work through [`csam-runbook.md`](csam-runbook.md) first: a
provider onboarded, credentials before the first detection, counsel briefed, a
named human on alerts. Without a scanner and without the flag, ingest fails
closed: uploads stall at `pending` and are never served. Safe, and broken.

## The short way

`./scripts/setup-infra.sh` does steps 1 and 2 with your own Cloudflare and Neon
logins: creates the project and bucket, sets the lifecycle rule, generates all
three secrets together so they cannot disagree, writes `apps/web/.env.local`,
applies migrations and seeds the code pool. It is idempotent and deletes
nothing.

It stops at the two things that are dashboard-only — the R2 S3-API token and
choosing a scanning provider — and prints the exact Worker commands using the
secrets it just made.

The rest of this page is what the script does, in case you would rather do it
by hand or something goes wrong halfway.

## 1. Database

```
# Create a Neon project, then:
export DATABASE_URL='postgres://…'
npm run db:migrate
```

Idempotent, and it must be run on every deploy that includes a schema change.
Nothing migrates on application boot on purpose: two app instances starting at
once would race, and a half-applied schema is worse than a failed deploy.

## 2. R2

```
wrangler r2 bucket create parea
```

Three rules to set on the bucket. The first one is not optional and the other
two are easy to skip and annoying later:

- **CORS, or no photo is ever uploaded.** The browser PUTs straight to R2 with
  a presigned URL, and without a policy naming the app's origin it refuses the
  request before it is sent. Nothing about this failure points at CORS: the
  presign succeeds, a `pending` row appears with a key, the bytes never arrive,
  and the deriver reports `object_missing` — which reads like storage lost the
  object rather than like the upload never happened. Every upload on the first
  real deployment failed this way.

  ```
  wrangler r2 bucket cors set parea --file r2-cors.json --force
  ```

  ```json
  {
    "rules": [{
      "allowed": {
        "origins": ["https://parea.photos", "https://www.parea.photos"],
        "methods": ["PUT", "GET", "HEAD"],
        "headers": ["content-type"]
      },
      "exposeHeaders": ["ETag"],
      "maxAgeSeconds": 3600
    }]
  }
  ```

  `content-type` is there because the presign signs it, so the browser sends it
  and a policy that does not allow it fails the preflight. Add
  `https://*.vercel.app` while deployments are being tested from preview URLs,
  and `http://localhost:3000` for local work against real R2.

- **Lifecycle on `tmp/manifest/`, expire after 1 day.** Download manifests are
  written there and referenced by a 15-minute token. Without this they
  accumulate forever.
- **No public access.** Everything is served through the Workers, which check a
  signature. A public bucket makes every one of those checks decorative.

## 3. Workers

```
cd services/image-worker && wrangler secret put IMAGE_SECRET && wrangler deploy
cd services/zip-worker   && wrangler secret put MANIFEST_SECRET && wrangler deploy
```

Set `bucket_name` in each `wrangler.toml` if the bucket is not called `parea`.
Note the deployed URLs — the app needs them as `IMAGE_BASE_URL` and
`ZIP_BASE_URL`.

## 4. Web app

Deploy `apps/web` to Vercel with the environment below. The build fails without
`SESSION_SECRET` and `DATABASE_URL`, which is intentional.

Then check it:

```
curl -s https://<app>/api/health | jq
```

It answers 503 while anything required is missing, and names what. A load
balancer can use it; it reports names and booleans, never values.

## 4b. Mail

Only needed for accounts, which are optional — everything else works without
it. But the sign-in endpoint answers 204 however it went, on purpose, so that
it cannot be used to ask whether an address has an account. The cost of that is
that a broken mailer is completely silent: the page says a code is on its way,
and nothing ever arrives.

So set it up deliberately and then check it.

1. **Pick a provider and verify a domain.** Any of `resend`, `postmark`,
   `sendgrid`, `mailgun`. Verify `parea.photos` rather than a single address —
   a shared-domain sender puts sign-in codes behind someone else's reputation.
2. **Publish the DNS the provider asks for.** SPF and DKIM at minimum, and a
   DMARC record, which several large mailbox providers now effectively expect:

   ```
   _dmarc.parea.photos.  TXT  "v=DMARC1; p=none; rua=mailto:dmarc@parea.photos"
   ```

   `p=none` to begin with — it reports without rejecting, so a missed DKIM
   record shows up as a report instead of as silence.
3. **Set `MAIL_PROVIDER`, `MAIL_API_KEY` and `MAIL_FROM`.** `MAIL_FROM` has to
   be at the verified domain; most providers answer 422 otherwise. Mailgun also
   needs `MAIL_API_URL`, because its path carries the sending domain.
4. **Send one:**

   ```
   npm run mail:test -- you@example.com
   ```

   It goes through the same `mailerFromEnv` the app uses, so a provider typo or
   an unverified domain fails here rather than in production. "Accepted" is not
   "delivered" — open the inbox, and check spam, because the first message from
   a new domain often lands there.

A sign-in code is transactional mail. If the provider offers separate streams
(Postmark does), keep it off the broadcast one: shared with marketing, it gets
rate-shaped like marketing.

## 5. Deriver and jobs

```
cd services/deriver
fly launch --no-deploy --copy-config
fly secrets set DATABASE_URL=… R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… \
  R2_SECRET_ACCESS_KEY=… R2_BUCKET=parea \
  CSAM_SCANNER_URL=… CSAM_SCANNER_KEY=… SAFETY_ALERT_WEBHOOK=…
fly deploy
```

The image runs its boot probe and **refuses to start** if it cannot decode
HEIC, cannot encode AVIF, cannot find exiftool, or has no scanner configured.
A deriver that starts is one that can actually do the job.

Jobs run on a schedule from the same image:

```
fly deploy -c fly.jobs.toml
fly machine run --schedule daily <image> -a parea-jobs -- npx tsx services/deriver/src/jobs.ts
```

Running it with no argument also prints the §18 metrics — the concept's own
test, *does anyone other than the creator upload?*, plus what a bad number
means. `deriver metrics` on its own for just the report; it writes nothing.

`nudge`, `auto-hide` and `expire-rate-limits` are the ones with clocks
attached — an unanswered removal request hides the photo after 48 hours only if
this runs. Run `seed-codes` once by hand
after the first deploy, or the spoken-code door never opens:

```
fly ssh console -a parea-deriver -C "npx tsx services/deriver/src/jobs.ts seed-codes"
```

## Secrets

Three are shared across services, and a mismatch fails silently rather than
loudly. That is the single most likely thing to go wrong.

| Secret | Set on | Symptom if it disagrees |
|---|---|---|
| `SESSION_SECRET` | web | everyone is anonymous; nobody can delete their own uploads |
| `MANIFEST_SECRET` | web **and** zip Worker | every download 404s |
| `IMAGE_SECRET` | web **and** image Worker | every thumbnail 404s; the grid is empty |

`MANIFEST_SECRET` and `IMAGE_SECRET` fall back to `SESSION_SECRET` on the web
side when unset — convenient locally, and a trap in production, because the
Workers have no such fallback. Set all three explicitly.

Generate with `openssl rand -base64 32`.

## Full environment

| Variable | Web | Deriver | Notes |
|---|:-:|:-:|---|
| `DATABASE_URL` | ● | ● | |
| `SESSION_SECRET` | ● | | |
| `MANIFEST_SECRET` | ● | | also a zip Worker secret |
| `IMAGE_SECRET` | ● | | also an image Worker secret |
| `R2_ACCOUNT_ID` | ● | ● | production refuses to start without R2 |
| `R2_ACCESS_KEY_ID` | ● | ● | |
| `R2_SECRET_ACCESS_KEY` | ● | ● | |
| `R2_BUCKET` | ● | ● | |
| `ZIP_BASE_URL` | ● | | the deployed zip Worker |
| `IMAGE_BASE_URL` | ● | | the deployed image Worker |
| `SAFETY_CONTACT_EMAIL` | ● | | published on `/safety`; App Store 1.2 |
| `LEGAL_ENTITY` | ● | | named on `/terms` and `/privacy` |
| `LEGAL_JURISDICTION` | ● | | governing law on `/terms` |
| `MAIL_PROVIDER` | ● | | `resend`, `postmark`, `sendgrid` or `mailgun`; default `resend` |
| `MAIL_API_KEY` | ● | | sign-in codes; unset means accounts cannot be claimed |
| `MAIL_FROM` | ● | | must be at a domain verified with the provider |
| `MAIL_API_URL` | ● | | only to override the endpoint; required for `mailgun` |
| `APPLE_TEAM_ID` | ● | | without it iOS Universal Links never verify |
| `ANDROID_CERT_FINGERPRINTS` | ● | | comma-separated; upload key *and* Play signing key |
| `CSAM_SCANNER_URL` | | ● | ingest stalls without it |
| `CSAM_SCANNER_KEY` | | ● | |
| `CSAM_SCANNER` | | ● | `disabled`, private soak only |
| `PAREA_ALLOW_UNSCANNED` | | ● | `private-deployment`; remove before launch |
| `SAFETY_ALERT_WEBHOOK` | | ● | a quarantine nobody sees is no scanning |
| `EXPO_ACCESS_TOKEN` | ● | ● | optional; Expo accepts pushes without one |

## After the first deploy

- [ ] `/api/health` returns 200.
- [ ] Create an event, add a photo from a phone, watch it reach `ready`.
      If it stays `pending`, the deriver is not running or has no scanner.
- [ ] The grid shows a thumbnail — proves `IMAGE_SECRET` matches.
- [ ] `curl -s https://<app>/.well-known/apple-app-site-association | jq` names
      your Team ID. A 404 means tapped links will open Safari instead of the
      app, and Apple caches whatever it finds.
- [ ] `curl -sI https://<app>/event/<id> | grep -i x-robots-tag` returns
      `noindex`. Possession of the link is the access model, so a crawler that
      reaches one indexes someone's photos.
- [ ] In devtools, confirm the grid requested `.avif` and got `image/avif`;
      then load the same event somewhere without AVIF and confirm it falls back
      to `.jpg` rather than showing an empty grid.
- [ ] Download the event — proves `MANIFEST_SECRET` matches, and that R2
      egress is going where you think.
- [ ] Check the photo you downloaded has no GPS: `exiftool -GPSLatitude file`.
- [ ] On an iPhone, on Safari: start a large upload, reload mid-batch, and see
      whether it resumes or asks for the files again. Both are handled; which
      one happens is a device fact nothing in the test suite can establish
      (design §8), and it decides how good the web path actually is.
- [ ] `npm run mail:test -- you@example.com`, then sign in at `/account` and
      confirm the code arrives and works. Nothing else surfaces a broken
      mailer: the endpoint answers 204 either way by design.
- [ ] Fire a synthetic safety alert and confirm a human receives it.
      (Private soak: skip — and remember there is nothing there to receive it.)

## Before it stops being private

- [ ] `fly secrets unset PAREA_ALLOW_UNSCANNED CSAM_SCANNER`, and set a real
      provider. The deriver refuses to start without one, which is the check.
- [ ] Everything in [`csam-runbook.md`](csam-runbook.md).

## Known gaps

**Ingest polls.** The design has R2 event notifications driving a Cloudflare
Queue. Polling every five seconds needs no extra infrastructure and is a
change to one file when it stops being enough.

**One deriver machine.** Two would race on the same pending rows. Scaling out
needs claim-based work distribution first.

**Nothing here has been run.** These are the correct commands as far as the
code is concerned, but no part of this deployment has been executed against a
real account.
