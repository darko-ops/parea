/**
 * The roll's collage has one column count, not two.
 *
 * The layout put photographs into four columns while the stylesheet drew
 * three below 1200px — so once somebody added enough to fill the fourth, it
 * wrapped under the first and the collage grew a vertical stack of its newest
 * pictures. The count is now worked out from the window and handed to the
 * grid, and the stylesheet no longer has an opinion.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../app/${path}`, import.meta.url)), 'utf8');

describe('the collage', () => {
  it('lays out and draws the same number of columns', () => {
    const view = read('components/EventView.tsx');
    expect(view).toMatch(/const count = useColumnCount\(\);/);
    expect(view).toMatch(/Array\.from\(\s*\{ length: count \}/);
    expect(view).toMatch(/style=\{\{ gridTemplateColumns: `repeat\(\$\{count\}, minmax\(0, 1fr\)\)` \}\}/);
    // The breakpoints the stylesheet used to own, in one table.
    expect(view).toMatch(/\[1201, 4\],\s*\[901, 3\],\s*\[601, 2\],\s*\[0, 1\],/);
  });

  it('leaves the column count out of the stylesheet', () => {
    const css = read('globals.css');
    expect(css).not.toMatch(/\.masonry \{ grid-template-columns: repeat\(3/);
    expect(css).not.toMatch(/\.masonry \{ grid-template-columns: repeat\(2/);
  });
});
