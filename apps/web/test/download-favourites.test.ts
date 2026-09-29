/**
 * Downloading only the photographs you starred.
 *
 * The route already takes a selection — `Select images` sends one — so this is
 * the Favorites tab's list handed to it, in both of the web's download menus
 * and as its own button in the phone's roll sheet — only when there is
 * something starred to send.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const EVENT = read('../app/components/EventView.tsx');
const APP = read('../../mobile/App.tsx');

describe('download favorites', () => {
  it('is in the wide menu and the narrow one, sending the starred ids', () => {
    const offers = EVENT.match(/>\s*Download favorites\s*</g) ?? [];
    expect(offers).toHaveLength(2);
    expect(EVENT.match(/download\('original', favourites\.map\(\(photo\) => photo\.id\)\)/g) ?? []).toHaveLength(2);
    expect(EVENT.match(/\{favourites\.length > 0 && \(/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('is its own button in the phone roll sheet, beside Download Roll', () => {
    const at = APP.indexOf("label={(savingScope === 'favourites' && saving) || 'Download Favorites'}");
    expect(at).toBeGreaterThan(APP.indexOf("|| 'Download Roll'}"));
    // Only when there are some to download.
    expect(APP).toMatch(/\{favourites > 0 && \(\s*<Action/);
    expect(APP).toMatch(/onSaveFavourites=\{\(\) => saveSet\('favourites'\)\}/);
  });
});
