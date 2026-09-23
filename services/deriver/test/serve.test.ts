/**
 * Delivery, when the sender is allowed to send twice and the receiver is
 * allowed to die.
 *
 * QStash is at-least-once with a ten-minute deduplication window, so a photo
 * arriving twice is a designed-for event rather than an incident. And the
 * handler answers only when the work is finished, so a crash is simply a
 * request that never gets a response — which is the whole reason there is no
 * claim table, no claim expiry and no sweep.
 *
 * Both of those are claims about behaviour under conditions that are awkward
 * to reach by hand, which is what these check. The pipeline itself is covered
 * in `pipeline.test.ts`; this is about what the outside world is told.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocalObjectStore } from '../src/objects';
import { createHandler } from '../src/serve';

const run = promisify(execFile);
const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));

let db: any;
let dir: string;
let objects: LocalObjectStore;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  dir = await mkdtemp(join(tmpdir(), 'serve-test-'));
  objects = new LocalObjectStore(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "code", "derivative", "device", "event",
      "event_participant", "group_member", "groups", "photo", "report"
    restart identity cascade
  `);
});

async function jpeg(seed = 1): Promise<Buffer> {
  const base = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 17 * seed, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();
  const path = join(dir, `src-${seed}.jpg`);
  await writeFile(path, base);
  await run('exiftool', ['-overwrite_original', '-q', '-DateTimeOriginal=2026:07:18 21:14:07', path]);
  return readFile(path);
}

async function seedPhoto(bytes: Buffer) {
  const [actor] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: actor.id })
    .returning();
  const key = `ev/${event.id}/${crypto.randomUUID()}`;
  await objects.put(key, bytes);
  const [photo] = await db
    .insert(schema.photos)
    .values({
      eventId: event.id,
      uploaderId: actor.id,
      storageKey: key,
      byteSize: bytes.length,
      mime: 'image/jpeg',
      status: 'pending',
    })
    .returning();
  return photo;
}

const deps = () => ({ db, objects, scanner: null });

describe('the same photo delivered twice', () => {
  it('does the work once when the deliveries do not overlap', async () => {
    const photo = await seedPhoto(await jpeg(1));
    const handle = createHandler(deps());

    const first = await handle(photo.id);
    expect(first.status).toBe(200);

    /*
     * The second delivery is the ordinary case: QStash retried because an ack
     * was lost, or the ten-minute window passed. It must be answered 200 and
     * must not derive anything a second time — the guard for that lives in
     * `processPhoto`, which returns early on `ready`, and this is the test
     * that says the handler relies on it.
     */
    const before = await db
      .select()
      .from(schema.derivatives)
      .where(eq(schema.derivatives.photoId, photo.id));

    const second = await handle(photo.id);
    expect(second.status).toBe(200);

    const after = await db
      .select()
      .from(schema.derivatives)
      .where(eq(schema.derivatives.photoId, photo.id));
    expect(after.length).toBe(before.length);
  });

  it('refuses the overlapping one rather than deriving it twice', async () => {
    const photo = await seedPhoto(await jpeg(2));
    const handle = createHandler(deps());

    // Both in flight at once, which is what at-least-once delivery permits
    // and what an in-process guard exists for.
    const [a, b] = await Promise.all([handle(photo.id), handle(photo.id)]);

    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([200, 409]);

    // 409 is a "come back", so QStash retries it — and by then the first has
    // finished and the retry is answered 200 by the early-exit guard.
    const retry = await handle(photo.id);
    expect(retry.status).toBe(200);

    const [row] = await db.select().from(schema.photos).where(eq(schema.photos.id, photo.id));
    expect(row.status).toBe('ready');
  });

  it('answers 429 rather than queueing when the machine is full', async () => {
    const one = await seedPhoto(await jpeg(3));
    const two = await seedPhoto(await jpeg(4));
    const handle = createHandler(deps(), { concurrency: 1 });

    const [a, b] = await Promise.all([handle(one.id), handle(two.id)]);
    const codes = [a.status, b.status].sort();

    /*
     * Not a wait. A handler that blocked for a free slot would hold a request
     * open doing nothing, and QStash counts elapsed time against the response
     * deadline — so "busy" would eventually be recorded as "failed". Better to
     * say so immediately and be asked again in twelve seconds.
     */
    expect(codes).toEqual([200, 429]);
  });
});

describe('a worker that dies mid-derive', () => {
  it('never answers, so the delivery is retried rather than acked', async () => {
    const photo = await seedPhoto(await jpeg(5));

    /*
     * A crash is modelled as the pipeline throwing, because from QStash's side
     * those are the same event: no 2xx arrives. What must not happen is the
     * handler turning it into a success, which is the failure mode that would
     * lose the photo silently — acked, never processed, nothing to look at.
     */
    const exploding = {
      ...deps(),
      objects: {
        get: async () => {
          throw new Error('storage went away mid-derive');
        },
        put: objects.put.bind(objects),
        delete: objects.delete.bind(objects),
      } as any,
    };

    const reply = await createHandler(exploding)(photo.id);
    expect(reply.status).toBe(500);
    expect(reply.nonRetryable).toBeFalsy();

    // And the row is untouched, so the redelivery has something to do.
    const [row] = await db.select().from(schema.photos).where(eq(schema.photos.id, photo.id));
    expect(row.status).toBe('pending');

    // Which it then does, against a working store.
    const retry = await createHandler(deps())(photo.id);
    expect(retry.status).toBe(200);
  });

  it('releases the in-flight slot when it dies, so the retry is not refused', async () => {
    const photo = await seedPhoto(await jpeg(6));
    const exploding = {
      ...deps(),
      objects: {
        get: async () => {
          throw new Error('boom');
        },
        put: objects.put.bind(objects),
        delete: objects.delete.bind(objects),
      } as any,
    };

    const handle = createHandler(exploding, { concurrency: 1 });
    await handle(photo.id);

    /*
     * Without the `finally`, a thrown error would leave the id in the set and
     * every redelivery would be answered 409 — forever, by a machine with
     * nothing running on it. The photo would never be derived and the logs
     * would say "already processing".
     */
    const again = await handle(photo.id);
    expect(again.status).not.toBe(409);
    expect(again.status).toBe(500);
  });
});

describe('what QStash is told to stop retrying', () => {
  it('sends a photo that cannot exist to the dead letter queue', async () => {
    const reply = await createHandler(deps())(crypto.randomUUID());
    expect(reply.status).toBe(489);
    expect(reply.nonRetryable).toBe(true);
  });

  it('rejects a delivery with no photo id without retrying it', async () => {
    const reply = await createHandler(deps())('');
    expect(reply.status).toBe(400);
    expect(reply.nonRetryable).toBe(true);
  });
});

/**
 * What a delivery says about itself.
 *
 * `serve` is the only mode production runs and it printed nothing at all —
 * not on success, not on failure. `fail` writes `failed` to the row and
 * returns a reason the row has no column for, so the reason existed for the
 * length of one function call and was then gone.
 *
 * Every HEIC upload failed for weeks on a libheif too old to open an iPhone
 * photograph, and from outside the machine that looked identical to a machine
 * doing its job: it woke, it served, the album stayed empty. Finding it meant
 * putting a row back to `pending` and draining it by hand, because `drain`
 * prints what `serve` threw away.
 */
describe('what the log says', () => {
  it('names the reason, which is the only place it survives', async () => {
    const said: string[] = [];
    const log = vi.spyOn(console, 'log').mockImplementation((...a) => void said.push(a.join(' ')));
    const err = vi.spyOn(console, 'error').mockImplementation((...a) => void said.push(a.join(' ')));
    try {
      // A photograph that cannot exist fails in the pipeline and is terminal,
      // which is the same shape as the decoder failure that hid for weeks.
      const id = crypto.randomUUID();
      const reply = await createHandler(deps())(id);
      expect(reply.status).toBe(489);
      expect(said.some((l) => l.includes(id))).toBe(true);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });
});
