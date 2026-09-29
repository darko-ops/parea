/**
 * A group's own picture — the room's profile picture.
 *
 * Set by any member from the group's settings, under its name, and refused
 * where a name is refused. Only ever handed to people in the room: a door to a
 * group somebody is not in carries a name and a count and nothing else.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const ROUTE = read('../app/api/groups/[id]/photo/route.ts');
const GROUP = read('../app/api/groups/[id]/route.ts');
const GROUPS = read('../src/groups.ts');
const SCHEMA = read('../../../packages/core/src/schema.ts');
const MIGRATION = read('../../../packages/core/drizzle/0047_group_photo.sql');

describe('a group photo', () => {
  it('is one nullable column on the group', () => {
    expect(SCHEMA).toMatch(/photoKey: text\('photo_key'\),/);
    expect(MIGRATION).toMatch(/ALTER TABLE "groups" ADD COLUMN "photo_key" text;/);
  });

  it('is set by a member, and not on a chat between two people', () => {
    expect(ROUTE).toMatch(/membershipOf\(db, group\.id, actorId\)/);
    expect(ROUTE).toMatch(/memberCount\(db, group\.id\)\) < 3/);
    expect(ROUTE).toMatch(/error: 'chat_not_nameable' \}, \{ status: 409 \}/);
  });

  it('is re-encoded as a square JPEG, under a key that changes each time', () => {
    expect(ROUTE).toMatch(/fit: 'cover'/);
    expect(ROUTE).toMatch(/\.jpeg\(\{ quality: 82, mozjpeg: true \}\)/);
    // A new key per picture, so a phone caching by URL never shows the old one.
    expect(ROUTE).toMatch(/const key = `groups\/\$\{group\.id\}-\$\{randomUUID\(\)\}\.jpg`;/);
    expect(ROUTE).toMatch(/if \(group\.photoKey\) await storage\.delete\(group\.photoKey\)/);
  });

  it('reaches members and nobody else', () => {
    const door = GROUP.slice(GROUP.indexOf('if (!membership) {'), GROUP.indexOf('const since ='));
    expect(door).not.toMatch(/photoUrl|photoKey/);
    expect(GROUP).toMatch(/photoUrl: await groupPhotoUrl\(group\.photoKey\),/);
    expect(GROUPS).toMatch(/export async function groupPhotoUrl\(/);
  });
});
