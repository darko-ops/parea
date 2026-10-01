/**
 * Photos somebody is adding appear in the gallery at once, from the file in
 * hand, and give way to the real photograph when the feed has it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { QueueItem } from '@parea/upload';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { thumbnail } from '../app/components/thumbnails';
import { outstandingUploads, previewState } from '../app/components/uploadPreviews';

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const VIEW = read('app/components/EventView.tsx');
const HOOK = read('app/components/uploadPreviews.ts');
const UPLOADS = read('app/components/useUploads.ts');
const CSS = read('app/globals.css');

const item = (id: string, status: QueueItem['status'], photoId?: string): QueueItem =>
  ({ id, source: id, name: `${id}.jpg`, size: 1, mime: 'image/jpeg', eventId: 'e', status, attempts: 0, photoId }) as QueueItem;

describe('outstandingUploads', () => {
  const queue = [
    item('a', 'done', 'p-a'),
    item('b', 'done', 'p-b'),
    item('c', 'uploaded', 'p-c'),
    item('d', 'pending'),
    item('e', 'failed'),
    item('f', 'stale'),
  ];

  it('is newest first, the order the roll draws them in', () => {
    expect(outstandingUploads(queue, new Set(), false).map((i) => i.id)).toEqual([
      'f', 'e', 'd', 'c', 'b', 'a',
    ]);
  });

  it('drops a photo once it is on the page', () => {
    const ids = outstandingUploads(queue, new Set(['p-a', 'p-c']), false).map((i) => i.id);
    expect(ids).toEqual(['f', 'e', 'd', 'b']);
  });

  it('drops a sent one that will never show once the album has settled, and keeps the stuck', () => {
    const ids = outstandingUploads(queue, new Set(['p-a']), true).map((i) => i.id);
    expect(ids).toEqual(['f', 'e', 'd', 'c']);
  });
});

describe('previewState', () => {
  it('says uploading until sent, then processing, and names the stuck', () => {
    expect(previewState('pending')).toBe('uploading');
    expect(previewState('presigned')).toBe('uploading');
    expect(previewState('uploaded')).toBe('uploading');
    expect(previewState('done')).toBe('processing');
    expect(previewState('failed')).toBe('failed');
    expect(previewState('stale')).toBe('stale');
  });
});

describe('thumbnail', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('says the size it drew, so a tile can hold the photo\'s shape', async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (done: (b: Blob) => void) => done(new Blob(['x'])),
    };
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 3024, height: 4032, close() {} })));
    vi.stubGlobal('document', { createElement: () => canvas });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:t');
    const photo = new File([new Uint8Array(4)], 'IMG.JPG', { type: 'image/jpeg' });
    expect(await thumbnail(photo)).toMatchObject({ url: 'blob:t', width: 240, height: 320 });
    // And the JPEG itself, which the gallery keeps for when it is opened again.
    expect((await thumbnail(photo))?.blob).toBeInstanceOf(Blob);
  });
});

describe('the hook', () => {
  it('makes previews from thumbnails one at a time, never from the original', () => {
    expect(HOOK).toMatch(/if \(!loaded \|\| busy\.current\) return;/);
    expect(HOOK).toMatch(/thumbnail\(file\)/);
    expect(HOOK).not.toMatch(/createObjectURL\(file/);
  });

  it('lets go of a preview when its tile goes, and of all of them on unmount', () => {
    expect(HOOK.match(/URL\.revokeObjectURL/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('holds handles itself, because the queue drops a file once it is sent', () => {
    expect(HOOK).toMatch(/held\.current\.set\(id, file\)/);
  });

  it('reads handles through the upload hook, which follows a restore after a refresh', () => {
    expect(UPLOADS).toMatch(/const fileOf = useCallback\(\(id: string\) => files\.current\.get\(id\), \[\]\)/);
    expect(UPLOADS).toMatch(/files\.current = restored\.files;/);
  });
});

describe('the gallery', () => {
  it('lays uploads out ahead of the photographs, at the preview\'s shape', () => {
    expect(VIEW).toMatch(/for \(const upload of pending\) place\(\{ upload, ratio: upload\.ratio \?\? 2 \/ 3 \}\)/);
    expect(VIEW).toMatch(/pending=\{previews\}/);
  });

  it('draws them as neither links nor pickable tiles', () => {
    const tile = read('app/components/UploadTile.tsx');
    expect(tile).not.toMatch(/href=/);
    expect(tile).not.toMatch(/tile-pick/);
    expect(tile).toMatch(/onClick=\{onRetry\}/);
    expect(tile).toMatch(/onClick=\{onPickAgain\}/);
  });

  it('wires retry to the queue and pick-again to the picker', () => {
    expect(VIEW).toMatch(/onRetry=\{\(\) => void uploads\.retry\(\)\}/);
    expect(VIEW).toMatch(/onPickAgain=\{\(\) => inputRef\.current\?\.click\(\)\}/);
    expect(UPLOADS).toMatch(/q\.retryFailed\(eventId\)/);
  });

  it('is styled beside the other tiles', () => {
    expect(CSS).toMatch(/\.tile-pending img \{ opacity: \.6; \}/);
  });
});
