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
