/**
 * Every variable this deployment knows about appears everywhere it should.
 *
 * Three lists describe the same set and none of them is generated from the
 * others: `env.ts`, which decides what `/api/health` reports; `.env.example`,
 * which is what someone copies; and the setup script's template, which is what
 * a real deployment actually gets. They have already drifted once — the two
 * deep-link variables were added with the `.well-known` routes and reached
 * neither of the other two, so a deployment made with the script would have
 * had working links and silently unverified ones on the app.
 *
 * This is the third list in this repository to rot this way. The other two
 * were the deriver's Dockerfile, which stopped copying packages the deriver
 * imported, and the purge job's derivative keys, which stopped covering AVIF.
 * Both failed silently and both were found by accident, so this one is
 * asserted.
 *
 * Optional variables matter *more* here, not less: a missing required one
 * fails the health check loudly, and a missing optional one is a feature that
 * quietly does not work.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { describeConfig } from '../src/env';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const known = describeConfig().map((c) => c.name);

/** Left-hand sides of assignments, ignoring comments. */
function assigned(text: string): Set<string> {
  return new Set(
    text
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .flatMap((line) => line.match(/^\s*([A-Z][A-Z0-9_]+)=/)?.[1] ?? []),
  );
}

describe('the three lists', () => {
  it('env.ts knows about a plausible number of variables', () => {
    // A guard on the guard: if `describeConfig` were ever emptied, every
    // assertion below would pass against nothing.
    expect(known.length).toBeGreaterThan(10);
  });

  it('.env.example offers every one of them', () => {
    const example = assigned(read('../.env.example'));
    expect([...known].filter((name) => !example.has(name))).toEqual([]);
  });

  it('the setup script writes every one of them', () => {
    // What a real deployment gets. A variable missing here is a feature that
    // silently does not work on a machine set up the documented way.
    const script = assigned(read('../../../scripts/setup-infra.sh'));
    expect([...known].filter((name) => !script.has(name))).toEqual([]);
  });

  it('the deploy doc names every one of them', () => {
    // The table in docs/deploy.md is what someone deploying by hand follows.
    const doc = read('../../../docs/deploy.md');
    expect(known.filter((name) => !doc.includes(`\`${name}\``))).toEqual([]);
  });
});

describe('what each one costs when absent', () => {
  it('is stated for every variable', () => {
    // `/api/health` reports names and consequences, never values. A blank
    // consequence makes the endpoint a list of words. Length is not the
    // property — DATABASE_URL's is "nothing works", which is thirteen
    // characters and the best line in the file.
    for (const item of describeConfig()) {
      expect(item.consequence.trim(), item.name).not.toBe('');
    }
  });

  it('never puts a value where a consequence should be', () => {
    // The endpoint is unauthenticated, so a consequence string is public.
    for (const item of describeConfig()) {
      expect(item.consequence, item.name).not.toMatch(/postgres:\/\/|https?:\/\/\S+\./);
    }
  });

  it('marks the ones that must not reach production without a value', () => {
    const required = describeConfig().filter((c) => c.requiredInProduction);
    // Storing photos on container disk, and being unable to sign anything,
    // are the two failures that must fail the deploy rather than the request.
    expect(required.map((c) => c.name)).toEqual(
      expect.arrayContaining(['SESSION_SECRET', 'DATABASE_URL', 'R2_BUCKET']),
    );
  });
});

/**
 * The lockfile has to describe the machine that builds, not the one that wrote it.
 *
 * `sharp` ships a prebuilt binary per platform as optional dependencies, and
 * npm records only the ones matching the host when it re-resolves a lockfile
 * from scratch. Regenerate on a Mac and every `@img/sharp-linux-*` entry
 * silently disappears; everything still installs, every test passes, and the
 * next deploy dies with "Could not load the sharp module using the linux-x64
 * runtime" — in the build, after the push, on a Friday.
 *
 * That is exactly what happened: a lockfile regenerated to dedupe React took
 * eight Linux entries out with it and broke three deploys before anyone looked.
 *
 * Asserted against the platform Vercel actually builds on rather than a list of
 * every platform, because that is the one whose absence is an outage. A
 * lockfile updated in place keeps these; only a from-scratch regeneration drops
 * them, and the fix is to restore the previous lockfile and let npm update it
 * incrementally instead.
 */
describe('the lockfile covers the platform that deploys', () => {
  const lock = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../package-lock.json', import.meta.url)), 'utf8'),
  ) as { packages: Record<string, { version?: string }> };

  it('carries the linux-x64 sharp binaries', () => {
    // `/api/account/avatar` loads sharp at runtime, so this is not a build
    // convenience — the route 500s without it.
    for (const name of ['@img/sharp-linux-x64', '@img/sharp-libvips-linux-x64']) {
      const found = Object.keys(lock.packages).filter((p) =>
        p.endsWith(`node_modules/${name}`),
      );
      expect(found.length, `${name} missing — regenerated on a non-Linux host?`).toBeGreaterThan(0);
    }
  });

  it('carries them for the web app specifically', () => {
    // The hoisted copy is the one `apps/web` resolves. A lockfile that only
    // had them nested under another workspace would pass the check above and
    // still fail the deploy.
    expect(lock.packages['node_modules/@img/sharp-linux-x64']).toBeTruthy();
  });
});

/**
 * The deploy applies migrations, and only in production.
 *
 * It did not, and the consequence was quiet in the way this file exists to
 * catch: the database behind this project was two migrations behind the
 * repository, one of which created the table the "keep a photograph"
 * shortlist writes to. Nothing had failed. Nobody had run the command.
 *
 * Pinned in three parts, because each one is a different way for it to stop
 * working — the hook Vercel actually calls, the guard that keeps a branch's
 * schema off a production database, and the refusal to ship a production
 * build that could not migrate.
 */
describe('the deploy runs the migrations', () => {
  const deployScript = read('../../../scripts/migrate-on-deploy.mjs');
  const web = JSON.parse(read('../package.json')) as {
    scripts: Record<string, string>;
  };

  it('hangs off `vercel-build`, which Vercel runs instead of the build command', () => {
    /*
     * Not `build`: CI builds the app too, against `postgres://ci/unused`, and
     * a build step that talks to a database is one that cannot run anywhere
     * without one. The project has no Build Command override, so the presence
     * of this script is what decides.
     */
    expect(web.scripts['vercel-build']).toBe(
      'node ../../scripts/migrate-on-deploy.mjs && next build',
    );
    expect(web.scripts['build']).toBe('next build');
  });

  it('does nothing outside production', () => {
    /*
     * A preview builds a branch, and a branch may carry a migration nobody
     * has merged — which would then be applied to whatever database the
     * preview is pointed at. Previews share production's environment unless
     * every variable has been scoped by hand, which is a thing to get right
     * rather than to assume.
     */
    expect(deployScript).toMatch(/const where = process\.env\.VERCEL_ENV;/);
    expect(deployScript).toMatch(/if \(where !== 'production'\) \{[\s\S]{0,300}process\.exit\(0\);/);
  });

  it('fails the build rather than shipping against a schema it could not apply', () => {
    // A green deploy that quietly skipped the step is how the situation this
    // was written for happened in the first place.
    expect(deployScript).toMatch(/if \(!process\.env\.DATABASE_URL\) \{[\s\S]{0,200}process\.exit\(2\);/);
    // `execFileSync` throws on a non-zero exit, which is what stops the build.
    expect(deployScript).toMatch(/execFileSync\('npm', \['run', 'db:migrate'\]/);
  });
});
