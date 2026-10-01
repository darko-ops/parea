/**
 * Small previews instead of originals on the create-roll page.
 *
 * A strip of full-size iPhone originals ran Safari out of memory mid-upload;
 * these check that a preview is drawn small and the big decode is let go.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PREVIEW_EDGE, thumbnailUrl } from '../app/components/thumbnails';

function fakeBrowser(width: number, height: number) {
  const close = vi.fn();
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage }),
    toBlob: (done: (b: Blob) => void) => done(new Blob(['x'], { type: 'image/jpeg' })),
  };
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close })));
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:thumb');
  return { close, drawImage, canvas };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const photo = new File([new Uint8Array(4)], 'IMG_0001.JPG', { type: 'image/jpeg' });

describe('thumbnailUrl', () => {
  it('draws a 48-megapixel photo at the preview size and lets the big decode go', async () => {
    // A browser that ignored the resize option hands back the full size.
    const { close, drawImage } = fakeBrowser(8064, 6048);
    expect(await thumbnailUrl(photo)).toBe('blob:thumb');
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, PREVIEW_EDGE, 240);
    expect(close).toHaveBeenCalled();
  });

  it('keeps a portrait photo upright in proportion', async () => {
    const { drawImage } = fakeBrowser(3024, 4032);
    await thumbnailUrl(photo);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 240, PREVIEW_EDGE);
  });

  it('frees the canvas once the preview is made', async () => {
    const { canvas } = fakeBrowser(4000, 3000);
    await thumbnailUrl(photo);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it('answers null when the browser cannot decode it, so the page can fall back', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('HEIC'); }));
    vi.stubGlobal('document', { createElement: () => ({}) });
    expect(await thumbnailUrl(photo)).toBeNull();
  });
});

describe('the create-roll page', () => {
  it('shows thumbnails, made one at a time, with the original only as a fallback', () => {
    const page = readFileSync(fileURLToPath(new URL('../app/page.tsx', import.meta.url)), 'utf8');
    expect(page).toMatch(/\(await thumbnailUrl\(files\[i\]!\)\) \?\? URL\.createObjectURL\(files\[i\]!\)/);
    expect(page).toMatch(/for \(let i = 0; i < files\.length; i\+\+\)/);
  });
});
