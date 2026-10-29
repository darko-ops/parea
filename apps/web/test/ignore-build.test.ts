/**
 * What makes Vercel build the web app: a change to something it is built
 * from. Everything else in the repository (the mobile app, the services on
 * Fly, docs) used to rebuild and redeploy it too, at a few build minutes each.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));

const { ignoreCommand } = read('../vercel.json') as { ignoreCommand: string };
const watched = ignoreCommand.split(' -- ')[1]!.split(' || ')[0]!.split(' ');

describe('which changes build the web app', () => {
  it('watches every workspace package the app depends on', () => {
    const pkg = read('../package.json') as Record<string, Record<string, string> | undefined>;
    const workspaces = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => name.startsWith('@parea/'));
    expect(workspaces.length).toBeGreaterThan(0);
    for (const name of workspaces) expect(watched).toContain(`../../packages/${name.slice('@parea/'.length)}`);
  });

  it('watches the app, the lockfile and the migration the build runs', () => {
    expect(watched).toEqual(expect.arrayContaining(['.', '../../package-lock.json', '../../scripts/migrate-on-deploy.mjs']));
  });

  it('builds when there is nothing to compare with, or the comparison fails', () => {
    expect(ignoreCommand).toMatch(/^\[ -n "\$VERCEL_GIT_PREVIOUS_SHA" \] && /);
    expect(ignoreCommand).toMatch(/ \|\| exit 1$/);
  });
});
