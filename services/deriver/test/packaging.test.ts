/**
 * What the image has to contain before it starts, and what it must not fetch.
 *
 * The deriver ran for months downloading its own runtime. `tsx` was a
 * devDependency, the image installs with `--omit=dev`, and every entry point
 * said `npx tsx` — so `npx` did what it is for and pulled the package from the
 * registry on each cold boot. Nothing looked wrong: the line reads like a local
 * invocation, the container started, photographs were derived. It surfaced only
 * because a one-off machine happened to print `npm warn exec The following
 * package was not found and will be installed`.
 *
 * What it cost is not startup time. This is the process that holds the R2
 * credentials and DATABASE_URL and decodes photographs from strangers; a
 * package fetched at boot and executed is a supply-chain path into it, and one
 * that no amount of pinning in the lockfile covered, because the lockfile is
 * not what `npx` consults for a package that is not installed. It also meant
 * ingest could not start at all while the registry was unreachable.
 *
 * Neither half is visible from a passing suite or a green build, so both are
 * pinned here: the dependency has to be a runtime one, and no process
 * definition may invoke a package runner that is able to install.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

/**
 * The same file with its comments gone.
 *
 * Not optional, and the first version of this test proved it by failing: the
 * Dockerfile's note explaining the hazard says "`node_modules/.bin/tsx`, not
 * `npx tsx`", and a scan of raw source read that sentence as the thing it
 * forbids. `apps/web/test/support/source.ts` is a whole file about this
 * happening twice over there; it is the same lesson and the same fix.
 *
 * Only whole-line comments, matched on the first non-blank character. Both
 * formats here use `#` to end of line and neither has a value containing one,
 * but a blunter strip would eat the rest of any line that ever did.
 */
const stripComments = (source: string) =>
  source
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

const PKG = JSON.parse(read('package.json')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** Every file that names a command the deployed container will run. */
const ENTRY_POINTS = ['Dockerfile', 'fly.toml', 'fly.jobs.toml'] as const;

describe('what ships in the image', () => {
  it('carries the TypeScript runner as a runtime dependency', () => {
    /*
     * `npm ci --omit=dev` is what the Dockerfile runs, so devDependencies are
     * a statement about this repository and not about the container. Anything
     * the container executes has to be on the other list.
     */
    expect(PKG.dependencies.tsx, 'tsx must be a dependency, not a devDependency').toBeTruthy();
    expect(PKG.devDependencies?.tsx).toBeUndefined();
  });

  it.each(ENTRY_POINTS)('runs the local binary rather than a package runner in %s', (file) => {
    /*
     * `npx` is the specific hazard — given a package that is not installed it
     * fetches and runs it — but the rule is written against the family, because
     * `pnpm dlx` and `yarn dlx` are the same behaviour under other names and
     * this repository has changed package managers before.
     *
     * Read through `stripComments`, because the Dockerfile's own note explains
     * the hazard by quoting it — and a scan that cannot tell an explanation
     * from an instruction forbids writing the explanation down.
     */
    const source = stripComments(read(file));
    expect(source).not.toMatch(/\bnpx\s+(--\S+\s+)*tsx\b/);
    expect(source).not.toMatch(/"npx"\s*,\s*"tsx"/);
    expect(source).not.toMatch(/\b(pnpm|yarn)\s+dlx\b/);
  });

  it.each(ENTRY_POINTS)('names a runner that the install actually puts there in %s', (file) => {
    /*
     * The other direction. Forbidding `npx` is only half a rule — a path that
     * points at nothing fails the same way, just later and on a machine rather
     * than here. Every invocation has to name the bin directory npm links into,
     * which is what `tsx` being a dependency guarantees exists.
     */
    const source = stripComments(read(file));
    const invocations = [...source.matchAll(/\S*tsx["']?[,\s]+["']?services\//g)];
    expect(invocations.length, `${file} runs the deriver at least once`).toBeGreaterThan(0);
    for (const [invocation] of invocations) {
      expect(invocation, `${file}: ${invocation.trim()}`).toMatch(/node_modules\/\.bin\/tsx/);
    }
  });

  it('uses an absolute path where Docker will not resolve a relative one', () => {
    /*
     * The exec form of `CMD` runs no shell, so a relative path is not resolved
     * against `WORKDIR` the way the Fly process definitions' are — those go
     * through one, in `/app`. This is the single place the distinction bites,
     * and getting it wrong is a container that exits immediately on a machine
     * that only starts when a photograph is waiting.
     */
    const dockerfile = stripComments(read('Dockerfile'));
    const cmd = dockerfile.match(/^CMD \[.*\]$/m)?.[0];
    expect(cmd, 'Dockerfile has an exec-form CMD').toBeTruthy();
    expect(cmd!).toMatch(/"\/app\/node_modules\/\.bin\/tsx"/);
  });
});
