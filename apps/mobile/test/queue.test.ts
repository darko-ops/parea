/**
 * The upload queue's interruption behaviour — docs/design.md §7.5, §16.3.
 *
 * "Kill the client mid-queue and reopen it, asserting no duplicates and no
 * missing files." That is what most of this is. The queue is pure and takes
 * its platform through `Deps`, so a crash is just constructing a new queue
 * from the last persisted state.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  CONCURRENCY,
  MAX_ATTEMPTS,
  UploadQueue,
  type Deps,
  type QueueItem,
  type QueueState,
} from '../src/queue';

function file(n: number) {
  return {
    id: `local-${n}`,
    uri: `file:///photo-${n}.heic`,
    name: `IMG_${n}.heic`,
    size: 1000 + n,
    mime: 'image/heic',
  };
}

type Harness = {
  deps: Deps;
  saved: QueueState[];
  uploaded: string[];
  completed: string[];
  presignCalls: number;
};

function harness(overrides: Partial<Deps> = {}): Harness {
  const saved: QueueState[] = [];
  const uploaded: string[] = [];
  const completed: string[] = [];
  let presignCalls = 0;

  const deps: Deps = {
    async presign(_eventId, files) {
      presignCalls++;
      return files.map((f, i) => ({
        photoId: `photo-${f.name}-${i}`,
        url: `https://storage.example/put/${f.name}`,
        headers: { 'content-type': f.type },
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      }));
    },
    async upload(item) {
      uploaded.push(item.uri);
    },
    async complete(photoId) {
      completed.push(photoId);
    },
    async save(state) {
      // Deep copy, like real persistence — a shallow one would let later
      // mutations rewrite history and hide resume bugs.
      saved.push(JSON.parse(JSON.stringify(state)));
    },
    ...overrides,
  };

  return {
    deps,
    saved,
    uploaded,
    completed,
    get presignCalls() {
      return presignCalls;
    },
  } as Harness;
}

describe('the happy path', () => {
  it('presigns once, uploads each file, completes each', async () => {
    const h = harness();
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1), file(2), file(3)]);
    await queue.run();

    expect(h.presignCalls, 'one presign covers the batch').toBe(1);
    expect(h.uploaded).toHaveLength(3);
    expect(h.completed).toHaveLength(3);
    expect(queue.doneCount).toBe(3);
    expect(queue.pendingCount).toBe(0);
  });

  it('ignores the same asset queued twice', async () => {
    const h = harness();
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    queue.add('event-1', [file(1)]);
    await queue.run();
    expect(h.uploaded).toHaveLength(1);
  });

  it('persists after every transition', async () => {
    const h = harness();
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    await queue.run();
    // Presign, upload, complete, final — a resume can land anywhere in there.
    expect(h.saved.length).toBeGreaterThanOrEqual(3);
  });

  it('never runs more than the configured concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const h = harness({
      async upload() {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', Array.from({ length: 9 }, (_, i) => file(i)));
    await queue.run();
    expect(peak).toBeLessThanOrEqual(CONCURRENCY);
  });
});

describe('surviving a kill', () => {
  it('resumes from persisted state without duplicating completed work', async () => {
    // Die after the second upload, then reopen from what was on disk.
    let uploads = 0;
    const first = harness({
      async upload(item) {
        uploads++;
        if (uploads === 2) throw new Error('process died');
        first.uploaded.push(item.uri);
      },
    });
    const queueA = new UploadQueue(first.deps);
    queueA.add('event-1', [file(1), file(2), file(3)]);
    await queueA.run();

    const persisted = first.saved.at(-1)!;
    const second = harness();
    const queueB = new UploadQueue(second.deps, persisted);
    await queueB.run();

    const total = [...first.uploaded, ...second.uploaded];
    expect(new Set(total).size, 'no file uploaded twice').toBe(total.length);
    expect(queueB.doneCount + queueB.failedCount).toBe(3);
    expect(queueB.pendingCount).toBe(0);
  });

  it('loses nothing when the crash lands between upload and complete', async () => {
    // The nastiest window: bytes are in storage but the server has not been
    // told. Retrying must finish the job, not skip it.
    const first = harness({
      async complete() {
        throw new Error('killed before complete');
      },
    });
    const queueA = new UploadQueue(first.deps);
    queueA.add('event-1', [file(1)]);
    await queueA.run();

    const second = harness();
    const queueB = new UploadQueue(second.deps, first.saved.at(-1)!);
    await queueB.run();

    expect(queueB.doneCount).toBe(1);
    expect(second.completed).toHaveLength(1);
  });

  it('a resumed queue with nothing left to do is a no-op', async () => {
    const h = harness();
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    await queue.run();

    const again = harness();
    await new UploadQueue(again.deps, h.saved.at(-1)!).run();
    expect(again.uploaded).toHaveLength(0);
    expect(again.presignCalls).toBe(0);
  });
});

describe('expiring grants', () => {
  it('re-presigns rather than failing a URL that went stale', async () => {
    // What actually happens when someone locks their phone mid-batch.
    const state: QueueState = {
      items: [
        {
          ...file(1),
          eventId: 'event-1',
          status: 'presigned',
          attempts: 0,
          photoId: 'photo-1',
          uploadUrl: 'https://storage.example/expired',
          headers: {},
          expiresAt: Date.now() - 1000,
        } satisfies QueueItem,
      ],
    };

    const h = harness();
    const queue = new UploadQueue(h.deps, state);
    await queue.run();

    expect(h.presignCalls, 'stale grant is replaced, not retried').toBe(1);
    expect(h.uploaded).toHaveLength(1);
    expect(queue.doneCount).toBe(1);
  });

  it('treats a grant about to expire as already stale', async () => {
    const state: QueueState = {
      items: [
        {
          ...file(1),
          eventId: 'event-1',
          status: 'presigned',
          attempts: 0,
          photoId: 'photo-1',
          uploadUrl: 'https://storage.example/nearly',
          headers: {},
          // Inside the margin: uploading a 40MB file with 5s left would fail.
          expiresAt: Date.now() + 5_000,
        } satisfies QueueItem,
      ],
    };
    const h = harness();
    await new UploadQueue(h.deps, state).run();
    expect(h.presignCalls).toBe(1);
  });
});

describe('failure', () => {
  it('gives up on a file after repeated attempts, keeping the rest', async () => {
    const h = harness({
      async upload(item) {
        if (item.uri.includes('photo-2')) throw new Error('nope');
        h.uploaded.push(item.uri);
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1), file(2), file(3)]);

    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) await queue.run();

    expect(queue.failedCount).toBe(1);
    expect(queue.doneCount, 'a partial upload is partial photos, not zero').toBe(2);
    expect(queue.pendingCount).toBe(0);
  });

  it('records why a file failed', async () => {
    const h = harness({
      async upload() {
        throw new Error('connection lost');
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    for (let i = 0; i < MAX_ATTEMPTS; i++) await queue.run();
    expect(queue.state.items[0]!.error).toMatch(/connection lost/);
  });

  it('fails the batch cleanly when presign itself fails', async () => {
    const h = harness({
      async presign() {
        throw new Error('offline');
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1), file(2)]);
    await queue.run();
    // Still pending, not failed: offline is a retry-later, not a give-up.
    expect(queue.pendingCount).toBe(2);
    expect(queue.state.items.every((i) => i.attempts === 1)).toBe(true);
  });
});

describe('housekeeping', () => {
  it('prunes finished items so a long-lived queue does not grow', async () => {
    const h = harness();
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1), file(2)]);
    await queue.run();
    queue.prune();
    expect(queue.state.items).toHaveLength(0);
  });

  it('will not run twice concurrently', async () => {
    const h = harness({
      async upload(item) {
        await new Promise((r) => setTimeout(r, 10));
        h.uploaded.push(item.uri);
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1), file(2)]);
    await Promise.all([queue.run(), queue.run()]);
    expect(h.uploaded).toHaveLength(2);
  });
});
