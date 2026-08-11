/**
 * Images degrade to something honest, never to the broken-image glyph.
 *
 * Image URLs are signed against the event's `cap_epoch`, so they stop
 * resolving for ordinary reasons rather than only for bugs: someone rotates a
 * link, a page comes back out of the back-forward cache, a signature ages out.
 * Every URL on a screen shares the epoch, so they fail together, and the
 * browser's answer is a grey glyph in every slot. On the first screen someone
 * opens that reads as "this product lost your photos".
 *
 * What replaces it differs by screen, and the difference is the point:
 *
 *   - a card mosaic is decoration, so `MosaicTile` removes the tile and the
 *     card collapses to one even panel, still carrying its name and count;
 *   - a photo in an event is content, so `PhotoTile` holds the slot open —
 *     dropping it would leave the header saying twelve above a grid of eleven;
 *   - the lightbox and the takedown queue say so in words, because there is
 *     one image and its absence would otherwise be unexplained.
 *
 * ## Why these are source checks
 *
 * The behaviour is a browser behaviour and there is no DOM in this suite. The
 * assertions stand in for a Playwright run against a production build, which
 * is how the fix was actually confirmed: with the mount check in place every
 * failing tile disappeared, and with it removed every one stayed broken —
 * same page, same build, no other difference. They cannot prove the components
 * work; they catch them being quietly taken apart, which is the failure that
 * has no other signal.
 */

import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP = join(ROOT, 'app');

/**
 * Comments describe the very markup being scanned for — MosaicTile's header
 * explains what an `<img>` does when it fails — so raw source would flag the
 * warning against the mistake as the mistake.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (extname(entry.name) === '.tsx') out.push(full);
  }
  return out;
}

async function components(): Promise<{ path: string; source: string }[]> {
  const paths = await walk(APP);
  return Promise.all(
    paths.map(async (path) => ({
      path: relative(ROOT, path),
      source: stripComments(await readFile(path, 'utf8')),
    })),
  );
}

async function source(path: string): Promise<string> {
  return stripComments(await readFile(join(ROOT, path), 'utf8'));
}

describe('images that will not load', () => {
  it('are never rendered without a failure path', async () => {
    /*
     * Deliberately a rule rather than a list of the files that are allowed to
     * get this wrong. An allow-list would have to be maintained by whoever
     * adds the next screen, which is exactly the person who does not yet know
     * this rule exists — and a list that goes stale reads as coverage while
     * providing none. Stated this way a new `<img>` either handles failure or
     * fails this test, and there is nothing to keep up to date.
     */
    const offenders = (await components())
      .filter(({ source }) => /<img[\s/>]/.test(source))
      .filter(({ source }) => !source.includes('useImageFailure'))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('are detected even when they fail before hydration', async () => {
    const hook = await source('app/components/useImageFailure.ts');

    // `onError` is the obvious half and the insufficient one. These images are
    // server-rendered, so the browser can finish failing them while the HTML
    // is still streaming; React does not replay events fired before
    // hydration, so the handler never runs and the glyph stays. The only way
    // to find one afterwards is to ask the element: finished loading, no
    // intrinsic width.
    expect(hook).toContain('onError');
    expect(hook).toContain('naturalWidth');
    expect(hook).toContain('complete');
  });

  it('are given another chance when the URL is re-signed', async () => {
    const hook = await source('app/components/useImageFailure.ts');

    // The feed re-polls while an upload runs and signs fresh URLs each time.
    // A boolean would latch, so the screen most likely to recover — the one
    // being actively added to — would stay blank once its URLs started
    // working again. The remembered failure has to be keyed on the source.
    expect(hook).toMatch(/failedSrc === src|failed:\s*\w+ === src/);
    expect(hook).toMatch(/\[src\]/);
  });

  it('leave a card mosaic as one even panel', async () => {
    const css = await source('app/globals.css');
    const mosaic = css.match(/^\.mosaic \{[^}]*\}/m)?.[0] ?? '';
    const tile = css.match(/^\.mosaic > \* \{[^}]*\}/m)?.[0] ?? '';

    // Otherwise a card whose photos all failed is an empty grid with the
    // gutters ruled across it in a contrasting colour, which looks like
    // damage. Same colour, and it is one clean panel.
    const colour = /background:\s*(var\(--[a-z-]+\)|#[0-9a-f]{3,8})/;
    expect(mosaic).toMatch(colour);
    expect(tile.match(colour)?.[1]).toBe(mosaic.match(colour)?.[1]);
  });

  it('keep the event grid honest about how many photos there are', async () => {
    const tile = await source('app/components/PhotoTile.tsx');

    // The count in the header comes from the server, not from how many tiles
    // rendered. A tile that removed itself on failure would make that count
    // wrong, and wrong in a way that looks like someone's photo was deleted.
    expect(tile).not.toMatch(/return null/);
    expect(tile).toContain('tile-empty');
  });

  it('keep the way in to the safety actions', async () => {
    const tile = await source('app/components/PhotoTile.tsx');

    // Guideline 1.2 wants reporting reachable. A photo that will not render
    // for you is not a photo nobody can see — it may be the one someone means
    // to report — so the failed tile is still the button that opens the
    // lightbox, and the lightbox's own actions do not depend on its image.
    const button = tile.match(/<button[\s\S]*?>/)?.[0] ?? '';
    expect(button).toContain('onClick');
    expect(button).toContain('aria-label');
    expect(tile).not.toMatch(/disabled/);
  });
});
