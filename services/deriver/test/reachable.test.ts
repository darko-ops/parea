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

import { mkdtemp, rm } from 'node:fs/promises';
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
     */
    const store = new LocalObjectStore('/proc/cannot/write/here');
    const answer = await store.reachable();
    expect(answer.ok).toBe(false);
    expect(answer.detail).toMatch(/^FAILED/);
  });
});
