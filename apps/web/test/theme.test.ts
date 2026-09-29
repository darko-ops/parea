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
    expect(layout).toMatch(/<script dangerouslySetInnerHTML=\{\{ __html: CHOOSE \}\} \/>/);
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
