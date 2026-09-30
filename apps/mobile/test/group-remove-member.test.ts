/**
 * An admin taking somebody out of a group.
 *
 * The server decides who may be removed — `removeMember` in the web app — and
 * this screen only has to avoid offering what it would refuse: nothing to a
 * member who is not an admin, and nothing on an admin's own row or another
 * admin's. Removal does not undo itself (the removed cannot ask back in), so
 * it is always asked first and always says so.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const API = read('src/api.ts');
const GROUPS = read('src/Groups.tsx');

const between = (source: string, from: string, to: string): string => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0) throw new Error(`anchor not found: ${from}`);
  if (end < 0) throw new Error(`anchor not found: ${to}`);
  return source.slice(start, end);
};

describe('the call', () => {
  it("is leaving's route with somebody named on it", () => {
    const method = between(API, 'removeGroupMember(', '\n  }\n');
    expect(method).toMatch(/\/api\/groups\/\$\{encodeURIComponent\(groupId\)\}\/members\?actorId=/);
    expect(method).toMatch(/method: 'DELETE'/);
  });
});

describe('the People pane', () => {
  const rows = between(GROUPS, 'group.people.map((person)', 'Runs it');

  it('offers removal only to an admin, and only on people who do not run the room', () => {
    expect(rows).toMatch(/group\.role === 'admin' && person\.role !== 'admin'/);
    expect(rows).toMatch(/onLongPress=\{removable \?/);
    // And to a screen reader, which cannot hold a finger still.
    expect(rows).toMatch(/accessibilityActions=\{\s*removable/);
  });

  it('asks first, destructively, and says what comes after', () => {
    const remove = between(GROUPS, 'const removeMember = useCallback', '[api, groupId, load],');
    expect(remove).toMatch(/style: 'destructive'/);
    expect(remove).toMatch(/api\.removeGroupMember\(groupId, person\.actorId\)/);
    expect(remove).toMatch(/await load\(\)/);
    expect(remove).toMatch(/They can come back only if an admin invites them\./);
    expect(remove).toMatch(/status === 409[\s\S]*Admins cannot remove each other\./);
    expect(remove).toMatch(/status === 403/);
  });
});
