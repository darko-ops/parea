/**
 * A room's name and picture, which only its hosts change.
 *
 * The server refuses a rename, a new photo and a removed photo from anybody
 * whose role in the group is not 'admin' — `admin_only` from
 * `PATCH /api/groups/[id]` and `/api/groups/[id]/photo`. This screen only has
 * to avoid offering what it would refuse: a member sees the name and the
 * picture and is handed no control over either. When the screen's idea of who
 * runs the room is stale anyway, the refusal is said in a sentence and the
 * room is read again so the controls go.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const GROUPS = read('src/Groups.tsx');
const PLATFORM = read('src/platform.ts');

const between = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0) throw new Error(`anchor not found: ${from}`);
  if (end < 0) throw new Error(`anchor not found: ${to}`);
  return source.slice(start, end);
};

describe('the sheet', () => {
  it('offers naming and the picture only to an admin', () => {
    const call = between(GROUPS, '<GroupMore', '/>\n      )}');
    expect(call).toMatch(/nameable=\{group\.role === 'admin' && \(group\.memberCount > 2 \|\| group\.named !== null\)\}/);
  });

  it('keeps every name and photo control behind that one flag', () => {
    const more = between(GROUPS, 'function GroupMore(', '\n}\n');
    const gated = between(more, '{nameable && (', 'This group</Text>');
    for (const control of ['onName(', 'onChoosePhoto()', 'onRemovePhoto()', 'accessibilityLabel="Group name"']) {
      expect(gated).toContain(control);
      // And nowhere else in the sheet.
      expect(more.indexOf(control)).toBe(more.lastIndexOf(control));
    }
  });
});

describe('a refusal all the same', () => {
  const hostsOnly = between(GROUPS, 'const hostsOnly = useCallback', '[load],');

  it("is recognised by its word, said once, and the room read again", () => {
    expect(hostsOnly).toMatch(/err instanceof ApiError && err\.status === 403 && err\.body\.error === 'admin_only'/);
    expect(hostsOnly).toMatch(/Only the group's hosts can change this\./);
    expect(hostsOnly).toMatch(/await load\(\)/);
  });

  it('is checked by renaming, choosing a photo and removing one', () => {
    for (const [from, to] of [
      ['const rename = useCallback', '[api, groupId, hostsOnly],'],
      ['const choosePhoto = useCallback', '[api, groupId, hostsOnly]);'],
      ['const removePhoto = useCallback', '[api, groupId, hostsOnly]);'],
    ]) {
      expect(between(GROUPS, from, to)).toMatch(/if \(await hostsOnly\(err\)\)/);
    }
  });

  it("reaches the photo's caller with the route's word, not only a status", () => {
    const upload = between(PLATFORM, 'export async function uploadCover(', '\n}\n');
    expect(upload).toMatch(/JSON\.parse\(result\.body\)/);
    expect(upload).toMatch(/throw new ApiError\(/);
  });
});
