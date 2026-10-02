# Retention: what is kept, how long, and what enforces it

The privacy policy (`apps/web/app/privacy/page.tsx`, "How long things are
kept") is the promise. This is the same list with the code that keeps each
promise, so a change to one is checked against the other. If you change a
number here, change the policy in the same commit.

| Data | Kept | Enforced by |
|---|---|---|
| Deleted photos (the files) | 30 days after deletion, then destroyed | `purge` in `services/deriver/src/jobs.ts` (`PURGE_GRACE_DAYS`) |
| Uploads that never finished | 24 hours | `jobs.ts` (`ABANDONED_AFTER_HOURS`) |
| Photos that failed processing | 7 days | `jobs.ts` (`FAILED_KEPT_DAYS`) |
| Moments | 24 hours shown, deleted about an hour later | `jobs.ts` moment expiry (`MOMENT_HOURS`, `MOMENT_GRACE_HOURS` in `@parea/core`) |
| Moment staging uploads | 1 day | R2 lifecycle rule `expire-moment-staging` |
| Download manifests | 1 day (links work 15 minutes) | R2 lifecycle rule `expire-manifests`; `TOKEN_TTL_SECONDS` in the download route |
| Sign-in codes | 10 minutes, single use | `accounts.ts`; swept by `jobs.ts` |
| Passkey challenges | 5 minutes, single use | `passkeys.ts`; swept by `jobs.ts` |
| Rate-limit counters | swept two hours after their window began, keyed by a hash, no address. Most windows are an hour; the two phone limits (per account and service-wide) are a day, and the sweep currently removes those early too | `ratelimit.ts`; `expire-rate-limits` in `jobs.ts` |
| Signed-out sessions | a week on the device list | `staleSessions` in `apps/web/src/sessions.ts`, swept by `jobs.ts` |
| Spoken album codes | released after 90 days unused | `jobs.ts` (`CODE_DORMANCY_DAYS`) |
| Usage facts (`observation`) | one year | `jobs.ts` |
| Daily, weekly and monthly activity counts (`activity_day`, `activity_week`, `activity_month`) | kept — totals only, nobody in them | `resolveSession` in `apps/web/src/sessions.ts` |
| The last day someone was counted active (`actor.counted_on`) | with the actor; one date, overwritten | `resolveSession` |
| App crash reports | Sentry's own retention; no user in them | `apps/mobile/src/crashReports.ts` |
| Accounts, profiles, messages, reactions | until deleted by the person, or account deletion | `deleteAccount` in `apps/web/src/accounts.ts` |
| Reports, moderation actions | kept | — (may be needed later, including by law) |
| Child-safety incidents | as the law requires (90 days preservation in the US, longer if asked) | `safety_incident`, see [csam-runbook.md](csam-runbook.md) |
| Database history | 1 day (Neon restore window) | Neon project settings → history retention — see [backup-restore.md](backup-restore.md) |
| Pre-migration snapshot branches | at most 7 days, newest 3 | `pruneSnapshots` in `scripts/migrate-on-deploy.mjs`, on every production deploy |
| Logs | Vercel, Fly and Sentry's own retention | the providers' plans |

A job that stops running stops enforcing everything in its column; the
heartbeat alert ([incident-response.md](incident-response.md)) exists for that.
