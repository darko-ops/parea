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

// Comments describe the very markup being scanned for — MosaicTile's header
// explains what an `<img>` does when it fails — so raw source would flag the
// warning against the mistake as the mistake.
import { stripComments } from './support/source';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const APP = join(ROOT, 'app');

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

  it('leave a cover as the flat rectangle it was drawn on', async () => {
    const css = await source('app/globals.css');
    const cover = css.match(/^\.card-cover \{[^}]*\}/m)?.[0] ?? '';

    /*
     * There is no mosaic on a card any more — one cover, full bleed. So the
     * failure has one shape rather than four: `CoverImage` removes an `<img>`
     * it cannot load, and what is left underneath has to be a deliberate
     * colour rather than a hole. A white gap in a grid of photographs reads as
     * a card that is still loading; a flat warm rectangle reads as a card
     * whose picture is not there, which is what is true.
     */
    expect(cover).toMatch(/background:\s*var\(--hairline\)/);
    expect(cover).toMatch(/overflow:\s*hidden/);
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

    /*
     * Guideline 1.2 wants reporting reachable. A photo that will not render
     * for you is not a photo nobody can see — it may be the one someone means
     * to report — so the failed tile is still the way to the photograph's own
     * page, whose actions do not depend on its image.
     *
     * Anchored to `.tile-open` by name rather than to "the first control in
     * the file". It used to read the first `<button>`, and when the tile
     * became a link that match slid onto the selection checkbox underneath —
     * which has an `onClick` and an `aria-label` of its own and so kept the
     * test green while the property it defends had moved.
     */
    // To the closing tag rather than to the first `>`, which the arrow
    // function in the click handler gets to first.
    const open = tile.match(/<a\s+className="tile-open"[\s\S]*?<\/a>/)?.[0] ?? '';
    expect(open).toContain('href={href}');
    expect(open).toContain('aria-label');
    // The failed tile renders the same link. `return null` is already refused
    // above; this is the other half — nothing may take the href away.
    expect(tile).not.toMatch(/disabled/);
  });
});
