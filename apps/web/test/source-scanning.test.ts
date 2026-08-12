/**
 * The comment stripper the source-scanning tests are built on.
 *
 * Worth its own file because everything it supports is a safety net, and a
 * safety net with a hole in it is worse than none: `egress-invariant`,
 * `broken-images` and `accepted-types` all report "nothing wrong" about code
 * the stripper deleted before they saw it. Every case below is either a real
 * line from this codebase or the exact shape that has already fooled a test.
 */

import { describe, expect, it } from 'vitest';

import { stripComments } from './support/source';

/** The wildcard, built rather than written, so this file is safe to scan too. */
const STAR = '*';

describe('stripComments', () => {
  it('removes the comments it is there to remove', () => {
    expect(stripComments('a /* gone */ b')).toBe('a  b');
    expect(stripComments('a // gone\nb')).toBe('a \nb');
    expect(stripComments('/**\n * gone\n */\nreal();')).toMatch(/^\n\n\n?real\(\);$/);
  });

  it('keeps a comment opener that is inside a string', () => {
    // The bug. `image/` plus a star is a file input's accept attribute, and
    // `/e/` plus a star is the universal-link path pattern in the Apple
    // app-site-association route. Both contain a block-comment opener.
    const accept = `<input accept="image/${STAR}" /> ; const after = 1; /* c */`;
    expect(stripComments(accept)).toContain('accept="image/');
    expect(stripComments(accept)).toContain('const after = 1;');

    const aasa = `components: [{ '/': '/e/${STAR}' }], evil: GetObjectCommand, /* c */`;
    expect(stripComments(aasa)).toContain('GetObjectCommand');
  });

  it('does not swallow the code between a string opener and the next comment', () => {
    /*
     * The case with teeth, and the reason this file exists. The old regex
     * opened a comment at the wildcard inside the accept attribute and closed
     * it at the next real comment — deleting everything in between, which here
     * is an egress violation. `egress-invariant` would have reported the file
     * clean. Measured: 21 characters survived out of 86.
     */
    const source = [
      `<input accept="image/${STAR},video/${STAR}" />`,
      '<Something dangerous={storage.readBytes(key)} />',
      '{/* any later comment closes the swallow */}',
    ].join('\n');

    expect(stripComments(source)).toContain('readBytes(');
  });

  it('does not read a URL as a line comment', () => {
    // What the `[^:]` hack in the old regex was for. Here it falls out of
    // knowing the URL is inside a string.
    const line = `const u = 'https://parea.photos/e/abc'; const after = 1;`;
    expect(stripComments(line)).toBe(line);
  });

  it('keeps code inside template literals', () => {
    // Why strings are kept rather than blanked: a violation can be a real
    // call inside an interpolation, and blanking the literal would hide it.
    const sql = 'const q = `select ${storage.readBytes(key)} from t`;';
    expect(stripComments(sql)).toContain('readBytes(');
  });

  it('handles escapes and quotes inside strings', () => {
    expect(stripComments(`const s = "he said \\"/* hi */\\""; x();`)).toContain('/* hi */');
    expect(stripComments(`const s = 'it\\'s /* fine */'; x();`)).toContain('/* fine */');
  });

  it('preserves line structure', () => {
    // Callers use `^`-anchored patterns against CSS rules and TS declarations.
    const before = 'a();\n/* two\n   lines */\nb();\n// gone\nc();';
    expect(stripComments(before).split('\n')).toHaveLength(before.split('\n').length);
  });

  it('leaves a file with no comments untouched', () => {
    const code = 'export const x = 1;\nexport function y() { return "z"; }\n';
    expect(stripComments(code)).toBe(code);
  });
});
