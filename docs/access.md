# Who can reach production, and how to take it away

Every account that can read people's data or change what runs, what each
secret unlocks, and how to rotate it. Kept short so it stays true; check it
whenever somebody joins, leaves, or a service is added.

## People

One person — the founder — holds every account below. There is no shared
login. When somebody else needs access, add them as their own member of the
service (never share a password or a token), note it here with the date, and
remove them the day they stop needing it.

## Accounts

Every one of these must have two-factor authentication on, preferably a
passkey or hardware key rather than SMS.

| Service | What it holds | Reach |
|---|---|---|
| GitHub `darko-ops/parea` | the code; pushing to the default branch deploys production | admin |
| Vercel `parea-web` | the web app, its environment variables, logs, firewall | owner |
| Neon | the database: every account, message and photo record | owner |
| Cloudflare | R2 (every photo), the image and zip Workers, DNS | owner |
| Fly `parea-deriver`, `parea-jobs` | the image processor and hourly jobs, and their copies of the database and R2 keys | owner |
| Upstash | QStash, which delivers upload jobs | owner |
| Mail provider | sends sign-in codes as parea.photos | owner |
| Twilio | sends phone verification codes | owner |
| Sentry | errors, which can contain request details | owner |
| Apple Developer, App Store Connect | app signing, TestFlight, the listing | account holder |
| Google Play Console | the Android listing and signing | owner |
| Expo (EAS) | builds, and the stored signing credentials | owner |

## Secrets, and rotating them

Never print one, paste one into a chat, or commit one. Vercel variables marked
sensitive cannot be read back — to see a value, rotate it.

| Secret | Lives in | Unlocks | Rotating it |
|---|---|---|---|
| `SESSION_SECRET` | Vercel | forging anybody's sign-in | new value in Vercel, redeploy; signs everyone out |
| `DATABASE_URL` | Vercel, Fly deriver, Fly jobs | the whole database | reset the role's password in Neon, then update all three (`flyctl secrets set` on both apps; the jobs machine then needs `flyctl machine update`) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Vercel, Fly deriver, Fly jobs | every photo | make a new R2 API token, update all three, then delete the old token |
| `IMAGE_SECRET` | Vercel, image Worker | minting image URLs | set both (`wrangler secret put IMAGE_SECRET` in `services/image-worker`) together; open pages reload their images |
| `MANIFEST_SECRET` | Vercel, zip Worker | minting download links | set both together (`services/zip-worker`) |
| `PHONE_PEPPER` | Vercel | matching phone hashes | rotating invalidates every stored number; everyone re-verifies |
| `QSTASH_TOKEN`, signing keys | Vercel, Fly deriver | queueing and accepting upload jobs | roll in the Upstash console; set the new keys on both |
| `CRON_SECRET`, `HEALTH_TOKEN` | Vercel | calling the cron and deep health routes | new value in Vercel |
| `MAIL_API_KEY`, `SMS_API_KEY` | Vercel, Fly deriver (mail) | sending as Parea | new key at the provider, update, revoke the old |
| `NEON_API_KEY` | Vercel (build) | taking branches before migrations | new key in Neon |
| App signing keys | EAS, Apple, Google | shipping an app update as Parea | see the store's key-reset process; Apple certificate reissue is on the launch list |

After a suspected leak rotate first and investigate second — see
[incident-response.md](incident-response.md).

## Reviews

Every three months: remove anybody who no longer needs access, check 2FA is on
everywhere, and delete API tokens nobody recognises.
