/**
 * What a parser is holding when it reads a stranger's file.
 *
 * `exiftool` and `heif-convert` are started by this service on every upload,
 * and both were inheriting the deriver's environment: the R2 keys, the database
 * URL, the QStash token, the scanner's key. That is not a subtle mistake — it
 * is the default, and the default is wrong here specifically because these two
 * processes exist to parse bytes chosen by somebody else.
 *
 * It matters more than it would elsewhere. Debian's tracker lists four libheif
 * CVEs as vulnerable in the version trixie ships, including a heap buffer
 * overflow, and `heif-convert` is the binary those live in. The decoder cannot
 * be fixed from this repository; what a successful exploit walks away with can.
 *
 * These assertions are about the contract rather than the implementation,
 * because the implementation is three lines and the contract is the point: a
 * parser gets `PATH`, `HOME`, `LANG`, and nothing else, ever.
 */

import { describe, expect, it } from 'vitest';

import { runParser } from '../src/subprocess';

describe('a parser runs empty-handed', () => {
  /*
   * The test sets its own secret rather than reading a real one.
   *
   * Asserting on `R2_SECRET_ACCESS_KEY` would pass on any machine that does not
   * happen to have it set, which is every developer laptop and CI — a green
   * test proving nothing. A value planted here is present by construction, so
   * the assertion is about the boundary rather than about the environment the
   * suite was run in.
   */
  it('does not pass the parent environment through', async () => {
    process.env.PAREA_TEST_SECRET = 'must-not-reach-a-parser';
    try {
      const { stdout } = await runParser('/usr/bin/env', []);
      expect(stdout).not.toContain('must-not-reach-a-parser');
      expect(stdout).not.toContain('PAREA_TEST_SECRET');
    } finally {
      delete process.env.PAREA_TEST_SECRET;
    }
  });

  it('passes exactly the three variables a tool needs to run', async () => {
    const { stdout } = await runParser('/usr/bin/env', []);
    const names = stdout
      .split('\n')
      .map((line) => line.split('=')[0])
      .filter(Boolean)
      .sort();

    // `_` is set by some shells on exec and is not ours to control.
    expect(names.filter((n) => n !== '_')).toEqual(['HOME', 'LANG', 'PATH']);
  });

  it('keeps PATH, or nothing could be found at all', async () => {
    const { stdout } = await runParser('/usr/bin/env', []);
    expect(stdout).toMatch(/^PATH=.+$/m);
  });

  /*
   * The binary is still reachable by bare name after the environment is
   * rebuilt — which is the one way this change could break everything quietly,
   * since both real call sites use a bare name rather than a path.
   */
  it('still finds a tool by name rather than by path', async () => {
    const { stdout } = await runParser('exiftool', ['-ver']);
    expect(stdout.trim()).toMatch(/^\d+\.\d+/);
  });

  it('bounds how long a parser may run', async () => {
    // Well past the 120s ceiling would make this test unbearable, so the
    // assertion is that the option is set rather than that it fires.
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/subprocess.ts', import.meta.url), 'utf8'),
    );
    expect(source).toMatch(/timeout: TIMEOUT_MS/);
    expect(source).toMatch(/const TIMEOUT_MS = 120_000;/);
  });

  /*
   * No shell, ever. A filename reaching a shell is a different class of bug
   * from a decoder overflow and a much easier one to introduce — the argument
   * arrays here carry paths built from `mkdtemp`, but the guarantee should not
   * depend on that staying true.
   */
  it('never offers a shell', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/subprocess.ts', import.meta.url), 'utf8'),
    );
    expect(source).not.toMatch(/shell:\s*true/);
    expect(source).not.toMatch(/\bexecSync\b|\bspawnSync\b/);
  });
});
