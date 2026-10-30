/**
 * What makes Vercel build the web app: a change to something it is built
 * from. Everything else in the repository (the mobile app, the services on
 * Fly, docs) used to rebuild and redeploy it too, at a few build minutes each.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const text = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const { ignoreCommand } = JSON.parse(text('../vercel.json')) as { ignoreCommand: string };
const script = text('../../../scripts/ignore-web-build.sh');
const watched = script
  .split(' -- \\\n')[1]!
  .split(' || ')[0]!
  .split(/\s*\\\n\s*/)
  .map((path) => path.trim());

describe('which changes build the web app', () => {
  it('runs the script, in a command Vercel accepts', () => {
    // Vercel refuses the whole deployment over a longer one.
    expect(ignoreCommand.length).toBeLessThanOrEqual(256);
    expect(ignoreCommand).toBe('sh ../../scripts/ignore-web-build.sh');
  });

  it('watches every workspace package the app depends on', () => {
    const pkg = JSON.parse(text('../package.json')) as Record<string, Record<string, string> | undefined>;
    const workspaces = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => name.startsWith('@parea/'));
    expect(workspaces.length).toBeGreaterThan(0);
    for (const name of workspaces) expect(watched).toContain(`../../packages/${name.slice('@parea/'.length)}`);
  });

  it('watches the app, the lockfile and the migration the build runs', () => {
    expect(watched).toEqual(expect.arrayContaining(['.', '../../package-lock.json', '../../scripts/migrate-on-deploy.mjs']));
  });

  it('builds when there is nothing to compare with, or the comparison fails', () => {
    expect(script).toContain('[ -n "$VERCEL_GIT_PREVIOUS_SHA" ] || exit 1');
    expect(script.trimEnd()).toMatch(/ \|\| exit 1$/);
  });
});
