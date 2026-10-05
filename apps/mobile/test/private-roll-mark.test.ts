/**
 * The padlock on a private roll — on its home card, on your own shelf, and on
 * an open roll of somebody else's shelf — and nowhere it would say it twice.
 *
 * Asserted on the source, like the rest of this suite's screen tests: what
 * matters is which glyph is drawn under which condition, in which line.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const LOCK = /<Glyph name="locked" size=\{11\} weight=\{2\.4\} color=\{t\.dim\} \/>/;

describe('a private roll wears a padlock', () => {
  it('on the home card, between the measured line and its rule', () => {
    const source = read('src/Events.tsx');
    const row = source.slice(source.indexOf('<View style={styles.measured}'));
    const text = row.indexOf('{measured}');
    const lock = row.search(LOCK);
    const rule = row.indexOf('styles.rule');
    expect(text).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(text);
    expect(rule).toBeGreaterThan(lock);
    expect(row.slice(text, lock)).toContain('{isPrivate && (');
    // The row is hidden from a screen reader, so the card's name says it.
    expect(source).toMatch(/const privately = isPrivate \? 'private, ' : '';/);
  });

  it('in front of the line under a tile on your own profile', () => {
    const source = read('src/Profile.tsx');
    expect(source).toMatch(/event\.accessPolicy === 'private' && \(\s*<View style=\{styles\.tileLock\}>/);
    expect(source).toMatch(LOCK);
  });

  it('on somebody else’s profile only where the frosted glass is not already saying it', () => {
    const source = read('src/Person.tsx');
    expect(source).toMatch(/\{!item\.locked && item\.isPrivate && \(/);
    expect(source).toMatch(LOCK);
  });

  it('and not on a public one, which is the common case', () => {
    for (const file of ['src/Events.tsx', 'src/Profile.tsx', 'src/Person.tsx']) {
      expect(read(file), file).not.toMatch(/<Glyph name="unlocked" size=\{11\}/);
    }
  });
});
