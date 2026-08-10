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

**Before any of this**, work through the launch checklist in
[`csam-runbook.md`](csam-runbook.md). Ingest fails closed without a scanning
provider, so a deploy without one comes up and quietly accepts uploads that
never become visible. That is safe, and it is also broken.

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

Two rules to set on the bucket, both easy to skip and annoying later:

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
HEIC, cannot find exiftool, or has no scanner configured. A deriver that starts
is one that can actually do the job.

Jobs run on a schedule from the same image:

```
fly deploy -c fly.jobs.toml
fly machine run --schedule daily <image> -a parea-jobs -- npx tsx services/deriver/src/jobs.ts
```

`auto-hide` is the one with a clock attached — an unanswered removal request
hides the photo after 48 hours only if this runs. Run `seed-codes` once by hand
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
| `CSAM_SCANNER_URL` | | ● | ingest stalls without it |
| `CSAM_SCANNER_KEY` | | ● | |
| `SAFETY_ALERT_WEBHOOK` | | ● | a quarantine nobody sees is no scanning |

## After the first deploy

- [ ] `/api/health` returns 200.
- [ ] Create an event, add a photo from a phone, watch it reach `ready`.
      If it stays `pending`, the deriver is not running or has no scanner.
- [ ] The grid shows a thumbnail — proves `IMAGE_SECRET` matches.
- [ ] Download the event — proves `MANIFEST_SECRET` matches, and that R2
      egress is going where you think.
- [ ] Check the photo you downloaded has no GPS: `exiftool -GPSLatitude file`.
- [ ] Fire a synthetic safety alert and confirm a human receives it.

## Known gaps

**Ingest polls.** The design has R2 event notifications driving a Cloudflare
Queue. Polling every five seconds needs no extra infrastructure and is a
change to one file when it stops being enough.

**One deriver machine.** Two would race on the same pending rows. Scaling out
needs claim-based work distribution first.

**No push notifications.** Device tokens are captured; delivery is unwired, so
group members see a new event when they open the app rather than being told.

**Nothing here has been run.** These are the correct commands as far as the
code is concerned, but no part of this deployment has been executed against a
real account.
