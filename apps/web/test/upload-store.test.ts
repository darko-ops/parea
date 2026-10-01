/**
 * The persistence half of the web upload queue — docs/design.md §8.
 *
 * A caveat that shapes what is here: **no in-process IndexedDB carries a real
 * `File` through a round trip.** fake-indexeddb hands back a plain object with
 * no `name`, no `lastModified` and no `slice`. So this file tests what it can
 * test honestly — the queue state, which is plain JSON, and the lifecycle of
 * the records around it — and the behaviour that depends on a live handle is
 * tested in `upload-resume.test.ts` against handles supplied directly.
 *
 * Whether a real browser preserves a `File` across a reload is a device
 * question, and it is on the launch checklist rather than pretended at here.
 */

import 'fake-indexeddb/auto';

import type { QueueState } from '@parea/upload';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

import { RESUME_WINDOW_MS, SECURE_BUDGET_BYTES, UploadStore, readable } from '../src/upload/store';

let store: UploadStore;

beforeEach(async () => {
  // A fresh factory per test; reusing one leaks records between them.
  store = await UploadStore.open(new IDBFactory());
});

function state(...items: Partial<QueueState['items'][number]>[]): QueueState {
  return {
    items: items.map((item, index) => ({
      id: `ev:photo-${index}`,
      eventId: 'ev',
      source: `photo-${index}.jpg:100:5`,
      name: `photo-${index}.jpg`,
      size: 100,
      mime: 'image/jpeg',
      status: 'pending' as const,
      attempts: 0,
      ...item,
    })),
  };
}

const file = (name = 'a.jpg') =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });

describe('queue state', () => {
  it('comes back as it went in', async () => {
    const original = state({ status: 'presigned', photoId: 'p1' }, { attempts: 2 });
    await store.saveState('ev', original);
    expect(await store.loadState('ev')).toEqual(original);
  });

  it('is per event', async () => {
    await store.saveState('ev', state({}));
    expect(await store.loadState('other')).toBeNull();
  });

  it('is nothing at all before anything is queued', async () => {
    expect(await store.loadState('ev')).toBeNull();
  });

  it('is not resumed once it is stale, and is cleaned up', async () => {
    // Resume is for the tab that just reloaded. Someone returning next week to
    // a page that silently starts uploading is a different thing entirely.
    const now = Date.now();
    await store.saveState('ev', state({}), now - RESUME_WINDOW_MS - 1);
    await store.putFiles('ev', [{ id: 'ev:photo-0', file: file() }]);

    expect(await store.loadState('ev', now)).toBeNull();
    // And it took the handles with it, rather than leaving them pinned.
    expect(await store.getFile('ev:photo-0')).toBeNull();
  });

  it('is resumed right up to the edge of the window', async () => {
    const now = Date.now();
    await store.saveState('ev', state({}), now - RESUME_WINDOW_MS + 1000);
    expect(await store.loadState('ev', now)).not.toBeNull();
  });
});

describe('file records', () => {
  it('are stored and fetched by item id', async () => {
    await store.putFiles('ev', [{ id: 'ev:a', file: file() }]);
    expect(await store.getFile('ev:a')).not.toBeNull();
    expect(await store.getFile('ev:missing')).toBeNull();
  });

  it('are dropped as items finish, not only at the end', async () => {
    // The reason this database stays small is that it holds outstanding work
    // only. A handle pinned for a photo that already uploaded is exactly what
    // accumulates unnoticed.
    await store.putFiles('ev', [
      { id: 'ev:a', file: file('a.jpg') },
      { id: 'ev:b', file: file('b.jpg') },
    ]);
    await store.dropFiles(['ev:a']);

    expect(await store.getFile('ev:a')).toBeNull();
    expect(await store.getFile('ev:b')).not.toBeNull();
  });

  it('survive being dropped by the empty list', async () => {
    await expect(store.dropFiles([])).resolves.toBeUndefined();
  });

  it('are cleared per event, leaving other events alone', async () => {
    await store.putFiles('ev', [{ id: 'ev:a', file: file() }]);
    await store.putFiles('other', [{ id: 'other:a', file: file() }]);
    await store.saveState('ev', state({}));

    await store.clear('ev');

    expect(await store.loadState('ev')).toBeNull();
    expect(await store.getFile('ev:a')).toBeNull();
    expect(await store.getFile('other:a')).not.toBeNull();
  });
});

describe('readable', () => {
  it('is true for a handle that can produce bytes', async () => {
    expect(await readable(file())).toBe(true);
  });

  it('is false when the read throws', async () => {
    // What a browser does once the underlying storage no longer matches the
    // blob's snapshot: the read fails, per the File API.
    const dead = {
      slice: () => ({
        arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotReadableError')),
      }),
    } as unknown as File;
    expect(await readable(dead)).toBe(false);
  });

  it('is false for something that is not a file at all', async () => {
    // Which is what an evicted or half-migrated record deserializes to.
    expect(await readable({} as File)).toBe(false);
  });

  it('does not settle for asking the handle how big it is', async () => {
    // The trap: `size` and `name` answer from the snapshot and keep answering
    // after the bytes are gone, so checking them is worse than not checking.
    let read = false;
    const probe = {
      size: 4_000_000,
      name: 'IMG_0001.HEIC',
      slice: () => ({
        arrayBuffer: async () => {
          read = true;
          return new ArrayBuffer(1);
        },
      }),
    } as unknown as File;

    await readable(probe);
    expect(read, 'readable() must actually read').toBe(true);
  });
});

describe('secure', () => {
  // Bytes we can count, with the size the budget reads.
  const sized = (name: string, bytes: number) =>
    new File([new Uint8Array(bytes)], name, { type: 'image/jpeg', lastModified: 1 });

  it('copies outstanding photos, so a reload on iOS can still send them', async () => {
    const files = [
      { id: 'ev:a', file: sized('a.jpg', 10) },
      { id: 'ev:b', file: sized('b.jpg', 10) },
    ];
    await store.putFiles('ev', files);
    expect(await store.secure(files)).toBe(2);
    expect(await store.getFile('ev:a')).not.toBeNull();
  });

  it('stops at the budget, leaving the rest as references', async () => {
    const files = [
      { id: 'ev:a', file: sized('a.jpg', 40) },
      { id: 'ev:b', file: sized('b.jpg', 40) },
      { id: 'ev:c', file: sized('c.jpg', 40) },
    ];
    await store.putFiles('ev', files);
    expect(await store.secure(files, 100)).toBe(2);
    expect(await store.getFile('ev:c')).not.toBeNull();
  });

  it('does not bring back a photo that finished while it worked', async () => {
    const files = [{ id: 'ev:a', file: sized('a.jpg', 10) }];
    await store.putFiles('ev', files);
    await store.dropFiles(['ev:a']);
    expect(await store.secure(files)).toBe(0);
    expect(await store.getFile('ev:a')).toBeNull();
  });

  it('skips a file it cannot read, and carries on', async () => {
    const dead = { name: 'gone.jpg', size: 10, type: 'image/jpeg', lastModified: 1,
      arrayBuffer: () => Promise.reject(new Error('NotReadableError')) } as unknown as File;
    await store.putFiles('ev', [
      { id: 'ev:a', file: sized('a.jpg', 10) },
      { id: 'ev:b', file: sized('b.jpg', 10) },
    ]);
    // The stored handle for `a` has died by the time `secure` reaches it.
    expect(
      await store.secure([
        { id: 'ev:a', file: dead },
        { id: 'ev:b', file: sized('b.jpg', 10) },
      ]),
    ).toBe(1);
  });

  it('has a budget that covers a normal handful of phone photos', () => {
    // Twenty 10 MB photos — a generous evening — fit; two hundred do not.
    expect(SECURE_BUDGET_BYTES).toBeGreaterThanOrEqual(20 * 10 * 1024 * 1024);
    expect(SECURE_BUDGET_BYTES).toBeLessThan(200 * 10 * 1024 * 1024);
  });
});
