/**
 * Previews outlive the page that made them.
 *
 * Leaving the roll and coming back used to empty the top of it: the previews
 * were drawn from files the queue lets go of once a photo is sent, and held in
 * memory. Now each is written down as it is made and read back on return,
 * until the real photograph is in the feed.
 *
 * As in `upload-store.test.ts`, fake-indexeddb does not carry a `Blob` through
 * faithfully, which is one reason the store keeps the bytes as a buffer; the
 * rules about which kept previews still owe a tile are pure and tested as such.
 */

import 'fake-indexeddb/auto';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { QueueItem } from '@parea/upload';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  PREVIEW_CAP,
  PREVIEW_TTL_MS,
  PreviewStore,
  expired,
  orphanPreviews,
  overCap,
  type PreviewMeta,
  type PreviewRecord,
} from '../src/upload/previews';

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const HOOK = read('app/components/uploadPreviews.ts');
const VIEW = read('app/components/EventView.tsx');

const NOW = 1_700_000_000_000;

const meta = (itemId: string, over: Partial<PreviewMeta> = {}): PreviewMeta => ({
  itemId,
  eventId: 'e',
  name: `${itemId}.jpg`,
  status: 'done',
  width: 240,
  height: 320,
  createdAt: NOW,
  ...over,
});

const record = (itemId: string, over: Partial<PreviewMeta> = {}): PreviewRecord => ({
  ...meta(itemId, over),
  bytes: new Uint8Array([1, 2, 3]).buffer,
  type: 'image/jpeg',
});

const item = (id: string, status: QueueItem['status'], photoId?: string): QueueItem =>
  ({ id, source: id, name: `${id}.jpg`, size: 1, mime: 'image/jpeg', eventId: 'e', status, attempts: 0, photoId }) as QueueItem;

describe('the preview store', () => {
  let store: PreviewStore;
  beforeEach(async () => {
    store = await PreviewStore.open(new IDBFactory());
  });

  it('gives an event its kept previews back, bytes and shape', async () => {
    await store.put(record('a', { photoId: 'p-a' }));
    await store.put(record('b', { eventId: 'other' }));
    const back = await store.load('e', NOW);
    expect(back.map((r) => r.itemId)).toEqual(['a']);
    expect(back[0]).toMatchObject({ photoId: 'p-a', width: 240, height: 320, type: 'image/jpeg' });
    expect(new Uint8Array(back[0]!.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('follows the photo along, and lets go of it', async () => {
    await store.put(record('a', { status: 'pending' }));
    await store.update('a', { photoId: 'p-a', status: 'done' });
    expect((await store.load('e', NOW))[0]).toMatchObject({ photoId: 'p-a', status: 'done' });
    await store.drop(['a']);
    expect(await store.load('e', NOW)).toEqual([]);
  });

  it('does not bring back one that was let go before its update landed', async () => {
    await store.drop(['a']);
    await store.update('a', { photoId: 'p-a', status: 'done' });
    expect(await store.load('e', NOW)).toEqual([]);
  });

  it('forgets ones older than half an hour as it reads', async () => {
    await store.put(record('old', { createdAt: NOW - PREVIEW_TTL_MS - 1 }));
    await store.put(record('new', { createdAt: NOW - 1000 }));
    expect((await store.load('e', NOW)).map((r) => r.itemId)).toEqual(['new']);
    // Gone for good, not just skipped.
    expect((await store.load('e', NOW - PREVIEW_TTL_MS)).map((r) => r.itemId)).toEqual(['new']);
  });

  it('keeps the newest of an event beyond the cap', async () => {
    for (let i = 0; i < 4; i++) await store.put(record(`p${i}`, { createdAt: NOW + i }), 3);
    expect((await store.load('e', NOW)).map((r) => r.itemId).sort()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('expired and overCap', () => {
  it('ages out at thirty minutes', () => {
    expect(PREVIEW_TTL_MS).toBe(30 * 60 * 1000);
    expect(expired({ createdAt: NOW - PREVIEW_TTL_MS }, NOW)).toBe(false);
    expect(expired({ createdAt: NOW - PREVIEW_TTL_MS - 1 }, NOW)).toBe(true);
  });

  it('names the oldest beyond the cap', () => {
    expect(PREVIEW_CAP).toBe(100);
    const records = [meta('a', { createdAt: 3 }), meta('b', { createdAt: 1 }), meta('c', { createdAt: 2 })];
    expect(overCap(records, 2)).toEqual(['b']);
    expect(overCap(records, 3)).toEqual([]);
  });
});

describe('orphanPreviews', () => {
  const kept = [
    meta('sent', { photoId: 'p-sent', createdAt: NOW - 2 }),
    meta('newer', { photoId: 'p-newer', createdAt: NOW - 1 }),
    meta('unsent', { status: 'pending' }),
  ];

  it('shows sent ones the queue no longer has as processing, newest first', () => {
    expect(orphanPreviews(kept, [], new Set(), new Set(), false).map((r) => r.itemId)).toEqual([
      'unsent', 'newer', 'sent',
    ]);
  });

  it('leaves the queue to speak for what it still holds', () => {
    const ids = orphanPreviews(kept, [item('sent', 'done', 'p-sent')], new Set(['sent']), new Set(), false);
    expect(ids.map((r) => r.itemId)).toEqual(['unsent', 'newer']);
  });

  it('lets go once the photograph is in the feed', () => {
    const ids = orphanPreviews(kept, [], new Set(), new Set(['p-sent']), false);
    expect(ids.map((r) => r.itemId)).toEqual(['unsent', 'newer']);
  });

  it('lets go once the album has settled with nothing arriving', () => {
    expect(orphanPreviews(kept, [], new Set(), new Set(), true)).toEqual([]);
  });

  it('lets go of an unsent one the queue held and then dropped — a discard', () => {
    const ids = orphanPreviews(kept, [], new Set(['unsent', 'sent']), new Set(), false);
    expect(ids.map((r) => r.itemId)).toEqual(['newer', 'sent']);
  });
});

describe('the hook', () => {
  it('reads kept previews back before making any, and writes each one it makes', () => {
    expect(HOOK).toMatch(/store\?\.load\(eventId\)/);
    expect(HOOK).toMatch(/if \(!loaded \|\| busy\.current\) return;/);
    expect(HOOK).toMatch(/store\.put\(/);
  });

  it('drops the kept copy with the tile, and never just for leaving', () => {
    expect(HOOK).toMatch(/store\?\.drop\(gone\)/);
    const unmount = HOOK.slice(HOOK.indexOf('alive.current = false;'));
    expect(unmount.slice(0, 200)).not.toMatch(/drop/);
  });

  it('does not count the feed a page opened with as a read since the last run', () => {
    expect(HOOK).toMatch(/useState<\{ running: boolean; shown: Set<string> \| null \}>\(\{\s*running,\s*shown,\s*\}\)/);
  });

  it('is polled for while kept previews wait on processing', () => {
    expect(VIEW).toMatch(/const waiting = previews\.some\(\(p\) => p\.state === 'processing'\)/);
    expect(VIEW).toMatch(/if \(!uploads\.running && feed\.arriving === 0 && !waiting\) return;/);
  });
});
