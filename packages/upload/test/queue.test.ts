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
  MAX_REPRESIGN_ROUNDS,
  Offline,
  UploadQueue,
  type Deps,
  type QueueItem,
  type QueueState,
} from '../src/index';

function file(n: number) {
  return {
    id: `local-${n}`,
    source: `file:///photo-${n}.heic`,
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
      uploaded.push(item.source);
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
        first.uploaded.push(item.source);
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
        if (item.source.includes('photo-2')) throw new Error('nope');
        h.uploaded.push(item.source);
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
        h.uploaded.push(item.source);
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1), file(2)]);
    await Promise.all([queue.run(), queue.run()]);
    expect(h.uploaded).toHaveLength(2);
  });
});

describe('a venue with no signal', () => {
  /**
   * Design §1's table promises "offline queueing at a bad-signal venue" as a
   * thing native has and the web does not. Before this it did the opposite:
   * four attempts spent in a few hundred milliseconds and two hundred photos
   * marked permanently failed, at precisely the moment the native client is
   * supposed to be earning its place.
   */
  function offlineDeps(overrides: Partial<Deps> = {}): { deps: Deps; attempts: () => number } {
    let calls = 0;
    return {
      attempts: () => calls,
      deps: {
        presign: async (_eventId, files) =>
          files.map((_f, i) => ({
            photoId: `p${i}`,
            url: `https://r2.test/${i}`,
            headers: {},
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
          })),
        upload: async () => {
          calls += 1;
          throw new Offline();
        },
        complete: async () => {},
        save: async () => {},
        ...overrides,
      },
    };
  }

  it('spends no attempts, because none were made', async () => {
    const { deps } = offlineDeps();
    const queue = new UploadQueue(deps);
    queue.add('ev', [file(1)]);

    await queue.run();

    expect(queue.failedCount).toBe(0);
    expect(queue.state.items[0]!.attempts).toBe(0);
    expect(queue.state.items[0]!.status).toBe('presigned');
  });

  it('says it is waiting rather than that it failed', async () => {
    // The two ask opposite things of a person: one is "try again", the other
    // is "wait, and do not do anything".
    const { deps } = offlineDeps();
    const queue = new UploadQueue(deps);
    queue.add('ev', [file(1)]);
    await queue.run();

    expect(queue.waitingForNetwork).toBe(true);
    expect(queue.state.items[0]!.error).toMatch(/connection/);
  });

  it('stops the whole batch at the first one, not per photo', async () => {
    // Two hundred photos each discovering the network is gone is two hundred
    // round trips into a wall, and on cellular it is two hundred timeouts.
    const { deps, attempts } = offlineDeps();
    const queue = new UploadQueue(deps);
    queue.add('ev', Array.from({ length: 50 }, (_, i) => file(i)));

    await queue.run();

    expect(attempts()).toBeLessThanOrEqual(CONCURRENCY);
    expect(queue.pendingCount).toBe(50);
  });

  it('picks up where it left off once there is a network', async () => {
    let online = false;
    const { deps } = offlineDeps({
      upload: async () => {
        if (!online) throw new Offline();
      },
    });
    const queue = new UploadQueue(deps);
    queue.add('ev', [file(1), file(2)]);

    await queue.run();
    expect(queue.doneCount).toBe(0);

    online = true;
    await queue.run();

    expect(queue.doneCount).toBe(2);
    expect(queue.waitingForNetwork).toBe(false);
  });

  it('leaves an ordinary failure alone', async () => {
    // The distinction has to survive: a rejected upload still consumes its
    // retries and still ends up failed.
    const queue = new UploadQueue({
      presign: async (_eventId, files) =>
        files.map((_f, i) => ({
          photoId: `p${i}`,
          url: `https://r2.test/${i}`,
          headers: {},
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        })),
      upload: async () => {
        throw new Error('upload failed: 500');
      },
      complete: async () => {},
      save: async () => {},
    });
    queue.add('ev', [file(1)]);

    for (let i = 0; i < MAX_ATTEMPTS; i++) await queue.run();

    expect(queue.failedCount).toBe(1);
    expect(queue.waitingForNetwork).toBe(false);
  });

  it('is not waiting once there is nothing left to send', async () => {
    const queue = new UploadQueue(offlineDeps().deps);
    expect(queue.waitingForNetwork).toBe(false);
  });
});

describe('a grant that is stale the moment it arrives', () => {
  /**
   * Found by writing the offline tests, and older than them.
   *
   * Re-presigning is the right answer to a grant that went stale while the
   * phone was locked, and the queue used to keep doing it until no item
   * needed one — which assumes the fresh grant is usable. A server handing
   * back an already-expired grant, or a device whose clock is wrong by more
   * than the expiry margin, made `run()` recurse forever: no attempt
   * consumed, no error raised, nothing logged, and on a phone it reads as the
   * upload having silently stopped.
   */
  it('gives up rather than spinning', async () => {
    let presigns = 0;
    const queue = new UploadQueue({
      presign: async (_eventId, files) => {
        presigns += 1;
        return files.map((_f, i) => ({
          photoId: `p${i}`,
          url: `https://r2.test/${i}`,
          headers: {},
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }));
      },
      upload: async () => {},
      complete: async () => {},
      save: async () => {},
    });
    queue.add('ev', [file(1)]);

    await queue.run();

    expect(presigns).toBe(MAX_REPRESIGN_ROUNDS + 1);
    // Left pending rather than failed: nothing is wrong with the photo, and
    // the next run may find a server that has stopped misbehaving.
    expect(queue.state.items[0]!.status).toBe('pending');
    expect(queue.failedCount).toBe(0);
  });

  it('still re-presigns once for the ordinary case', async () => {
    // The phone was locked and the grants went stale. One extra round is what
    // this whole mechanism exists for, and bounding it must not remove it.
    let presigns = 0;
    const queue = new UploadQueue({
      presign: async (_eventId, files) => {
        presigns += 1;
        return files.map((_f, i) => ({
          photoId: `p${i}`,
          url: `https://r2.test/${i}`,
          headers: {},
          expiresAt: new Date(
            Date.now() + (presigns === 1 ? -1000 : 900_000),
          ).toISOString(),
        }));
      },
      upload: async () => {},
      complete: async () => {},
      save: async () => {},
    });
    queue.add('ev', [file(1)]);

    await queue.run();

    expect(presigns).toBe(2);
    expect(queue.doneCount).toBe(1);
  });
});
