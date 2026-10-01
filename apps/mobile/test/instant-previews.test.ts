/**
 * Photographs somebody is adding, in the roll before the roll has them.
 *
 * The grid used to show nothing of an upload until all of it was over — bytes,
 * completion and the deriver — so an album somebody had just added twenty
 * pictures to looked exactly as it had before. The phone's own copy leads the
 * grid now, dimmed and marked, until the real photograph with the same id is in
 * the feed.
 *
 * The bookkeeping is a pure function, tested directly. The wiring is in
 * `App.tsx`, and there is no renderer in this suite, so it is checked from the
 * source the way the other screen tests are.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { QueueItem, QueueItemStatus } from '@parea/upload';
import { describe, expect, it } from 'vitest';

import {
  PROCESSING_GIVE_UP_MS,
  nextPreviews,
  previewLabel,
  previewsInFlight,
  type Preview,
} from '../src/previews';

const EVENT = 'event-1';
const none = new Set<string>();
const uri = (item: QueueItem) => item.source;

const item = (id: string, status: QueueItemStatus, extra: Partial<QueueItem> = {}): QueueItem => ({
  id,
  eventId: EVENT,
  source: `file:///cache/outbox/${id}.jpg`,
  name: `${id}.jpg`,
  size: 100,
  mime: 'image/jpeg',
  status,
  attempts: 0,
  ...extra,
});

describe('which photographs get a stand-in', () => {
  it('is this roll’s queue, newest first', () => {
    const next = nextPreviews(
      [],
      [item('a', 'pending'), item('b', 'presigned'), { ...item('c', 'pending'), eventId: 'other' }],
      EVENT,
      none,
      0,
      uri,
    );
    expect(next.map((p) => p.id)).toEqual(['b', 'a']);
    expect(next[0]).toMatchObject({ uri: 'file:///cache/outbox/b.jpg', state: 'uploading' });
  });

  it('names each stage of the wait', () => {
    const next = nextPreviews(
      [],
      [
        item('a', 'pending'),
        item('b', 'uploaded', { photoId: 'p-b' }),
        item('c', 'done', { photoId: 'p-c' }),
        item('d', 'failed'),
        item('e', 'stale'),
      ],
      EVENT,
      none,
      0,
      uri,
    );
    const by = Object.fromEntries(next.map((p) => [p.id, p]));
    expect(by.a).toMatchObject({ state: 'uploading', progress: expect.any(Number) });
    expect(by.b!.progress!).toBeGreaterThan(by.a!.progress!);
    expect(by.c).toMatchObject({ state: 'processing', progress: null, processingSince: 0 });
    expect(by.d!.state).toBe('failed');
    expect(by.e!.state).toBe('stale');
  });

  it('puts new ones on top and leaves the drawn ones where they are', () => {
    const first = nextPreviews([], [item('a', 'pending'), item('b', 'pending')], EVENT, none, 0, uri);
    const again = nextPreviews(
      first,
      [item('a', 'presigned'), item('b', 'pending'), item('c', 'pending'), item('d', 'pending')],
      EVENT,
      none,
      0,
      uri,
    );
    expect(again.map((p) => p.id)).toEqual(['d', 'c', 'b', 'a']);
  });
});

describe('the deriver’s half of the wait', () => {
  const uploaded = () =>
    nextPreviews([], [item('a', 'done', { photoId: 'p-a' })], EVENT, none, 1000, uri);

  it('outlives the queue pruning a finished item', () => {
    const after = nextPreviews(uploaded(), [], EVENT, none, 2000, uri);
    expect(after).toEqual([
      expect.objectContaining({ id: 'a', state: 'processing', processingSince: 1000 }),
    ]);
  });

  it('ends when the photograph is in the feed', () => {
    expect(nextPreviews(uploaded(), [], EVENT, new Set(['p-a']), 2000, uri)).toEqual([]);
  });

  it('is given up on rather than kept for ever', () => {
    const late = 1000 + PROCESSING_GIVE_UP_MS + 1;
    expect(nextPreviews(uploaded(), [], EVENT, none, late, uri)).toEqual([]);
  });

  it('keeps the uri it was first drawn from', () => {
    const was = nextPreviews([], [item('a', 'pending')], EVENT, none, 0, () => 'ph://first');
    const now = nextPreviews(was, [item('a', 'presigned')], EVENT, none, 0, () => 'ph://second');
    expect(now[0]!.uri).toBe('ph://first');
  });
});

describe('what leaves without arriving', () => {
  it('goes with an item that was forgotten before it had an id', () => {
    const was = nextPreviews([], [item('a', 'stale')], EVENT, none, 0, uri);
    expect(nextPreviews(was, [], EVENT, none, 0, uri)).toEqual([]);
  });

  it('does not turn a forgotten failure into one processing', () => {
    const was = nextPreviews([], [item('a', 'failed', { photoId: 'p-a' })], EVENT, none, 0, uri);
    expect(nextPreviews(was, [], EVENT, none, 0, uri)).toEqual([]);
  });
});

describe('the list itself', () => {
  it('comes back unchanged when nothing moved, so the grid is not handed new data', () => {
    const was = nextPreviews([], [item('a', 'pending')], EVENT, none, 0, uri);
    expect(nextPreviews(was, [item('a', 'pending')], EVENT, none, 0, uri)).toBe(was);
  });

  it('is in flight while anything is uploading or processing', () => {
    const p = (state: Preview['state']): Preview => ({ id: state, uri: '', state, progress: null });
    expect(previewsInFlight([p('failed'), p('stale')])).toBe(false);
    expect(previewsInFlight([p('failed'), p('processing')])).toBe(true);
    expect(previewsInFlight([p('uploading')])).toBe(true);
  });

  it('says which part of the wait it is in', () => {
    expect(previewLabel('uploading')).toBe('Uploading');
    expect(previewLabel('processing')).toBe('Processing');
  });
});

const APP = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8');

describe('the roll’s grid', () => {
  const grid = APP.slice(APP.indexOf('ref={gridList}'), APP.indexOf('ref={keptList}'));

  it('leads with the stand-ins and then the feed', () => {
    expect(grid).toMatch(/data=\{gridTiles\}/);
    expect(APP).toMatch(
      /\.\.\.pendingTiles\.map\(\(preview\) => \(\{ \.\.\.preview, standIn: true as const \}\)\),\s*\.\.\.\(feed\?\.photos \?\? \[\]\),/,
    );
  });

  it('drops a stand-in in the same render its photograph arrives', () => {
    expect(APP).toMatch(/previews\.filter\(\(p\) => !\(p\.photoId && feedIds\.has\(p\.photoId\)\)\)/);
  });

  it('keeps stand-ins off the Kept shelf, out of the viewer and out of the count', () => {
    const kept = APP.slice(APP.indexOf('ref={keptList}'), APP.indexOf('ref={keptList}') + 400);
    expect(kept).toMatch(/data=\{kept\}/);
    expect(APP).toMatch(/onShelf\.current = \{ which: shelf, all: feed\?\.photos \?\? \[\], kept \};/);
    expect(APP).toMatch(/`\$\{feed\.count\} \$\{feed\.count === 1 \? 'photo' : 'photos'\}`/);
  });

  it('draws a stand-in that opens nothing but a retry', () => {
    const tile = APP.slice(APP.indexOf('const renderStandIn'), APP.indexOf('const renderTile'));
    expect(tile).not.toMatch(/setSelected|setScope/);
    expect(tile).toMatch(/disabled=\{item\.state !== 'failed'\}/);
    expect(tile).toMatch(/onPress=\{\(\) => void retryStuck\(\)\}/);
    expect(APP).toMatch(/if \(isStandIn\(item\)\) return renderStandIn\(item\);/);
  });

  it('decodes the phone’s copy at the tile’s size, not the camera’s', () => {
    const tile = APP.slice(APP.indexOf('const renderStandIn'), APP.indexOf('const renderTile'));
    expect(tile).toMatch(/allowDownscaling/);
    expect(tile).toMatch(/source=\{\{ uri: item\.uri \}\}/);
  });

  it('keeps polling the feed while a stand-in is waiting for it', () => {
    expect(APP).toMatch(/if \(previewsInFlight\(pendingTiles\)\) stillComing\.current = true;/);
  });
});
