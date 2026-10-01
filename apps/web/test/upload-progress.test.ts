/**
 * The upload panel on a roll: it survives a refresh without jumping, it is not
 * full until the photos are on the page, and the "arriving" pill does not
 * flicker or count uploads that never came.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const VIEW = read('app/components/EventView.tsx');
const HOOK = read('app/components/useUploads.ts');

describe('after a refresh', () => {
  it('shows the saved queue before checking its files, so the bar does not vanish', () => {
    const early = HOOK.indexOf('const early = await opened.loadState(eventId)');
    const restore = HOOK.indexOf('const restored = await restore(eventId, opened');
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(restore);
  });

  it('checks the saved files together, not one after another', () => {
    expect(read('src/upload/browser.ts')).toMatch(/await Promise\.all\(\s*outstanding\.map\(/);
  });
});

describe('the bar', () => {
  it('counts a photo finished only once it is on the page, or nothing is left arriving', () => {
    expect(VIEW).toMatch(
      /item\.status === 'done' && \(\(item\.photoId != null && shown\.has\(item\.photoId\)\) \|\| arriving === 0\)/,
    );
    expect(VIEW).toMatch(/style=\{\{ width: `\$\{progress\}%` \}\}/);
  });

  it('says it is finishing while photos are processing', () => {
    expect(VIEW).toMatch(/Finishing \$\{processing\}/);
  });

  it('starts folded, opening on its own only when something needs a decision', () => {
    expect(VIEW).toMatch(/const open = choice \?\? needsAttention;/);
  });
});

describe('the arriving pill', () => {
  it('keeps only the newest refresh, so an older answer cannot put the page back', () => {
    expect(VIEW).toMatch(/if \(ticket !== latestRefresh\.current\) return;/);
  });

  it('counts only photos whose bytes have landed, on both the first render and the poll', () => {
    expect(read('app/event/[id]/page.tsx')).toMatch(/isNotNull\(schema\.photos\.bytesAt\)/);
    expect(read('app/api/events/[id]/photos/route.ts')).toMatch(/isNotNull\(schema\.photos\.bytesAt\)/);
  });
});
