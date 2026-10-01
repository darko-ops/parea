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

Running it on a laptop instead — where it kept dying with the terminal session
that started it — is [Keeping the deriver up on a development
machine](deriver-local.md).

The native client is built and submitted separately — see
[`apps/mobile/README.md`](../apps/mobile/README.md). The web app serves the two
`.well-known` files its deep links depend on, but they 404 until
`APPLE_TEAM_ID` and `ANDROID_CERT_FINGERPRINTS` are set, and until then every
tapped link opens a browser on a phone that has the app installed.

Those same two files are what let the app use passkeys, which is worth knowing
because the failure is silent in a different way: the AASA names this app under
`webcredentials` and the app declares `webcredentials:parea.photos`, and iOS
needs both before it will let the app assert for this domain. Android verifies
the signing fingerprint from `assetlinks.json`, and the server derives the
`android:apk-key-hash:` origin it will accept from the same
`ANDROID_CERT_FINGERPRINTS` value. So an app whose links verify is an app whose
passkeys work — and an app whose links do not is one where the Face ID prompt
never appears, with nothing logged to say why.

## Two kinds of deployment

**Without hash matching** — everything stood up, no child-safety provider
configured. This is how Parea runs until a provider approves it. Photos are
published without being matched against known material; the privacy page and
the terms say so, because they read the same `CSAM_SCANNER_*` settings the
scanner does (`hashMatchingLive` in `apps/web/src/legal.ts`). What still runs:
a report of child abuse quarantines the photo at once and alerts the
responder, and `PAREA_MODERATION` must be declared — the watcher refuses to
start without it.

`CSAM_SCANNER=disabled` and `PAREA_ALLOW_UNSCANNED` no longer exist. They are
described in the runbook's history; nothing reads them.

**With hash matching** — work through [`csam-runbook.md`](csam-runbook.md): a
provider onboarded, credentials before the first detection, counsel briefed, a
named human on alerts. Set `CSAM_SCANNER_URL` and `CSAM_SCANNER_KEY` on **both**
the deriver (roll photos) and Vercel (moments, group pictures, profile
pictures and covers). From then on an unreachable provider stalls or refuses
the upload rather than letting it through.

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
# Create a Neon project, then — the URL Neon gives you, ellipsis and all
# replaced. Keep the `?sslmode=require` it comes with.
export DATABASE_URL='postgres://PASTE_NEON_URL_HERE'
npm run db:migrate
```

Idempotent, and this is the first-time version. After that a production deploy
runs it for you: `vercel-build` in `apps/web/package.json` calls
`scripts/migrate-on-deploy.mjs` before `next build`, which applies anything
pending and fails the build if it cannot.

It is worth knowing why that exists. This database was once two migrations
behind the repository — one of them the table the "keep a photograph" shortlist
writes to — because running the command was a step somebody had to remember,
and the failure is silent until a person presses the star.

Deploy-time, not boot-time, and still not: two app instances starting at once
would race, and a half-applied schema is worse than a failed deploy. A build
runs once.

Production only. A preview builds a branch, and a branch may carry a migration
nobody has merged — which would then land on whatever database the preview is
pointed at. The script asks `VERCEL_ENV` and does nothing anywhere else, so a
schema change still reaches a preview environment by being run there by hand.

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
curl -s -H "authorization: Bearer $HEALTH_TOKEN" https://<app>/api/health | jq
```

With the token (`HEALTH_TOKEN`, readable in the Vercel dashboard) it checks the database and answers 503 while anything required is missing, and names what. Without it, it only says the site is up — deliberately, so a monitor cannot keep the database awake and a stranger cannot read the configuration. A load
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

### Texts, for confirming a phone number

A second transport, and optional in the same way the mailer is: the product is
complete without it, and what it gates is friend discovery. While `SMS_API_KEY`
and `SMS_FROM` are unset, the Find Friends page can be opened and cannot get
past asking for a number — in production the texter refuses rather than
pretending a code went out, and `/api/health` names what is missing.

1. **Get a number that can send to your users' countries.** A2P registration is
   the part that takes days rather than minutes: Twilio requires a registered
   campaign to send to US numbers at all, and an unregistered sender is silently
   filtered rather than rejected, which looks exactly like a code that never
   arrives.

   The campaign's **sample message** has to be what `verifyText` emits, with the
   code in square brackets and nothing else changed — carriers compare submitted
   samples against real traffic, and a paraphrase is a mismatch. There is one
   message type, so a second sample is the same template with a different code
   rather than an invented one: fiction there fails in the other direction.

   Its wording is also load-bearing in a way that is invisible from the console.
   Every character is GSM-7, because one character outside it forces the whole
   message into UCS-2 where a segment is 70 characters rather than 160 — an em
   dash once turned a one-segment message into three, at triple the price of
   every verification. `sms.test.ts` asserts the alphabet and the septet count;
   do not "improve" the punctuation without reading it.
2. **Set `SMS_PROVIDER`, `SMS_API_KEY`, `SMS_FROM`** and, for Twilio,
   `SMS_API_URL` — its path carries the account SID, so there is no endpoint to
   guess:
   `https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json`.
   `SMS_API_KEY` is one value: `<sid>:<token>` for Twilio, `<key>:<secret>` for
   Vonage, the access key alone for MessageBird.
3. **Leave `PHONE_PEPPER` unset unless there is somewhere safe to keep it.** It
   falls back to `SESSION_SECRET`, and rotating either invalidates every stored
   number — everybody has to enter and confirm theirs again. A dedicated pepper
   buys the ability to rotate the session secret without that; it costs one more
   secret to lose. If you are going to set it, set it *before* anybody confirms a
   number: while none are stored there is nothing to invalidate.
4. **Send one:**

   ```
   npm run sms:test -- +447700900123
   ```

   It goes through the same `texterFromEnv` the app uses, so a carrier typo, a
   bad credential or the missing `SMS_API_URL` fails here rather than in
   production. The message says plainly that it is a test and carries no
   six-digit run, so it cannot be mistaken for a real code on a lock screen.

   "Accepted" is not "delivered", and that gap is wider here than for mail: an
   unregistered A2P sender to a US number is **filtered rather than rejected**,
   so the API answers 201 and the text never arrives. If the script succeeds and
   nothing turns up, the campaign is the place to look — nothing in this
   repository can see that from the outside.

The number itself is never stored, here or anywhere: it is hashed on arrival
with that key and the digits are discarded. A carrier's error message quotes the
recipient back, so the log lines redact it — see `redactNumber`.

**Registering the campaign is its own errand**, and it is where the time goes:
`docs/sms-a2p.md` holds the state of this deployment's Twilio account, every
answer the campaign form needs, what earlier submissions were refused for, and
the two things in the code that are easy to break without noticing.

## 5. Deriver and jobs

**Deploy from the repository root, not from `services/deriver`.** The Dockerfile
copies the root `package-lock.json` and all of `packages/`, so the build context
has to be the root — and `flyctl deploy [WORKING_DIRECTORY]` takes the context
from the directory it is given. This page said `cd services/deriver && fly
deploy` for a long time and that cannot work: there is no lockfile and no
`packages/` beneath that path to copy. `.dockerignore` at the root is what keeps
the context to 161MB instead of 4.6GB.

```
flyctl secrets set \
  DATABASE_URL=PASTE_HERE \
  R2_ACCOUNT_ID=PASTE_HERE \
  R2_ACCESS_KEY_ID=PASTE_HERE \
  R2_SECRET_ACCESS_KEY=PASTE_HERE \
  R2_BUCKET=parea \
  SAFETY_ALERT_EMAIL=PASTE_HERE \
  -a parea-deriver

flyctl deploy . --config services/deriver/fly.toml \
  --dockerfile services/deriver/Dockerfile
```

> The placeholders say `PASTE_HERE` rather than `…` on purpose. An earlier
> version of this page used the ellipsis, somebody ran the line as written, and
> Fly cheerfully set both R2 secrets to a three-byte `…`. Every layer reported
> success — `flyctl` said the update succeeded and the health check went green,
> because it is liveness-only — and ingest was down until a photograph failed to
> appear. A placeholder that is valid shell is a placeholder that will one day be
> deployed.

For anything you want to check before it serves traffic, build and release as
two steps. This is worth the extra command whenever credentials or the base
image have changed:

```
flyctl deploy . --config services/deriver/fly.toml \
  --dockerfile services/deriver/Dockerfile \
  --build-only --push --image-label SOME_LABEL

# try it on a throwaway machine first — it gets the app's real secrets
flyctl machine run registry.fly.io/parea-deriver:SOME_LABEL -a parea-deriver \
  --region iad --memory 2048 --restart no --env NODE_ENV=production \
  --entrypoint /bin/sh -- -c 'cd /app && node_modules/.bin/tsx services/deriver/src/index.ts probe'
flyctl logs -a parea-deriver --machine MACHINE_ID --no-tail
flyctl machine destroy MACHINE_ID -a parea-deriver --force

flyctl deploy . --config services/deriver/fly.toml \
  --image registry.fly.io/parea-deriver:SOME_LABEL
```

Note that a machine's `--env` does **not** override a Fly secret of the same
name, so a throwaway cannot be used to test what happens with deliberately bad
credentials.

### What the boot probe refuses to start for

`serve` runs the probe before it binds the port, so a container that cannot do
the job never accepts a delivery. It is fatal when the container cannot decode
HEIC, cannot encode AVIF, cannot find exiftool, has no declared moderation
posture, or — in production — has nowhere to send a quarantine alert or
**cannot reach R2**.

An absent CSAM scanner is *not* fatal. That changed when `PAREA_MODERATION`
arrived: running without hash matching is a posture a deployment may take, and
what it may not do is fail to state one. See `docs/csam-runbook.md`.

The storage check is a HEAD for a key that does not exist — 404 means the
credentials work, 401 means they do not. It is the newest line and it exists
because everything else in the probe verified that the container could process
a photograph and nothing verified it could reach one.

Jobs run hourly from the same image, as one scheduled machine. Created once:

```
flyctl deploy . --config services/deriver/fly.jobs.toml \
  --dockerfile services/deriver/Dockerfile --build-only --push --image-label first
flyctl machine run registry.fly.io/parea-jobs:first --schedule hourly -a parea-jobs \
  --restart no -- node_modules/.bin/tsx services/deriver/src/jobs.ts
```

After that, never `fly deploy` it — update the machine's image instead, as the
top of `services/deriver/fly.jobs.toml` describes.

Running it with no argument also prints the §18 metrics — the concept's own
test, *does anyone other than the creator upload?*, plus what a bad number
means. `deriver metrics` on its own for just the report; it writes nothing.

`nudge`, `auto-hide` and `expire-rate-limits` are the ones with clocks
attached — an unanswered removal request hides the photo after 48 hours only if
this runs. Run `seed-codes` once by hand
after the first deploy, or the spoken-code door never opens:

```
fly ssh console -a parea-deriver -C "node_modules/.bin/tsx services/deriver/src/jobs.ts seed-codes"
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
| `SMS_PROVIDER` | ● | | `twilio`, `messagebird` or `vonage`; default `twilio` |
| `SMS_API_KEY` | ● | | confirming a phone number. One value: `<sid>:<token>` for Twilio, `<key>:<secret>` for Vonage, the access key alone for MessageBird |
| `SMS_FROM` | ● | | the number or sender ID texts come from |
| `SMS_API_URL` | ● | | required for `twilio`, whose path carries the account SID |
| `SMS_COUNTRIES` | ● | | ISO codes texts may go to, comma-separated; default `US,CA,GB`. Caribbean +1 numbers are refused even with `US`. Keep in step with Twilio Geo Permissions |
| `PHONE_PEPPER` | ● | | the key numbers are hashed with. Falls back to `SESSION_SECRET`; rotating either makes everybody confirm their number again |
| `QSTASH_TOKEN` | ● | | without it an upload is refused rather than never derived |
| `QSTASH_URL` | | ● | only when the QStash account is outside the default region |
| `DERIVER_JOB_URL` | ● | | where deliveries go; signed into each one, so it must match the deriver's `DERIVER_PUBLIC_URL` |
| `ADMIN_API_TOKEN` | ● | | the admin hub's key to `/api/admin`; at least 32 characters. Unset means every admin route is a 404 |
| `ADMIN_STAFF` | ● | | emails allowed to act through the hub, comma-separated. A token without a name on this list is refused |
| `APPLE_TEAM_ID` | ● | | without it iOS Universal Links never verify |
| `ANDROID_CERT_FINGERPRINTS` | ● | | comma-separated; upload key *and* Play signing key. Also what Android passkeys are verified against |
| `PASSKEY_RP_ID` | ● | | leave unset; derived from the request host. Only for a domain the code does not know — and a passkey is bound to its RP ID for life |
| `CSAM_SCANNER_URL` | ● | ● | the hash-matching provider. Unset means no matching, and the privacy page says so. Needed on both: the deriver scans roll photos, the web app scans everything else |
| `CSAM_SCANNER_KEY` | ● | ● | |
| `CSAM_SCANNER_NAME` | ● | ● | recorded on incidents |
| `CSAM_SCANNER_SEND_BYTES` | ● | ● | defaults to sending the image; `false` only for a provider that takes perceptual hashes |
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

- [ ] Set a real hash-matching provider (`CSAM_SCANNER_URL`, `CSAM_SCANNER_KEY`)
      on the deriver *and* on Vercel, then check the privacy page says
      matching is running.
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
