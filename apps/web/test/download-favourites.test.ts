/**
 * Downloading only the photographs you starred.
 *
 * The route already takes a selection — `Select images` sends one — so this is
 * the Favorites tab's list handed to it, in both of the menus the download
 * lives in, and only when there is something starred to send.
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

  it('is asked on the phone before the size, and only when it could differ', () => {
    expect(APP).toMatch(/const favourites = feed\.photos\.filter\(\(p\) => p\.favourite\);/);
    expect(APP).toMatch(/favourites\.length === 0 \|\| favourites\.length === feed\.photos\.length/);
    expect(APP).toMatch(/text: `Favorites \(\$\{favourites\.length\}\)`, onPress: \(\) => ask\(favourites\)/);
  });
});
