/**
 * Card mosaics degrade to blank, never to the broken-image glyph.
 *
 * Thumbnail URLs are signed against the event's `cap_epoch`, so they stop
 * resolving for ordinary reasons: someone rotates a link, a cached page is
 * restored from the back-forward cache, a signature ages out. When that
 * happens every URL on the card fails at once, and the default rendering is a
 * grid of grey glyphs — which reads as "this product lost your photos" on the
 * first screen someone opens, rather than "one signature expired".
 *
 * `MosaicTile` removes an `<img>` that will not load, and the mosaic's tiles
 * and gutters share a colour, so the card collapses to one even panel and
 * keeps its name, its count and its meta line.
 *
 * ## Why this is a source check
 *
 * The behaviour is a browser behaviour and there is no DOM in this suite.
 * Both assertions below stand in for a Playwright run against a production
 * build, which is how the fix was actually confirmed: with the mount check in
 * place all failing tiles disappeared, and with it removed all of them stayed
 * broken — same page, same build, no other difference. Neither assertion can
 * prove the component works; both catch it being quietly taken apart, which is
 * the failure that has no other signal.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function source(path: string): Promise<string> {
  const text = await readFile(new URL(path, new URL(ROOT, 'file:')), 'utf8');
  // Comments describe the very markup being scanned for — this file's subject
  // is an `<img>` tag, and so is MosaicTile's header.
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('card mosaics', () => {
  it('render every photo through MosaicTile', async () => {
    const card = await source('app/components/EventCard.tsx');

    // A raw <img> here is the whole bug: it renders the glyph and there is no
    // way to hear that it failed, because the card is server-rendered.
    expect(card).not.toMatch(/<img[\s/>]/);
    expect(card).toContain('MosaicTile');
  });

  it('catch failures that happen before hydration', async () => {
    const tile = await source('app/components/MosaicTile.tsx');

    // `onError` is the obvious half and the insufficient one. These images are
    // server-rendered, so the browser can finish failing them while the HTML
    // is still streaming; React does not replay events fired before hydration,
    // so the handler never runs and the glyph stays. The only way to find one
    // afterwards is to ask the element: finished loading, no intrinsic width.
    expect(tile).toContain('onError');
    expect(tile).toContain('naturalWidth');
  });

  it('give tiles and gutters the same colour', async () => {
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
});
