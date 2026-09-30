# How production changes

The rules for shipping, which [deploy.md](deploy.md) (how to set a deployment
up) assumes. Security review M15.

## Git is the only way in

- Production is whatever is on the default branch. A push there deploys the
  web app on Vercel, and that deploy applies pending database migrations.
- **Never `vercel deploy --prod` from a laptop.** It builds the working tree,
  uncommitted files included. The migration step now refuses a deploy that did
  not come from git (`VERCEL_GIT_PROVIDER` unset), so such a deploy fails at
  build rather than migrating; `ALLOW_CLI_MIGRATION=1` exists for a real
  emergency and nothing else.
- The Workers (`wrangler deploy`) and Fly apps (`flyctl deploy`) deploy from a
  checkout of a pushed commit. The hourly jobs machine is updated by image, not
  by `fly deploy` — the steps are at the top of
  `services/deriver/fly.jobs.toml`.

## Before pushing

- Typecheck and tests pass for what changed (`npm run typecheck`, the
  workspace's `npx vitest run`). CI runs them again on push.
- Anything that talks to a Worker or the deriver: deploy that side first if the
  web change depends on it, or make the web change tolerate both.

## Migrations

- **Backward compatible, always.** The old code keeps running while the new
  deploy builds, and a rollback in Vercel restores old code without undoing the
  migration. So a migration must work with the code before it: add columns
  nullable or with defaults, add tables freely; never rename or drop in the same
  change that stops using something. Drop it in a later deploy, once nothing
  reads it.
- Generate with `npx drizzle-kit generate --name <what>` in `packages/core`,
  read the SQL, commit it with the code that uses it.
- With `NEON_API_KEY` and `NEON_PROJECT_ID` set, a deploy with migrations takes
  a Neon branch first ([backup-restore.md](backup-restore.md)).

## After

- Watch the deploy finish (`vercel ls --prod` from the repository root).
- Check what changed, live: the page or route itself, `GET /api/health` (and the
  deep check with `HEALTH_TOKEN`), and for the deriver `flyctl logs`.
- Mobile JavaScript changes reach phones through an update or a build, not a
  push; say which when it matters.

## Rolling back

- Web: promote the previous deployment in Vercel (Deployments → ⋯ → Promote),
  then revert the commit so git matches. The database stays as the newer
  migration left it, which is why migrations are backward compatible.
- Workers: `wrangler rollback`. Fly: `flyctl deploy --image` with the previous
  image, or for the jobs machine `flyctl machine update --image`.

## Dependencies

Dependabot opens a grouped pull request of minor and patch updates each week
and security fixes as advisories land (`.github/dependabot.yml`). Read the
changelog for anything beyond a patch, let CI finish, then merge — merging
deploys. The deriver's base image is refreshed monthly for Debian's security
fixes.
