/**
 * What happens to an upload when the tab reloads — docs/design.md §8.
 *
 * The design's claim was that persisting the `File` handles is enough: "Safari
 * structured-clones them, so a reloaded tab resumes instead of restarting."
 * The clone is the easy half. A `Blob` carries a snapshot of its underlying
 * storage and the File API requires a read to fail once the real thing no
 * longer matches — so a handle can outlive its bytes, which on iOS is ordinary
 * rather than exotic, because the photo picker hands over temp copies the OS
 * later reclaims.
 *
 * That makes a dead handle a normal outcome, and the thing worth testing is
 * that it is handled as one: recognised without burning four retries, reported
 * as "pick this again" rather than "failed", and not allowed to stop the
 * photos that are still fine.
 *
 * Handles are supplied directly rather than through an IndexedDB fake, because
 * no in-process fake carries a real `File` — see `upload-store.test.ts`.
 */

import { SourceGone, UploadQueue, type QueueState } from '@parea/upload';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { browserDeps, describe as describeFile, restore, sourceKey } from '../src/upload/browser';

const live = (name: string) =>
  new File([new Uint8Array([1, 2, 3, 4])], name, {
    type: 'image/jpeg',
    lastModified: 1_700_000_000_000,
  });

/** A handle the browser has stopped honouring. */
const dead = (name: string) =>
  ({
    name,
    size: 4,
    lastModified: 1_700_000_000_000,
    type: 'image/jpeg',
    slice: () => ({
      arrayBuffer: () => Promise.reject(new DOMException('gone', 'NotReadableError')),
    }),
  }) as unknown as File;

/** A store standing in for IndexedDB, holding handles the fake cannot. */
function fakeStore(handles: Record<string, File>, state: QueueState | null) {
  return {
    loadState: vi.fn(async () => state),
    getFile: vi.fn(async (id: string) => handles[id] ?? null),
    saveState: vi.fn(async () => {}),
    dropFiles: vi.fn(async (ids: string[]) => {
      for (const id of ids) delete handles[id];
    }),
    clear: vi.fn(async () => {}),
  };
}

function stateFor(files: File[], overrides: Partial<QueueState['items'][number]> = {}) {
  return {
    items: files.map((file) => ({
      ...describeFile('ev', file).item,
      eventId: 'ev',
      status: 'pending' as const,
      attempts: 0,
      ...overrides,
    })),
  };
}

// A server that presigns and accepts everything.
function happyFetch() {
  return vi.fn(async (input: any, init: any = {}) => {
    const url = String(input);
    // `/api/events/<id>/uploads` presigns; `/api/uploads/<id>/complete` does
    // not, and matching '/uploads' alone conflates them.
    if (/\/api\/events\/[^/]+\/uploads$/.test(url) && init.method === 'POST') {
      const body = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          uploads: body.files.map((f: any, i: number) => ({
            photoId: `photo-${i}`,
            url: `https://r2.test/put/${i}`,
            headers: {},
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
          })),
        }),
        { status: 201 },
      );
    }
    return new Response('{}', { status: 200 });
  });
}

let handles: Record<string, File>;

beforeEach(() => {
  handles = {};
});

describe('source identity', () => {
  it('is the same for the same file picked twice', () => {
    expect(sourceKey(live('a.jpg'))).toBe(sourceKey(live('a.jpg')));
  });

  it('separates two files that differ only in name', () => {
    expect(sourceKey(live('a.jpg'))).not.toBe(sourceKey(live('b.jpg')));
  });

  it('gives an id that survives a reload, so the handle can be found again', () => {
    // A random id would leave the persisted state pointing at a file record
    // key that the next tab has no way to reconstruct.
    const file = live('a.jpg');
    expect(describeFile('ev', file).item.id).toBe(describeFile('ev', file).item.id);
    expect(describeFile('ev', file).item.id).toContain('ev:');
  });

  it('substitutes a MIME the presign route will accept when the browser gives none', () => {
    const untyped = new File([new Uint8Array([1])], 'IMG_1.HEIC', { type: '' });
    expect(describeFile('ev', untyped).item.mime).toBe('image/jpeg');
  });
});

describe('sending', () => {
  it('puts the handle straight into the request body', async () => {
    const file = live('a.jpg');
    const item = { ...describeFile('ev', file).item, eventId: 'ev' };
    handles[item.id] = file;

    const doFetch = happyFetch();
    const deps = browserDeps({
      eventId: 'ev',
      store: fakeStore(handles, null),
      files: new Map(),
      fetch: doFetch as any,
    });

    await deps.upload({
      ...item,
      status: 'presigned',
      attempts: 0,
      uploadUrl: 'https://r2.test/put/0',
      headers: {},
    });

    const put = doFetch.mock.calls.find(([, init]: any[]) => init?.method === 'PUT')!;
    // Not an ArrayBuffer: reading 200 files into memory to send them is the
    // tab crash this design exists to avoid.
    expect((put[1] as any).body).toBe(file);
  });

  it('reports a dead handle as gone rather than as a failure', async () => {
    const file = dead('a.jpg');
    const item = { ...describeFile('ev', file).item, eventId: 'ev' };
    handles[item.id] = file;

    const deps = browserDeps({
      eventId: 'ev',
      store: fakeStore(handles, null),
      files: new Map(),
      fetch: happyFetch() as any,
    });

    await expect(
      deps.upload({
        ...item,
        status: 'presigned',
        attempts: 0,
        uploadUrl: 'https://r2.test/put/0',
        headers: {},
      }),
    ).rejects.toBeInstanceOf(SourceGone);
  });

  it('checks the handle before spending a request on it', async () => {
    // A PUT whose body cannot be read rejects with the same opaque network
    // error as a dropped connection, and those two want opposite responses.
    const file = dead('a.jpg');
    const item = { ...describeFile('ev', file).item, eventId: 'ev' };
    handles[item.id] = file;
    const doFetch = happyFetch();

    await browserDeps({
      eventId: 'ev',
      store: fakeStore(handles, null),
      files: new Map(),
      fetch: doFetch as any,
    })
      .upload({
        ...item,
        status: 'presigned',
        attempts: 0,
        uploadUrl: 'https://r2.test/put/0',
        headers: {},
      })
      .catch(() => {});

    expect(doFetch).not.toHaveBeenCalled();
  });

  it('drops a handle as soon as its photo is done', async () => {
    const file = live('a.jpg');
    const item = { ...describeFile('ev', file).item, eventId: 'ev' };
    handles[item.id] = file;
    const memory = new Map([[item.id, file]]);
    const store = fakeStore(handles, null);

    await browserDeps({ eventId: 'ev', store, files: memory }).save({
      items: [{ ...item, status: 'done', attempts: 0 }],
    });

    expect(store.dropFiles).toHaveBeenCalledWith([item.id]);
    expect(memory.size, 'and out of memory too').toBe(0);
  });
});

describe('a queue that runs to a stale handle', () => {
  it('marks it stale on the first attempt rather than retrying four times', async () => {
    const file = dead('a.jpg');
    const item = { ...describeFile('ev', file).item, eventId: 'ev' };
    handles[item.id] = file;

    const queue = new UploadQueue(
      browserDeps({
        eventId: 'ev',
        store: fakeStore(handles, null),
        files: new Map(),
        fetch: happyFetch() as any,
      }),
      { items: [{ ...item, status: 'pending', attempts: 0 }] },
    );

    await queue.run();

    expect(queue.staleItems).toHaveLength(1);
    expect(queue.failedCount).toBe(0);
    // One attempt, not MAX_ATTEMPTS. Retrying cannot find the bytes.
    expect(queue.state.items[0]!.attempts).toBe(1);
  });

  it('sends the photos that are fine anyway', async () => {
    // One dead handle in a 200-photo batch must not cost the other 199.
    const good = live('good.jpg');
    const bad = dead('bad.jpg');
    const goodItem = { ...describeFile('ev', good).item, eventId: 'ev' };
    const badItem = { ...describeFile('ev', bad).item, eventId: 'ev' };
    handles[goodItem.id] = good;
    handles[badItem.id] = bad;

    const queue = new UploadQueue(
      browserDeps({
        eventId: 'ev',
        store: fakeStore(handles, null),
        files: new Map(),
        fetch: happyFetch() as any,
      }),
      {
        items: [
          { ...goodItem, status: 'pending', attempts: 0 },
          { ...badItem, status: 'pending', attempts: 0 },
        ],
      },
    );

    await queue.run();

    expect(queue.doneCount).toBe(1);
    expect(queue.staleItems.map((i) => i.name)).toEqual(['bad.jpg']);
  });
});

describe('restoring after a reload', () => {
  it('resumes items whose handles are still good', async () => {
    const a = live('a.jpg');
    const b = live('b.jpg');
    const state = stateFor([a, b]);
    handles[state.items[0]!.id] = a;
    handles[state.items[1]!.id] = b;

    const restored = await restore('ev', fakeStore(handles, state));
    expect(restored).not.toBeNull();
    expect(restored!.stale).toHaveLength(0);
    expect(restored!.files.size).toBe(2);
    expect(restored!.queue.pendingCount).toBe(2);
  });

  it('marks the ones the browser will not hand over any more', async () => {
    const a = live('a.jpg');
    const b = dead('b.jpg');
    const state = stateFor([a, b]);
    handles[state.items[0]!.id] = a;
    handles[state.items[1]!.id] = b;

    const restored = await restore('ev', fakeStore(handles, state));

    expect(restored!.stale.map((i) => i.name)).toEqual(['b.jpg']);
    // And says so in a way the UI can put in front of a person.
    expect(restored!.stale[0]!.error).toMatch(/no longer read/);
    expect(restored!.queue.pendingCount, 'the good one still runs').toBe(1);
  });

  it('treats a handle that vanished from the store the same way', async () => {
    // Storage eviction takes the file records; the state record is small
    // enough to survive, so the two can disagree.
    const a = live('a.jpg');
    const state = stateFor([a]);

    const restored = await restore('ev', fakeStore({}, state));
    expect(restored!.stale).toHaveLength(1);
  });

  it('has nothing to resume when the last tab finished', async () => {
    const state = stateFor([live('a.jpg')], { status: 'done' });
    const store = fakeStore(handles, state);

    expect(await restore('ev', store)).toBeNull();
    expect(store.clear, 'and tidies up after itself').toHaveBeenCalledWith('ev');
  });

  it('has nothing to resume when the state is gone or too old', async () => {
    expect(await restore('ev', fakeStore(handles, null))).toBeNull();
  });

  it('does not re-check items already known to be stale', async () => {
    const state = stateFor([live('a.jpg')], { status: 'stale' });
    const store = fakeStore(handles, state);

    expect(await restore('ev', store)).toBeNull();
    expect(store.getFile).not.toHaveBeenCalled();
  });

  it('finishes a batch the previous tab left half-sent', async () => {
    const a = live('a.jpg');
    const b = live('b.jpg');
    const state = stateFor([a, b]);
    state.items[0]!.status = 'done';
    handles[state.items[1]!.id] = b;

    const restored = await restore('ev', fakeStore(handles, state), {
      fetch: happyFetch() as any,
    });
    await restored!.queue.run();

    expect(restored!.queue.doneCount, 'the finished one is not sent twice').toBe(2);
  });
});

/**
 * The hook that decides whether a resume happens at all.
 *
 * Asserted against the source, which is a proxy and worth naming as one: the
 * repository has no React renderer, and what this protects is a two-line
 * interaction between a `useRef` guard and an effect cleanup.
 *
 * It is worth pinning anyway, because the bug it replaces was invisible in the
 * one place anybody would look for it. The guard exists because effects run
 * twice in development and driving a queue twice is not harmless — but without
 * releasing it in the cleanup the two development invocations cancelled each
 * other out exactly: the first claimed the flag and was told to stop at its
 * first `await`, the second returned because the flag was taken. So resuming
 * never happened in `next dev`, and only in `next dev`.
 */
describe('resuming survives an effect that runs twice', () => {
  const hook = readFileSync(
    fileURLToPath(new URL('../app/components/useUploads.ts', import.meta.url)),
    'utf8',
  );

  it('claims the guard before the first await', () => {
    // Otherwise both invocations get past it and both drive the queue.
    const effect = hook.slice(hook.indexOf('if (started.current) return;'));
    expect(effect.indexOf('started.current = true')).toBeLessThan(
      effect.indexOf('await UploadStore.open()'),
    );
  });

  it('releases it when the effect is torn down', () => {
    expect(hook).toMatch(/cancelled = true;\s*started\.current = false;/);
  });

  it('still refuses to act on a cancelled run', () => {
    // The flag being released is only safe because the cancelled invocation
    // checks before it touches anything.
    expect(hook).toMatch(/if \(cancelled\) return;/);
    expect(hook).toMatch(/if \(cancelled \|\| !restored\) return;/);
  });
});

describe('re-picking a stale file', () => {
  it('replaces the dead entry rather than being deduped away', async () => {
    // Without `forget`, the queue recognises the source it already has and
    // silently drops the file someone just chose again — the worst outcome,
    // because the UI asked for it and nothing happens.
    const file = live('a.jpg');
    const described = describeFile('ev', file);
    const queue = new UploadQueue(
      browserDeps({
        eventId: 'ev',
        store: fakeStore(handles, null),
        files: new Map(),
      }),
      { items: [{ ...described.item, eventId: 'ev', status: 'stale', attempts: 1 }] },
    );

    queue.forget([described.source]);
    queue.add('ev', [described.item]);

    expect(queue.state.items).toHaveLength(1);
    expect(queue.state.items[0]!.status).toBe('pending');
    expect(queue.state.items[0]!.attempts, 'a clean slate, not a fourth try').toBe(0);
  });
});
