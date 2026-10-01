/**
 * Refreshing mid-upload does not lose the photos: their bytes are copied as
 * soon as they are queued, and leaving is warned against until the copies and
 * the uploads are done.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HOOK = readFileSync(
  fileURLToPath(new URL('../app/components/useUploads.ts', import.meta.url)),
  'utf8',
);

describe('the upload hook', () => {
  it('copies every queued batch, whether picked on the roll or on the create page', () => {
    expect(HOOK).toContain('secureAll(opened, stored);'); // the create page
    expect(HOOK).toContain('secureAll(store.current, stored);'); // the roll page
    expect(HOOK).toMatch(/secureBudget\(\)\s*\.then\(\(budget\) => opened\.secure\(stored, budget\)\)/);
  });

  it('warns before leaving while copies or uploads are still in flight', () => {
    expect(HOOK).toMatch(/if \(!running && securing === 0\) return;/);
  });
});
