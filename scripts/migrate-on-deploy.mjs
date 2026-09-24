#!/usr/bin/env node
/**
 * Apply pending migrations, once, as part of a production deploy.
 *
 *   npm run vercel-build --workspace @parea/web
 *
 * Reached through `vercel-build` in the web app's `package.json`, which Vercel
 * runs in place of the framework's own build command. It is not in `build`
 * itself on purpose: CI builds the app too, against `postgres://ci/unused`,
 * and a build step that talks to a database is a build that cannot run
 * anywhere without one.
 *
 * ## Why this exists
 *
 * Because it did not. The database this deploys against was five days and two
 * migrations behind the repository — `photo_favourite` among them, so the
 * "keep a photograph" shortlist was shipped code writing to a table that was
 * not there. Nothing had gone wrong; nobody had run the command. A step that
 * has to be remembered is a step that eventually is not, and the failure is
 * silent until somebody presses the star.
 *
 * `migrate.ts` is idempotent — drizzle records what it has applied — so this
 * is safe on every deploy, including a redeploy of a commit whose migrations
 * are already in.
 *
 * ## Production only
 *
 * A preview deployment builds a branch, and a branch may carry a migration
 * nobody has merged. Running it would apply that branch's schema to whatever
 * database the preview is pointed at — and previews share production's
 * environment unless somebody has scoped every variable by environment, which
 * is a thing to get right rather than a thing to assume. So this asks
 * `VERCEL_ENV` and does nothing anywhere else.
 *
 * ## Failing is the point
 *
 * A production build with no `DATABASE_URL`, or one whose migration fails,
 * stops here rather than shipping. Code deployed against a schema that did not
 * apply is the exact state this exists to prevent, and a green deploy that
 * quietly skipped the step is how the situation above happened in the first
 * place.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* The repository root, which is where `db:migrate` can find the workspace.
   Vercel builds with `apps/web` as its root directory and checks out the whole
   repository around it — it has to, because the web app depends on
   `@parea/core`, and the migrations live in that package. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const where = process.env.VERCEL_ENV;

if (where !== 'production') {
  // Including a local `npm run vercel-build`, which is how somebody checks
  // that this file does not break the build.
  console.log(`migrations: skipped (VERCEL_ENV=${where ?? 'unset'}, not production)`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('migrations: DATABASE_URL is not set on a production build.');
  process.exit(2);
}

console.log('migrations: applying any that are pending…');
execFileSync('npm', ['run', 'db:migrate'], { cwd: ROOT, stdio: 'inherit' });
