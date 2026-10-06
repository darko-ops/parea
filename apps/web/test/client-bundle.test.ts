/**
 * What a browser is sent of `@parea/core`.
 *
 * Its main entry is server code: the schema and drizzle, `node:crypto` for
 * tokens and the policy. A client component that imported `PRIVATE` from it
 * pulled all of that into the page — a crypto polyfill, the ORM and a
 * generator-function probe that `eval`s, half a megabyte on the home page and
 * a CSP report on every visit. Client code imports the dependency-free
 * subpaths instead.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE = fileURLToPath(new URL('../../../packages/core/src/', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name.startsWith('.') ? [] : files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const clientFiles = files(join(ROOT, 'app')).filter((path) =>
  /^\s*['"]use client['"]/.test(readFileSync(path, 'utf8')),
);

describe('the browser and @parea/core', () => {
  it('finds the client components to check', () => {
    expect(clientFiles.length).toBeGreaterThan(5);
  });

  it('never imports the package entry from a client component', () => {
    const offenders = clientFiles.filter((path) => /from '@parea\/core'/.test(readFileSync(path, 'utf8')));
    expect(offenders.map((p) => p.slice(ROOT.length))).toEqual([]);
  });

  it('keeps the subpaths a client may use free of imports', () => {
    for (const file of ['settings.ts', 'handles.ts']) {
      expect(readFileSync(join(CORE, file), 'utf8'), file).not.toMatch(/^import /m);
    }
  });
});
