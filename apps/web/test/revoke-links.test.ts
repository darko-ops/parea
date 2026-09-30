/**
 * A photograph taken down stops loading at every link already handed out.
 * See `@/revoke`, and the Worker's `isRevoked`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const written: string[] = [];
const removed: string[] = [];
vi.mock('@/storage', () => ({
  getStorage: () => ({
    putSmall: async (key: string) => void written.push(key),
    delete: async (key: string) => void removed.push(key),
  }),
}));

const { restorePhotoLinks, revokeEventLinks, revokePhotoLinks } = await import('@/revoke');

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const EVENT = '3f1c9a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const HASH = Buffer.alloc(32, 0xab);

describe('taking back a photo’s links', () => {
  it('writes the marker the Worker checks, and deletes it to restore', async () => {
    await revokePhotoLinks({ eventId: EVENT, contentHash: HASH });
    expect(written).toContain(`ev/${EVENT}/.revoked/${HASH.toString('hex')}`);
    await restorePhotoLinks({ eventId: EVENT, contentHash: HASH });
    expect(removed).toContain(`ev/${EVENT}/.revoked/${HASH.toString('hex')}`);
  });

  it('has nothing to revoke for a photo never derived', async () => {
    const before = written.length;
    await revokePhotoLinks({ eventId: EVENT, contentHash: null });
    expect(written).toHaveLength(before);
  });

  it('moves a deleted event past the epoch its links were signed under', async () => {
    await revokeEventLinks({ id: EVENT, capEpoch: 3 });
    expect(written).toContain(`ev/${EVENT}/.epoch`);
  });

  it('is done at every place a shown photo stops being shown', () => {
    expect(read('../app/api/photos/[id]/route.ts')).toMatch(/await revokePhotoLinks\(updated\)/);
    expect(read('../src/accounts.ts')).toMatch(/await revokePhotoLinks\(removed\)/);
    expect(read('../app/api/photos/[id]/report/route.ts')).toMatch(/await revokePhotoLinks\(photo\)/);
    const resolve = read('../app/api/reports/[id]/resolve/route.ts');
    expect(resolve).toMatch(/await revokePhotoLinks\(found\.photo\)/);
    expect(resolve).toMatch(/await restorePhotoLinks\(found\.photo\)/);
    expect(read('../app/api/events/[id]/route.ts')).toMatch(/await revokeEventLinks\(event\)/);
    expect(read('../../../services/deriver/src/jobs.ts')).toMatch(/revokedMarkerKey\(photo\.eventId/);
  });
});
