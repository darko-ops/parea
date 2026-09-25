/**
 * The check that would have caught a credential nobody typed.
 *
 * Both R2 secrets were once set to a three-byte ellipsis, pasted out of an
 * example, and every layer reported success: `flyctl` said the update
 * succeeded, Fly said the machine was healthy, and the boot probe printed
 * "Ready to ingest". It verified codecs, exiftool, AVIF and the scanner, and
 * never touched storage. The first thing that would have noticed was a
 * photograph failing to appear, with its row left `pending` and nobody told —
 * which is this product's worst failure shape and the one the probe exists to
 * prevent.
 *
 * The R2 half is measured against a live bucket rather than asserted here, for
 * the reason the sibling tests give: a mock would prove the mock. What it
 * found — good credentials answer 404 to a HEAD for a missing key, bad ones
 * answer 401, and a non-ASCII secret never reaches the network because the SDK
 * refuses to sign it — is written into `reachable()` where the branches are.
 *
 * What is testable without a bucket is the local store, which is the one a
 * developer machine and the image build actually use, and the shape of the
 * contract.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalObjectStore } from '../src/objects';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reachable-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('a store says whether it can be used', () => {
  it('reports a writable directory as reachable', async () => {
    const store = new LocalObjectStore(dir);
    const answer = await store.reachable();
    expect(answer.ok).toBe(true);
    expect(answer.detail).toContain(dir);
  });

  it('creates the root if it is missing rather than failing', async () => {
    // `npm run dev` on a clean checkout has no `.storage` yet, and a probe
    // that failed there would teach people to ignore it.
    const store = new LocalObjectStore(join(dir, 'not', 'yet'));
    expect((await store.reachable()).ok).toBe(true);
  });

  it('leaves nothing behind', async () => {
    const store = new LocalObjectStore(dir);
    await store.reachable();
    await store.reachable();
    // The probe key is a fresh UUID each time and is removed after the write;
    // a store that accumulated them would be a probe that litters production.
    const { readdir } = await import('node:fs/promises');
    const probes = await readdir(join(dir, '.probe')).catch(() => []);
    expect(probes).toEqual([]);
  });

  it('reports a failure rather than throwing', async () => {
    /*
     * The contract the boot probe depends on. `probe()` prints a table and
     * returns an exit code; a store that threw would skip the table entirely
     * and lose the other nine answers with it.
     *
     * The unwritable root is a directory path *underneath a regular file*,
     * which is `ENOTDIR` on every POSIX system and fails immediately. The
     * first version of this used `/proc/cannot/write/here`, which is unwritable
     * on Linux and simply absent on macOS — so it failed fast on a laptop,
     * passed the suite, and then hung for the full 30-second timeout on CI.
     * A test that depends on which kernel is underneath is a test that only
     * works where it was written.
     */
    const blocker = join(dir, 'a-file-not-a-directory');
    await writeFile(blocker, 'x');

    const store = new LocalObjectStore(join(blocker, 'root'));
    const answer = await store.reachable();
    expect(answer.ok).toBe(false);
    expect(answer.detail).toMatch(/^FAILED/);
  });
});

/**
 * Which commands refuse to start, and the one that did not.
 *
 * `index.ts` carries the sentence "refuse to start rather than fail one photo
 * at a time" next to a probe call, and that call guards `watch` — the command
 * production stopped using when ingest moved to QStash. `serve` returns from
 * its own block well before reaching it, so the guarantee the sentence
 * describes had never applied to the deployed path.
 *
 * Nothing caught it because the `serve` block already refuses to start twice
 * over — a missing signing key, a missing public URL — which reads like a
 * block that knows how to do this. It checked everything about the request it
 * would receive and nothing about the machine's ability to answer it.
 *
 * Asserted on the source rather than by booting, because what is being pinned
 * is that the call is *in that branch*. A behavioural test would need a real
 * QStash key and a real R2 bucket to distinguish the two arrangements, and it
 * would still pass against a `serve` that probed after binding the port.
 */
describe('refusing to start', () => {
  const read = async () =>
    (await import('node:fs/promises')).readFile(
      new URL('../src/index.ts', import.meta.url),
      'utf8',
    );

  it('probes before serve creates its server', async () => {
    const source = await read();
    const block = source.slice(
      source.indexOf("if (command === 'serve')"),
      source.indexOf('createJobServer({'),
    );
    expect(block, "serve must probe before it listens").toMatch(
      /await probe\(scanner, moderator\)/,
    );
  });

  it('exits rather than continuing when the probe fails', async () => {
    const source = await read();
    const block = source.slice(
      source.indexOf("if (command === 'serve')"),
      source.indexOf('createJobServer({'),
    );
    // A probe whose result is read and discarded is a probe that reports.
    expect(block).toMatch(/if \(\(await probe\(scanner, moderator\)\) !== 0\) process\.exit\(1\)/);
  });

  it('still probes on the polling path', async () => {
    // `watch` is development's command and had this all along; the point is
    // that both paths refuse, not that one was moved to the other.
    const source = await read();
    const calls = source.match(/if \(\(await probe\(scanner, moderator\)\) !== 0\) process\.exit\(1\)/g);
    expect(calls ?? []).toHaveLength(2);
  });
});

/**
 * What the failure actually says.
 *
 * The first version of `reachable()` branched on 401 and 403 and printed
 * `err.message` for anything else. The AWS SDK collapses every R2 rejection
 * into `name: 'Unknown'`, `message: 'UnknownError'`, so the branch that fired
 * in the real incident — a credential R2 could not parse, which is **400**, not
 * 401 — produced `FAILED — UnknownError`. The check correctly refused to start
 * the container and then told whoever was reading the log nothing at all.
 *
 * Measured against the live bucket: a placeholder credential answers 400 and a
 * well-formed but wrong one answers 401, and both carry no usable message. So
 * the status is the signal, and it is now always in the sentence.
 */
describe('what a storage failure says', () => {
  const fail = async (status: number | undefined) => {
    const { R2ObjectStore } = await import('../src/objects');
    const store = new R2ObjectStore('parea', {
      accountId: 'x',
      accessKeyId: 'x',
      secretAccessKey: 'x',
    });
    // Stand in for the SDK's shape: no useful name, no useful message, and the
    // status the only thing that distinguishes one cause from another.
    const err = Object.assign(new Error('UnknownError'), {
      name: 'Unknown',
      $metadata: status === undefined ? {} : { httpStatusCode: status },
    });
    (store as unknown as { client: { send: () => Promise<never> } }).client = {
      send: () => Promise.reject(err),
    };
    return store.reachable();
  };

  it('names a malformed credential, which answers 400 rather than 401', async () => {
    const answer = await fail(400);
    expect(answer.ok).toBe(false);
    expect(answer.detail).toContain('HTTP 400');
    expect(answer.detail).toMatch(/malformed|placeholder/);
    expect(answer.detail).toContain('R2_ACCESS_KEY_ID');
  });

  it('names a rejected credential', async () => {
    const answer = await fail(401);
    expect(answer.detail).toContain('HTTP 401');
    expect(answer.detail).toContain('R2_SECRET_ACCESS_KEY');
  });

  it('never reports UnknownError on its own', async () => {
    // The whole point. An unrecognised status still carries the number.
    for (const status of [400, 401, 403, 500, undefined]) {
      const answer = await fail(status);
      expect(answer.detail).not.toBe('FAILED — UnknownError');
      expect(answer.detail, `status ${status}`).toMatch(/HTTP \d{3}|no response/);
    }
  });
});
