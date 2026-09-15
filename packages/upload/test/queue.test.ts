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
  RETRY_BACKOFF_MS,
  SourceGone,
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
    // A run now spends its whole retry budget before it returns, and the waits
    // between attempts are real seconds on a phone. Nothing here is testing
    // `setTimeout`, so they are taken instantly.
    async sleep() {},
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
    // One file the server will not take, in a batch of three. It spends its
    // attempts and goes to disk `failed`; reopening from that must not redo the
    // two that worked, and must not lose them either.
    const first = harness({
      async upload(item) {
        if (item.source.includes('photo-2')) throw new Error('process died');
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
    /*
     * The nastiest window, and the state on disk inside it says `uploaded`:
     * the bytes are in storage and the server has not been told.
     *
     * That state used to be a dead end. `run` looked at `pending` items and at
     * `presigned` ones, and `uploaded` is neither — so the photograph sat in
     * the saved queue forever, counted as outstanding by every progress bar,
     * and reached the album only when the deriver gave up waiting half an hour
     * later and read the object anyway. This resumes from the snapshot a crash
     * actually leaves rather than from the one after the failure was recorded,
     * which is what let that go unnoticed.
     */
    const first = harness({
      async complete() {
        throw new Error('killed before complete');
      },
    });
    const queueA = new UploadQueue(first.deps);
    queueA.add('event-1', [file(1)]);
    await queueA.run();

    const crashed = first.saved.find((s) => s.items[0]!.status === 'uploaded');
    expect(crashed, 'the window is persisted at all').toBeDefined();

    const second = harness();
    const queueB = new UploadQueue(second.deps, crashed!);
    await queueB.run();

    expect(queueB.doneCount).toBe(1);
    expect(second.completed).toHaveLength(1);
    // The confirmation is what was outstanding, so that is all that was sent.
    expect(second.uploaded, 'the bytes are not sent a second time').toHaveLength(0);
    expect(second.presignCalls, 'nor is a second row reserved for them').toBe(0);
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

    await queue.run();

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
    await queue.run();
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
    /*
     * Spent its attempts and stopped, rather than stopping after one.
     *
     * A `presign` that throws a plain `Error` is an ordinary failure — the
     * platform layer throws `Offline` when it means a missing network, and
     * that path is tested below and still consumes nothing. So this ends
     * `failed`, which is the state with a remedy attached: the clients caption
     * it "2 didn't upload" and put a "Try again" under it. It used to end
     * `pending` with three attempts unspent and nothing watching, which no
     * screen has a way to report and no person has a way to resolve.
     */
    expect(queue.failedCount).toBe(2);
    expect(queue.pendingCount).toBe(0);
    expect(queue.state.items.every((i) => i.attempts === MAX_ATTEMPTS)).toBe(true);
  });
});

/**
 * Eight photographs chosen, four in the album, and nothing said about it.
 *
 * `MAX_ATTEMPTS` reads like four tries and used to buy exactly one. `run` went
 * round again only for grants that had gone stale; an item that failed for any
 * other reason went back to `pending` with its attempts unspent, and the loop
 * stopped. Nothing picked it up, because nothing calls `run` a second time —
 * both clients call it once per batch and neither watches for leftovers — so
 * the photograph waited for somebody to reopen the album.
 *
 * And it waited silently, which is the worse half. `pending` with attempts to
 * spare is not `failed`, so no count reported it; the run was not `paused`, so
 * it was not waiting for a network either. The phone's status line computed
 * "nothing to say", cleared itself, and emptied the bar. Half a batch was
 * missing with no error, no count, and no button.
 */
describe('spending the attempts it says it has', () => {
  it('retries inside one run, so a blip does not cost a photograph', async () => {
    // One transient failure each, of the kind that is over by the next try.
    const flaked = new Set<string>();
    const h = harness({
      async upload(item) {
        if (!flaked.has(item.id)) {
          flaked.add(item.id);
          throw new Error('upload failed: 503');
        }
        h.uploaded.push(item.source);
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', Array.from({ length: 8 }, (_, i) => file(i)));

    await queue.run();

    expect(queue.doneCount, 'all eight, not the four that got lucky').toBe(8);
    expect(queue.pendingCount).toBe(0);
    expect(queue.failedCount).toBe(0);
  });

  it('waits between attempts rather than racing the same failure', async () => {
    const waits: number[] = [];
    const h = harness({
      async upload() {
        throw new Error('upload failed: 500');
      },
      async sleep(ms) {
        waits.push(ms);
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);

    await queue.run();

    // One wait before each attempt after the first, widening: a blip is waited
    // out rather than raced, and four tries in a few hundred milliseconds
    // against one bad second is how a whole batch used to be lost at once.
    expect(waits).toEqual([
      RETRY_BACKOFF_MS,
      RETRY_BACKOFF_MS * 2,
      RETRY_BACKOFF_MS * 3,
    ]);
    expect(queue.state.items[0]!.attempts).toBe(MAX_ATTEMPTS);
  });

  it('ends with something a screen can report, not silence', async () => {
    /*
     * The contract the clients read. `failed` has a sentence and a button
     * behind it; `pending` after a finished run has neither, and that is the
     * state this used to stop in.
     */
    const h = harness({
      async upload() {
        throw new Error('upload failed: 500');
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1), file(2)]);

    await queue.run();

    expect(queue.failedIn('event-1')).toHaveLength(2);
    expect(queue.pendingIn('event-1'), 'nothing left in a state nobody reads').toBe(0);
    expect(queue.waitingFor('event-1'), 'and not blamed on the network').toBe(false);
  });

  it('still leaves an offline batch alone', async () => {
    // The one failure that must not spend anything. Retrying inside the run
    // would be a tight loop against a network that is not there, which is the
    // thing the pause exists to prevent.
    let tries = 0;
    const h = harness({
      async upload() {
        tries += 1;
        throw new Offline();
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1), file(2), file(3)]);

    await queue.run();

    expect(tries).toBeLessThanOrEqual(CONCURRENCY);
    expect(queue.pendingCount).toBe(3);
    expect(queue.state.items.every((i) => i.attempts === 0)).toBe(true);
    expect(queue.waitingForNetwork).toBe(true);
  });

  it('does not re-send bytes that are already up', async () => {
    // A `complete` that flakes is a confirmation to send again, not a
    // photograph. Going back through `pending` would presign a second row and
    // PUT the same object beside the first, against the event's own quota.
    let completes = 0;
    const h = harness({
      async complete(photoId) {
        completes += 1;
        if (completes === 1) throw new Error('complete failed: 502');
        h.completed.push(photoId);
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);

    await queue.run();

    expect(queue.doneCount).toBe(1);
    expect(h.uploaded, 'one PUT, not two').toHaveLength(1);
    expect(h.presignCalls, 'one row reserved, not two').toBe(1);
  });
});

/**
 * A failure is terminal, and terminal is not the same as permanent.
 *
 * `failed` has to be an end state — a queue that retried forever would sit in
 * a pocket burning a battery on a file the server keeps refusing. But nothing
 * but `done` is ever pruned, so a failure outlives every later run, and until
 * these two there was no way back from one at all: four attempts against a
 * condition that has since changed were the end of the photograph.
 *
 * The counts also answered the wrong question. They are the whole queue's,
 * which is right for a screen about the queue and wrong for a screen about an
 * album — one album's screen was captioning a perfectly good upload with six
 * failures belonging to another.
 */
describe('coming back from a failure', () => {
  const exhaust = async (queue: UploadQueue) => {
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) await queue.run();
  };

  it('spends a fresh set of attempts when somebody asks', async () => {
    let working = false;
    const h = harness({
      async upload(item) {
        if (!working) throw new Error('nope');
        h.uploaded.push(item.source);
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    await exhaust(queue);
    expect(queue.failedCount).toBe(1);

    // The condition that made it fail is gone — a fixed build, a network that
    // came back, a source that can be copied out of the library again. The
    // press is the new information.
    working = true;
    expect(queue.retryFailed()).toBe(1);
    await queue.run();

    expect(queue.doneCount).toBe(1);
    expect(queue.failedCount).toBe(0);
  });

  it('puts the attempts back to zero, not up by one', async () => {
    // The count exists to stop an unattended loop. This run is not unattended,
    // and leaving it at the cap would buy a single attempt and then the same
    // dead line on the screen.
    const h = harness({
      async upload() {
        throw new Error('nope');
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    await exhaust(queue);

    queue.retryFailed();
    expect(queue.state.items[0]!.attempts).toBe(0);
    expect(queue.state.items[0]!.status).toBe('pending');
  });

  it('leaves a stale item alone, because its bytes are gone', async () => {
    // Another four attempts would find them just as gone. `forget` is the
    // remedy there, and the screen says to pick the photograph again.
    const h = harness({
      async upload() {
        throw new SourceGone('the copy is not there');
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    await queue.run();
    expect(queue.staleItems).toHaveLength(1);

    expect(queue.retryFailed()).toBe(0);
    expect(queue.staleItems).toHaveLength(1);
  });

  it('can be asked about one album at a time', async () => {
    const h = harness({
      async upload(item) {
        if (item.eventId === 'event-1') throw new Error('nope');
        h.uploaded.push(item.source);
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    queue.add('event-2', [file(2)]);
    await exhaust(queue);

    expect(queue.failedIn('event-1')).toHaveLength(1);
    expect(queue.failedIn('event-2')).toHaveLength(0);
    // And the global count is still the global count: the screen that is about
    // the queue rather than about an album has not changed.
    expect(queue.failedCount).toBe(1);

    // Retrying one album does not wake another's failures.
    queue.add('event-3', [file(3)]);
    expect(queue.retryFailed('event-2')).toBe(0);
    expect(queue.failedIn('event-1')).toHaveLength(1);
  });
});

/**
 * Working one album's photographs and leaving the rest alone.
 *
 * The queue holds work for every album a device has uploaded into, and working
 * all of it is right for a client that can act for any album at any time. The
 * phone is not that client: it presigns and completes with the link token of
 * the album on screen, so a leftover item belonging to another album went up
 * with the wrong credential and was refused — a failure invented by the queue
 * being more capable than its caller.
 */
describe('running one album at a time', () => {
  it('touches only the album it was given', async () => {
    const h = harness();
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    queue.add('event-2', [file(2)]);

    await queue.run('event-1');

    expect(h.uploaded).toHaveLength(1);
    expect(h.uploaded[0]).toContain('photo-1');
    expect(queue.doneIn('event-1')).toBe(1);
    // Untouched, not failed: it has not been tried, so it has nothing to
    // recover from.
    expect(queue.pendingIn('event-2')).toBe(1);
    expect(queue.failedIn('event-2')).toHaveLength(0);
  });

  it('does not presign for an album it is not working', async () => {
    // The presign carries the credential. Asking for a grant on somebody
    // else's evening is the request that comes back refused.
    const asked: string[] = [];
    const h = harness({
      async presign(eventId, files) {
        asked.push(eventId);
        return files.map((f, i) => ({
          photoId: `photo-${f.name}-${i}`,
          url: `https://storage.example/put/${f.name}`,
          headers: {},
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }));
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    queue.add('event-2', [file(2)]);

    await queue.run('event-1');

    expect(asked).toEqual(['event-1']);
  });

  it('keeps the other album’s work in the saved state', async () => {
    /*
     * The load-bearing half. Every run writes the whole state back, so a queue
     * that had merely been *filtered* on the way in would erase the other
     * album's items the first time this one saved. They are still there, and
     * they go up when somebody opens the album they belong to.
     */
    const h = harness();
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    queue.add('event-2', [file(2)]);

    await queue.run('event-1');
    queue.prune();

    const saved = h.saved[h.saved.length - 1]!;
    expect(saved.items.map((i) => i.eventId)).toContain('event-2');

    // And a later run in that album finishes the job.
    await queue.run('event-2');
    expect(h.uploaded).toHaveLength(2);
  });

  it('still works everything when nobody scopes it', async () => {
    // The browser client acts for any album it has a session for, and this is
    // the behaviour it has always had.
    const h = harness();
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    queue.add('event-2', [file(2)]);

    await queue.run();

    expect(h.uploaded).toHaveLength(2);
  });

  it('is not waiting for a connection on behalf of another album', async () => {
    /*
     * `waitingForNetwork` is true whenever anything anywhere is pending after a
     * pause. On a screen about one album that reads as "your photographs are
     * waiting for a signal" when the thing waiting is a different evening.
     */
    const h = harness({
      async upload() {
        throw new Offline('no signal');
      },
    });
    const queue = new UploadQueue(h.deps);
    queue.add('event-1', [file(1)]);
    queue.add('event-2', [file(2)]);

    await queue.run('event-1');

    expect(queue.waitingFor('event-1')).toBe(true);
    expect(queue.waitingFor('event-2')).toBe(false);
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
        sleep: async () => {},
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
      sleep: async () => {},
    });
    queue.add('ev', [file(1)]);

    await queue.run();

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
