/**
 * ZIP correctness — docs/design.md §16.4.
 *
 * "Zip64 and filename encoding are where homegrown zip writers fail, and they
 * fail on the user's machine, after a twenty-minute download." So nothing here
 * is checked by a reader written alongside the writer, which would only prove
 * the two agree. Every archive is validated by Python's `zipfile` and by the
 * `unzip` CLI — two independent implementations that also verify CRCs.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  archiveEntryName,
  planArchive,
  streamArchive,
  ZipError,
  type ZipEntry,
} from '../src/index';

const run = promisify(execFile);
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zip-test-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

// --- helpers ---------------------------------------------------------------

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type Member = { name: string; bytes: Uint8Array; modified?: Date };

function member(name: string, content: string, modified?: Date): Member {
  return { name, bytes: new TextEncoder().encode(content), modified };
}

function toEntries(members: Member[]): ZipEntry[] {
  return members.map((m) => ({
    name: m.name,
    size: m.bytes.byteLength,
    crc32: crc32(m.bytes),
    modified: m.modified ?? new Date('2026-07-18T21:14:06Z'),
  }));
}

async function build(
  members: Member[],
  options: { forceZip64?: boolean } = {},
): Promise<{ bytes: Buffer; planned: number }> {
  const plan = planArchive(toEntries(members), options);
  const stream = streamArchive(plan, async (i) => {
    const bytes = members[i]!.bytes;
    return new ReadableStream<Uint8Array>({
      start(c) {
        // Deliberately chunked, so the writer cannot assume one read per member.
        for (let at = 0; at < bytes.length; at += 7) {
          c.enqueue(bytes.subarray(at, Math.min(at + 7, bytes.length)));
        }
        c.close();
      },
    });
  });

  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return { bytes: Buffer.concat(chunks), planned: plan.totalBytes };
}

/** Validates with Python's zipfile: structure, names, contents and CRCs. */
async function inspect(bytes: Buffer, label: string) {
  const path = join(dir, `${label}.zip`);
  await writeFile(path, bytes);
  const script = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    bad = z.testzip()
    print(json.dumps({
        "bad": bad,
        "names": z.namelist(),
        "sizes": [i.file_size for i in z.infolist()],
        "compress": sorted({i.compress_type for i in z.infolist()}),
        "contents": {n: z.read(n).decode("utf-8", "replace") for n in z.namelist()},
        "utf8_flag": [bool(i.flag_bits & 0x800) for i in z.infolist()],
        "dates": [list(i.date_time) for i in z.infolist()],
    }))
`;
  const { stdout } = await run('python3', ['-c', script, path]);
  return { path, ...(JSON.parse(stdout) as any) };
}

// --- tests -----------------------------------------------------------------

describe('archives real tools accept', () => {
  it('round-trips through Python zipfile with correct CRCs', async () => {
    const members = [
      member('0001.txt', 'first photo stand-in'),
      member('0002.txt', ''), // empty member: a classic off-by-one
      member('0003.txt', 'x'.repeat(5000)),
    ];
    const { bytes } = await build(members);
    const out = await inspect(bytes, 'basic');

    expect(out.bad, 'testzip() reports the first corrupt member').toBeNull();
    expect(out.names).toEqual(['0001.txt', '0002.txt', '0003.txt']);
    expect(out.sizes).toEqual([20, 0, 5000]);
    expect(out.compress, 'STORE only').toEqual([0]);
    expect(out.contents['0001.txt']).toBe('first photo stand-in');
    expect(out.contents['0003.txt']).toHaveLength(5000);
  });

  it('is accepted by the unzip CLI too', async () => {
    // A second, independent implementation. `unzip -t` verifies every CRC.
    const { bytes } = await build([
      member('a.txt', 'alpha'),
      member('b.txt', 'beta'),
    ]);
    const path = join(dir, 'cli.zip');
    await writeFile(path, bytes);
    const { stdout } = await run('unzip', ['-t', path]);
    expect(stdout).toMatch(/No errors detected/);
  });

  it('extracts to bytes identical to the input', async () => {
    const payload = Buffer.from(
      Array.from({ length: 20000 }, (_, i) => i % 251),
    );
    const plan = planArchive([
      { name: 'blob.bin', size: payload.length, crc32: crc32(payload), modified: new Date() },
    ]);
    const stream = streamArchive(plan, async () =>
      new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(payload); c.close(); },
      }),
    );
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) { const r = await reader.read(); if (r.done) break; chunks.push(r.value); }

    const path = join(dir, 'blob.zip');
    await writeFile(path, Buffer.concat(chunks));
    await run('unzip', ['-o', '-q', path, '-d', join(dir, 'out')]);
    const extracted = await readFile(join(dir, 'out', 'blob.bin'));
    expect(createHash('sha256').update(extracted).digest('hex')).toBe(
      createHash('sha256').update(payload).digest('hex'),
    );
  });
});

describe('Content-Length is exact', () => {
  it('matches the streamed length, which is the whole point', async () => {
    const { bytes, planned } = await build([
      member('one.txt', 'a'),
      member('two.txt', 'bb'),
      member('three.txt', 'ccc'),
    ]);
    expect(bytes.byteLength).toBe(planned);
  });

  it('matches across many random shapes', async () => {
    // A wrong length is worse than no length: the browser either hangs waiting
    // for bytes that never come, or truncates the archive.
    for (let round = 0; round < 40; round++) {
      const count = 1 + ((round * 7) % 9);
      const members = Array.from({ length: count }, (_, i) =>
        member(`f${round}-${i}.txt`, 'z'.repeat((round * 13 + i * 29) % 400)),
      );
      const { bytes, planned } = await build(members);
      expect(bytes.byteLength, `round ${round}`).toBe(planned);
    }
  });

  it('is exact for an empty selection', async () => {
    const { bytes, planned } = await build([]);
    expect(bytes.byteLength).toBe(planned);
    const out = await inspect(bytes, 'empty');
    expect(out.names).toEqual([]);
  });

  it('is exact with Zip64 fields on every entry', async () => {
    const { bytes, planned } = await build(
      [member('a.txt', 'alpha'), member('b.txt', 'beta')],
      { forceZip64: true },
    );
    expect(bytes.byteLength).toBe(planned);
  });
});

describe('Zip64', () => {
  it('produces archives readers still accept when forced on', async () => {
    // Exercises the 64-bit encoding path for real without materialising 4GB.
    const members = [member('big1.txt', 'x'.repeat(1000)), member('big2.txt', 'y')];
    const { bytes } = await build(members, { forceZip64: true });

    const out = await inspect(bytes, 'zip64');
    expect(out.bad).toBeNull();
    expect(out.names).toEqual(['big1.txt', 'big2.txt']);
    expect(out.contents['big2.txt']).toBe('y');

    const path = join(dir, 'zip64cli.zip');
    await writeFile(path, bytes);
    expect((await run('unzip', ['-t', path])).stdout).toMatch(/No errors detected/);
  });

  it('emits the Zip64 end records unconditionally', async () => {
    // No format switch under load: the largest downloads are the least
    // reproducible, so the layout must not depend on how big the event got.
    const { bytes } = await build([member('a.txt', 'a')]);
    expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])), 'zip64 EOCD').toBe(true);
    expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x07])), 'zip64 locator').toBe(true);
    expect(bytes.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])), 'classic EOCD').toBe(true);
  });

  it('plans 64-bit offsets past 4GB without reading anything', async () => {
    const huge = 3_000_000_000;
    const plan = planArchive([
      { name: 'a.bin', size: huge, crc32: 0, modified: new Date() },
      { name: 'b.bin', size: huge, crc32: 0, modified: new Date() },
      { name: 'c.bin', size: 10, crc32: 0, modified: new Date() },
    ]);
    // First two fit under 4GB individually; the third starts beyond it.
    expect(plan.entries[0]!.zip64Offset).toBe(false);
    expect(plan.entries[2]!.zip64Offset).toBe(true);
    expect(plan.totalBytes).toBeGreaterThan(6_000_000_000);
    expect(Number.isSafeInteger(plan.totalBytes)).toBe(true);
  });
});

describe('filenames', () => {
  it('handles unicode, and flags it as UTF-8', async () => {
    const members = [
      member('café.txt', 'accented'),
      member('日本語.txt', 'japanese'),
      member('emoji-🎉.txt', 'party'),
      member('with space and (parens).txt', 'awkward'),
    ];
    const { bytes } = await build(members);
    const out = await inspect(bytes, 'unicode');

    expect(out.bad).toBeNull();
    expect(out.names).toEqual(members.map((m) => m.name));
    expect(out.utf8_flag.every(Boolean), 'bit 11 set on every entry').toBe(true);
    expect(out.contents['日本語.txt']).toBe('japanese');
    expect(out.contents['emoji-🎉.txt']).toBe('party');
  });

  it('refuses duplicate names instead of silently losing a file', async () => {
    expect(() =>
      planArchive(toEntries([member('same.jpg', 'a'), member('same.jpg', 'b')])),
    ).toThrow(ZipError);
  });

  it('generates sortable, collision-free names', () => {
    const at = new Date('2026-07-18T21:14:07Z');
    expect(archiveEntryName(0, at, 'image/heic')).toBe('0001_20260718211407.heic');
    expect(archiveEntryName(41, at, 'image/jpeg')).toBe('0042_20260718211407.jpg');
    expect(archiveEntryName(0, at, 'video/quicktime')).toBe('0001_20260718211407.mov');
    // Two photos taken in the same second still differ, because of the index.
    expect(archiveEntryName(1, at, 'image/jpeg')).not.toBe(
      archiveEntryName(2, at, 'image/jpeg'),
    );
  });
});

describe('timestamps', () => {
  it('records the capture time, rounded to DOS resolution', async () => {
    const { bytes } = await build([
      member('a.txt', 'a', new Date('2026-07-18T21:14:07Z')),
    ]);
    const out = await inspect(bytes, 'dates');
    // DOS timestamps have two-second resolution, so :07 stores as :06.
    expect(out.dates[0]).toEqual([2026, 7, 18, 21, 14, 6]);
  });

  it('does not emit an invalid date for pre-1980 timestamps', async () => {
    // The DOS epoch starts in 1980 and a negative year wraps into nonsense
    // that some extractors reject outright.
    const { bytes } = await build([member('a.txt', 'a', new Date('1970-01-01T00:00:00Z'))]);
    const out = await inspect(bytes, 'old-date');
    expect(out.bad).toBeNull();
    expect(out.dates[0]).toEqual([1980, 1, 1, 0, 0, 0]);
  });
});

describe('when a source lies about its size', () => {
  it('fails the stream rather than emitting a corrupt archive', async () => {
    const plan = planArchive([
      { name: 'a.txt', size: 100, crc32: 0, modified: new Date() },
    ]);
    const stream = streamArchive(plan, async () =>
      new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(new Uint8Array(5)); c.close(); }, // short
      }),
    );
    const reader = stream.getReader();
    await expect(
      (async () => { for (;;) { const r = await reader.read(); if (r.done) return; } })(),
    ).rejects.toThrow(/expected 100 bytes, got 5/);
  });

  it('stops a source that overruns', async () => {
    const plan = planArchive([
      { name: 'a.txt', size: 4, crc32: 0, modified: new Date() },
    ]);
    const stream = streamArchive(plan, async () =>
      new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(new Uint8Array(99)); c.close(); },
      }),
    );
    const reader = stream.getReader();
    await expect(
      (async () => { for (;;) { const r = await reader.read(); if (r.done) return; } })(),
    ).rejects.toThrow(/longer than planned/);
  });

  it('opens one member at a time, so memory stays flat', async () => {
    const members = Array.from({ length: 6 }, (_, i) => member(`f${i}.txt`, 'x'.repeat(50)));
    const plan = planArchive(toEntries(members));
    let concurrent = 0;
    let peak = 0;

    const stream = streamArchive(plan, async (i) => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      return new ReadableStream<Uint8Array>({
        start(c) { c.enqueue(members[i]!.bytes); c.close(); concurrent--; },
      });
    });
    const reader = stream.getReader();
    for (;;) { const r = await reader.read(); if (r.done) break; }
    expect(peak).toBe(1);
  });
});
