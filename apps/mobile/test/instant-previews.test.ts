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
  ARRIVED_GRACE_MS,
  PROCESSING_GIVE_UP_MS,
  heldCopies,
  nextPreviews,
  nextPreviewsByEvent,
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

  it('waits as long as the server says photographs are still arriving', () => {
    // Ten iPhone photographs on one deriver took longer than the five minutes
    // this used to allow, and they vanished from the roll while still coming.
    const tenMinutes = 1000 + 10 * 60 * 1000;
    expect(nextPreviews(uploaded(), [], EVENT, none, tenMinutes, uri, 4)).toEqual([
      expect.objectContaining({ id: 'a', state: 'processing' }),
    ]);
  });

  it('goes once the server says nothing is arriving and it never came', () => {
    // A grace first, for a feed fetched just before the photograph landed.
    expect(nextPreviews(uploaded(), [], EVENT, none, 1000 + 5000, uri, 0)).toHaveLength(1);
    expect(nextPreviews(uploaded(), [], EVENT, none, 1000 + ARRIVED_GRACE_MS + 1, uri, 0)).toEqual([]);
  });

  it('keeps the uri it was first drawn from', () => {
    const was = nextPreviews([], [item('a', 'pending')], EVENT, none, 0, () => 'ph://first');
    const now = nextPreviews(was, [item('a', 'presigned')], EVENT, none, 0, () => 'ph://second');
    expect(now[0]!.uri).toBe('ph://first');
  });
});

describe('every roll at once', () => {
  const feeds = new Map<string, ReadonlySet<string>>();

  it('keeps each roll’s stand-ins under its own id', () => {
    const next = nextPreviewsByEvent(
      {},
      [item('a', 'pending'), { ...item('b', 'pending'), eventId: 'event-2' }],
      feeds,
      0,
      uri,
    );
    expect(Object.keys(next).sort()).toEqual([EVENT, 'event-2']);
    expect(next[EVENT]!.map((p) => p.id)).toEqual(['a']);
    expect(next['event-2']!.map((p) => p.id)).toEqual(['b']);
  });

  it('remembers a roll whose items the queue has pruned', () => {
    // Nobody has the roll open and the queue is empty: the stand-in is held
    // here or nowhere, which is what leaving a roll used to lose.
    const was = nextPreviewsByEvent({}, [item('a', 'done', { photoId: 'p-a' })], feeds, 0, uri);
    const after = nextPreviewsByEvent(was, [], feeds, 1000, uri);
    expect(after[EVENT]).toEqual([
      expect.objectContaining({ id: 'a', state: 'processing', processingSince: 0 }),
    ]);
  });

  it('lets a roll go once its feed has the photograph, or the wait is given up', () => {
    const was = nextPreviewsByEvent({}, [item('a', 'done', { photoId: 'p-a' })], feeds, 0, uri);
    expect(nextPreviewsByEvent(was, [], new Map([[EVENT, new Set(['p-a'])]]), 1, uri)).toEqual({});
    expect(nextPreviewsByEvent(was, [], feeds, PROCESSING_GIVE_UP_MS + 1, uri)).toEqual({});
  });

  it('comes back unchanged when no roll moved', () => {
    const was = nextPreviewsByEvent({}, [item('a', 'pending')], feeds, 0, uri);
    expect(nextPreviewsByEvent(was, [item('a', 'pending')], feeds, 0, uri)).toBe(was);
  });
});

describe('the copies the stand-ins draw from', () => {
  it('is held while queued, and while a stand-in is drawing it after that', () => {
    const queued = [item('a', 'done', { photoId: 'p-a' })];
    const byEvent = nextPreviewsByEvent({}, queued, new Map(), 0, () => 'ph://a');
    expect(byEvent[EVENT]![0]!.copy).toBe('file:///cache/outbox/a.jpg');

    // Pruned: the queue lets go, the stand-in does not.
    const pruned = nextPreviewsByEvent(byEvent, [], new Map(), 1, () => 'ph://a');
    expect(heldCopies([], pruned).has('file:///cache/outbox/a.jpg')).toBe(true);

    // Arrived: nothing holds it, so it may be deleted.
    const arrived = nextPreviewsByEvent(pruned, [], new Map([[EVENT, new Set(['p-a'])]]), 2, uri);
    expect(heldCopies([], arrived).size).toBe(0);
  });

  it('is held by the queue while the stand-in has already gone', () => {
    // In the feed and not yet pruned: finished as a stand-in, not as an upload.
    const queued = [item('a', 'done', { photoId: 'p-a' })];
    const byEvent = nextPreviewsByEvent({}, queued, new Map([[EVENT, new Set(['p-a'])]]), 0, uri);
    expect(byEvent).toEqual({});
    expect(heldCopies(queued, byEvent).has('file:///cache/outbox/a.jpg')).toBe(true);
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
    const p = (state: Preview['state']): Preview => ({
      id: state,
      uri: '',
      copy: '',
      state,
      progress: null,
    });
    expect(previewsInFlight([p('failed'), p('stale')])).toBe(false);
    expect(previewsInFlight([p('failed'), p('processing')])).toBe(true);
    expect(previewsInFlight([p('uploading')])).toBe(true);
  });

  it('says which part of the wait it is in', () => {
    expect(previewLabel('uploading')).toBe('Uploading');
    expect(previewLabel('processing')).toBe('Processing');
  });
});

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');
const APP = read('App.tsx');

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

describe('leaving a roll and coming back', () => {
  const screen = APP.slice(APP.indexOf('function EventScreen('));

  it('keeps the stand-ins in the app, not in the roll’s screen', () => {
    expect(APP).toMatch(/const \[previews, setPreviews\] = useState<PreviewsByEvent>\(\{\}\);/);
    expect(screen).not.toMatch(/useState<Preview\[\]>/);
    expect(APP).toMatch(/previews=\{previews\[route\.event\.id\] \?\? NO_PREVIEWS\}/);
    expect(APP).toMatch(/onFeedSeen=\{feedSeen\}/);
  });

  it('moves them on every queue save, whichever roll is open', () => {
    expect(APP).toMatch(/useEffect\(\(\) => lookAtPreviews\(\), \[uploads, lookAtPreviews\]\);/);
    expect(APP).toMatch(/nextPreviewsByEvent\(\s*was,\s*uploadsNow\.current\.items,\s*feedsSeen\.current,[\s\S]{0,80}arrivingSeen\.current,/);
  });

  it('hands each feed up, which is what retires a stand-in', () => {
    expect(screen).toMatch(/if \(feed\) onFeedSeen\(event\.id, feedIds, feed\.arriving \?\? 0\);/);
  });

  it('looks again while one is coming, so a roll nobody has open still gives up', () => {
    expect(APP).toMatch(/Object\.values\(previews\)\.some\(previewsInFlight\)/);
    expect(APP).toMatch(/setInterval\(lookAtPreviews, 30_000\)/);
  });
});

describe('the file a stand-in draws from', () => {
  const PLATFORM = read('src/platform.ts');
  const LIBRARY = read('src/library.ts');

  it('is not deleted when its upload lands', () => {
    const upload = PLATFORM.slice(
      PLATFORM.indexOf('export async function uploadItem'),
      PLATFORM.indexOf('export async function fetchForCover'),
    );
    expect(upload).not.toMatch(/\.delete\(\)/);
  });

  it('is deleted when neither the queue nor a stand-in holds it', () => {
    expect(APP).toMatch(/const now = heldCopies\(uploads\.items, previews\);/);
    expect(APP).toMatch(/releaseCopies\(gone, state\.items\.map\(\(item\) => item\.source\)\)/);
    const release = LIBRARY.slice(LIBRARY.indexOf('export function releaseCopies'));
    // Only our own, and never one the queue on disk has taken back.
    expect(release).toMatch(/if \(!inOutbox\(uri\) \|\| keep\.has\(outboxName\(uri\)\)\) continue;/);
  });

  it('cannot pile up: what nothing names is swept at launch, once it is old', () => {
    expect(APP).toMatch(/sweepOutbox\(state\.items\.map\(\(item\) => item\.source\)\)/);
    const sweep = LIBRARY.slice(LIBRARY.indexOf('export function sweepOutbox'));
    expect(LIBRARY).toMatch(/export const OUTBOX_STRAY_MS = 60 \* 60 \* 1000;/);
    expect(sweep).toMatch(/keep\.has\(outboxName\(entry\.uri\)\)/);
    expect(sweep).toMatch(/now - at < OUTBOX_STRAY_MS/);
  });
});
