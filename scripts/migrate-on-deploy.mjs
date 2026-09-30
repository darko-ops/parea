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
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/* The repository root, which is where `db:migrate` can find the workspace.
   Vercel builds with `apps/web` as its root directory and checks out the whole
   repository around it — it has to, because the web app depends on
   `@parea/core`, and the migrations live in that package. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** How many pre-migration snapshot branches to keep. */
const KEEP_SNAPSHOTS = 3;

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

/*
 * From git, or not at all — security review M15.
 *
 * A deploy from a laptop builds whatever is in that working tree, including a
 * migration nobody has committed, and applies it to the production database. A
 * rollback in the dashboard then puts the old code back and leaves the new
 * schema, because nothing rolls a migration back. Vercel sets
 * `VERCEL_GIT_PROVIDER` only for a deploy made from a pushed commit, so its
 * absence is a CLI deploy and this stops before touching the database.
 * `ALLOW_CLI_MIGRATION=1` is the deliberate way past, for an emergency.
 */
if (!process.env.VERCEL_GIT_PROVIDER && process.env.ALLOW_CLI_MIGRATION !== '1') {
  console.error(
    'migrations: refusing — this production deploy did not come from git.\n' +
      '  Push the commit instead. In an emergency, set ALLOW_CLI_MIGRATION=1.',
  );
  process.exit(3);
}

const pending = await pendingMigrations();
if (pending === 0) {
  console.log('migrations: none pending.');
  await checkSnapshotAccess();
  process.exit(0);
}

await snapshotBeforeMigrating(pending);

console.log(`migrations: applying ${pending ?? 'any'} pending…`);
execFileSync('npm', ['run', 'db:migrate'], { cwd: ROOT, stdio: 'inherit' });

/**
 * How many migrations the repository has that the database has not applied.
 * Null when that cannot be told, which is treated as "some".
 */
async function pendingMigrations() {
  try {
    const journal = JSON.parse(
      readFileSync(join(ROOT, 'packages/core/drizzle/meta/_journal.json'), 'utf8'),
    );
    const { default: postgres } = await import('postgres');
    const sql = postgres(process.env.DATABASE_URL, { max: 1, connect_timeout: 10 });
    try {
      const [row] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
      return Math.max(0, journal.entries.length - row.n);
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch (err) {
    console.warn(`migrations: could not count pending (${err?.message ?? err}); assuming some.`);
    return null;
  }
}

/**
 * Whether the snapshot below would work, asked on a deploy that has nothing to
 * migrate.
 *
 * Otherwise a wrong key or project id is found out on the first deploy that
 * does have a migration — which is the deploy that then fails, because a
 * snapshot that cannot be taken stops it. One read-only call, logged either
 * way, never fatal here.
 */
async function checkSnapshotAccess() {
  const key = process.env.NEON_API_KEY;
  const project = process.env.NEON_PROJECT_ID;
  if (!key || !project) return;
  try {
    const res = await fetch(`https://console.neon.tech/api/v2/projects/${project}/branches`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (res.ok) {
      const { branches = [] } = await res.json();
      console.log(`migrations: snapshot access ok (${branches.length} branches in the project).`);
    } else {
      console.warn(
        `migrations: WARNING — Neon refused the snapshot check (${res.status}). ` +
          'The next deploy with a migration will fail until NEON_API_KEY and NEON_PROJECT_ID match.',
      );
    }
  } catch (err) {
    console.warn(`migrations: could not reach Neon to check snapshot access (${err?.message ?? err}).`);
  }
}

/**
 * A Neon branch of production, taken just before a migration — M15.
 *
 * A branch is a copy-on-write snapshot: free to take, and restorable by
 * pointing `DATABASE_URL` at it or by Neon's "restore from branch". Only when
 * something is about to change, so a deploy with nothing to migrate makes
 * nothing. Needs `NEON_API_KEY` and `NEON_PROJECT_ID`; without them it says
 * so and carries on, because Neon's own point-in-time restore still covers
 * the window. With them, a failed snapshot stops the deploy: the whole point
 * is not migrating without one. Keeps the newest few and deletes older ones,
 * since a plan has a branch limit.
 */
async function snapshotBeforeMigrating(pending) {
  const key = process.env.NEON_API_KEY;
  const project = process.env.NEON_PROJECT_ID;
  if (!key || !project) {
    console.warn(
      'migrations: no NEON_API_KEY/NEON_PROJECT_ID, so no snapshot branch before migrating. ' +
        "Neon's point-in-time restore is the fallback — see docs/backup-restore.md.",
    );
    return;
  }
  const api = `https://console.neon.tech/api/v2/projects/${project}/branches`;
  const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown').slice(0, 7);
  const name = `pre-migrate-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}-${sha}`;

  const made = await fetch(api, {
    method: 'POST',
    headers,
    body: JSON.stringify({ branch: { name } }),
  });
  if (!made.ok) {
    console.error(`migrations: snapshot branch failed (${made.status}); not migrating without one.`);
    process.exit(4);
  }
  console.log(`migrations: snapshot branch ${name} taken before ${pending ?? 'pending'} migration(s).`);

  try {
    const listed = await fetch(api, { headers });
    const { branches = [] } = await listed.json();
    const old = branches
      .filter((b) => typeof b.name === 'string' && b.name.startsWith('pre-migrate-'))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(KEEP_SNAPSHOTS);
    for (const branch of old) {
      await fetch(`${api}/${branch.id}`, { method: 'DELETE', headers });
      console.log(`migrations: removed old snapshot ${branch.name}`);
    }
  } catch (err) {
    console.warn(`migrations: could not prune old snapshots (${err?.message ?? err}).`);
  }
}
