/**
 * Light or dark on the web: dark unless somebody picks light, as in the app.
 *
 * Pinned at the three places it can quietly break — the page served dark,
 * the head script that turns it light before it paints, and the dark set of
 * tokens the page draws with.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

describe('appearance', () => {
  it('is served dark, and turned light before paint for somebody who chose it', () => {
    const layout = read('app/layout.tsx');
    expect(layout).toMatch(/<html lang="en" data-theme="dark" suppressHydrationWarning>/);
    expect(layout).toMatch(/document\.documentElement\.dataset\.theme='light'/);
    // With the page's nonce, or the script policy refuses it and every page is dark.
    expect(layout).toMatch(/<script nonce=\{nonce\} dangerouslySetInnerHTML=\{\{ __html: CHOOSE \}\} \/>/);
  });

  it('has a dark set of every surface token, and words that read on the accent', () => {
    const css = read('app/globals.css');
    const dark = css.slice(css.indexOf(':root[data-theme="dark"] {'));
    for (const token of ['--bg', '--card', '--fg', '--dim', '--line', '--accent', '--on-accent', '--warn']) {
      expect(dark, token).toMatch(new RegExp(`${token}:`));
    }
    // A button on the accent never hard-codes white words.
    expect(css).not.toMatch(/background: var\(--accent\); color: #fff/);
  });

  it('is chosen on the account page and kept in the cookie the head script reads', () => {
    const control = read('app/components/Appearance.tsx');
    expect(control).toMatch(/document\.cookie = `\$\{THEME_COOKIE\}=\$\{next\}; path=\/; max-age=31536000/);
    expect(read('app/components/AccountView.tsx')).toMatch(/<Appearance \/>/);
  });
});

describe('the page header on a laptop', () => {
  it('puts the greeting on the leading side and the mark in the middle, on every page but the profile', () => {
    for (const file of [
      'app/components/HomeView.tsx',
      'app/components/CreateGroupCard.tsx',
      'app/activity/page.tsx',
      'app/components/FindView.tsx',
    ]) {
      const source = read(file);
      expect(source, file).toMatch(/<PageMark \/>/);
      expect(source, file).toMatch(/page-greet/);
    }
    // The page header's centre is the wordmark; the rail wears the glyph.
    expect(read('app/components/PageMark.tsx')).toMatch(/<span className="wordmark">Parea<\/span>/);
    expect(read('app/components/AccountView.tsx')).not.toMatch(/PageMark/);
    expect(read('app/components/PersonView.tsx')).not.toMatch(/PageMark/);

    const css = read('app/globals.css');
    // Clear of Chat's search disc, and the same indent everywhere.
    expect(css).toMatch(/\.page-greet \{ padding-left: 48px; text-align: left; pointer-events: none; \}/);
    // And not on a phone.
    expect(css).toMatch(/@media \(max-width: 720px\) \{\s*\.page-mark \{ display: none; \}/);
  });
});
