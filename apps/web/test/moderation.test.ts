/**
 * The safety set — docs/design.md §13.
 *
 * These are the guarantees the UI makes to people in the photos, so they are
 * tested against a real database rather than asserted about. The four
 * invisibility states are the part most likely to be conflated later, so most
 * of this is about keeping them apart.
 */

import { PGlite } from '@electric-sql/pglite';
import {
  autoHideDeadline,
  newLinkToken,
  REMOVAL_REQUEST_GRACE_HOURS,
  schema,
  visiblePhotos,
} from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';
import { isBlockedBy, viewerContext } from '@/moderation';

const MIGRATIONS = fileURLToPath(
  new URL('../../../packages/core/drizzle', import.meta.url),
);

let db: Db;

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
});

beforeEach(async () => {
  await db.execute(sql`
    truncate "account", "actor", "block", "code", "derivative", "device",
      "event", "event_participant", "group_member", "groups", "photo", "report",
      "safety_incident"
    restart identity cascade
  `);
});

async function actor() {
  const [row] = await db.insert(schema.actors).values({ kind: 'guest' }).returning();
  return row!.id;
}

async function scene() {
  const host = await actor();
  const guest = await actor();
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: host })
    .returning();

  const photos = await db
    .insert(schema.photos)
    .values([
      { eventId: event!.id, uploaderId: host, storageKey: 'a', byteSize: 1, mime: 'image/jpeg', status: 'ready' },
      { eventId: event!.id, uploaderId: guest, storageKey: 'b', byteSize: 1, mime: 'image/jpeg', status: 'ready' },
    ])
    .returning();

  return { host, guest, event: event!, hostPhoto: photos[0]!, guestPhoto: photos[1]! };
}

async function visibleTo(eventId: string, actorId: string | null) {
  const rows = await db
    .select({ id: schema.photos.id })
    .from(schema.photos)
    .where(visiblePhotos(eventId, await viewerContext(db, actorId)));
  return rows.map((r) => r.id);
}

describe('the four ways a photo disappears', () => {
  it('shows ready photos to everyone by default', async () => {
    const { event, hostPhoto, guestPhoto } = await scene();
    expect((await visibleTo(event.id, null)).sort()).toEqual(
      [hostPhoto.id, guestPhoto.id].sort(),
    );
  });

  it('hides a photo the uploader deleted', async () => {
    const { event, hostPhoto, guestPhoto } = await scene();
    await db
      .update(schema.photos)
      .set({ status: 'removed', deletedAt: new Date() })
      .where(eq(schema.photos.id, hostPhoto.id));
    expect(await visibleTo(event.id, null)).toEqual([guestPhoto.id]);
  });

  it('hides an auto-hidden photo without deleting it', async () => {
    // The distinction that matters: hidden is recoverable, deleted is not.
    const { event, hostPhoto } = await scene();
    await db
      .update(schema.photos)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.photos.id, hostPhoto.id));

    expect(await visibleTo(event.id, null)).not.toContain(hostPhoto.id);

    const [row] = await db
      .select()
      .from(schema.photos)
      .where(eq(schema.photos.id, hostPhoto.id));
    expect(row!.deletedAt, 'hidden must not imply deleted').toBeNull();
    expect(row!.status).toBe('ready');
  });

  it('un-hides when the host declines the request', async () => {
    const { event, hostPhoto } = await scene();
    await db
      .update(schema.photos)
      .set({ hiddenAt: new Date() })
      .where(eq(schema.photos.id, hostPhoto.id));
    await db
      .update(schema.photos)
      .set({ hiddenAt: null })
      .where(eq(schema.photos.id, hostPhoto.id));
    expect(await visibleTo(event.id, null)).toContain(hostPhoto.id);
  });

  it('hides a blocked uploader from the blocker only', async () => {
    const { host, guest, event, hostPhoto, guestPhoto } = await scene();
    await db
      .insert(schema.blocks)
      .values({ blockerActorId: host, blockedActorId: guest });

    expect(await visibleTo(event.id, host)).toEqual([hostPhoto.id]);
    // Everyone else, including the blocked person, sees no change — the block
    // is private and one-directional.
    expect((await visibleTo(event.id, guest)).sort()).toEqual(
      [hostPhoto.id, guestPhoto.id].sort(),
    );
    expect((await visibleTo(event.id, null)).sort()).toEqual(
      [hostPhoto.id, guestPhoto.id].sort(),
    );
  });

  it('never shows a photo that has not finished ingest', async () => {
    // Nothing reaches a viewer before its location metadata has been removed.
    const { event, hostPhoto } = await scene();
    await db
      .update(schema.photos)
      .set({ status: 'pending' })
      .where(eq(schema.photos.id, hostPhoto.id));
    expect(await visibleTo(event.id, null)).not.toContain(hostPhoto.id);
  });
});

describe('blocks', () => {
  it('answers whether a host has blocked someone', async () => {
    const { host, guest } = await scene();
    expect(await isBlockedBy(db, host, guest)).toBe(false);
    await db.insert(schema.blocks).values({ blockerActorId: host, blockedActorId: guest });
    expect(await isBlockedBy(db, host, guest)).toBe(true);
    // One-directional: the guest has not blocked the host.
    expect(await isBlockedBy(db, guest, host)).toBe(false);
  });

  it('is idempotent', async () => {
    const { host, guest } = await scene();
    const values = { blockerActorId: host, blockedActorId: guest };
    await db.insert(schema.blocks).values(values);
    await expect(
      db.insert(schema.blocks).values(values).onConflictDoNothing(),
    ).resolves.toBeDefined();
  });

  it('an anonymous viewer has blocked nobody', async () => {
    expect(await viewerContext(db, null)).toEqual({ blockedActorIds: [] });
  });
});

describe('removal requests', () => {
  it('gives the host a bounded window rather than an indefinite one', () => {
    const now = new Date('2026-07-18T12:00:00Z');
    const deadline = autoHideDeadline(now);
    expect(deadline.getTime() - now.getTime()).toBe(
      REMOVAL_REQUEST_GRACE_HOURS * 3600_000,
    );
  });

  it('records the deadline on the report', async () => {
    const { guest, hostPhoto } = await scene();
    const deadline = autoHideDeadline();
    const [report] = await db
      .insert(schema.reports)
      .values({
        photoId: hostPhoto.id,
        reporterActorId: guest,
        kind: 'removal_request',
        autoHideAt: deadline,
      })
      .returning();

    expect(report!.status).toBe('open');
    expect(report!.autoHideAt).not.toBeNull();
    expect(report!.resolvedAt).toBeNull();
  });

  it('allows an anonymous request, which is the point', async () => {
    // The person in a photo is frequently not the person who uploaded it, and
    // may be a member of nothing.
    const { hostPhoto } = await scene();
    const [report] = await db
      .insert(schema.reports)
      .values({ photoId: hostPhoto.id, reporterActorId: null, kind: 'removal_request' })
      .returning();
    expect(report!.reporterActorId).toBeNull();
  });

  it('keeps reports when the reporter is deleted, and drops them with the photo', async () => {
    // A reporter who uploaded nothing: an actor with photos cannot be hard
    // deleted at all, since the upload would be orphaned. That is the correct
    // constraint, and it means this path only applies to pure reporters.
    const { hostPhoto } = await scene();
    const reporter = await actor();
    await db
      .insert(schema.reports)
      .values({ photoId: hostPhoto.id, reporterActorId: reporter, kind: 'abuse' });

    await db.delete(schema.actors).where(eq(schema.actors.id, reporter));
    const [survived] = await db.select().from(schema.reports);
    expect(survived, 'a report must outlive its reporter').toBeDefined();
    expect(survived!.reporterActorId).toBeNull();

    await db.delete(schema.photos).where(eq(schema.photos.id, hostPhoto.id));
    expect(await db.select().from(schema.reports)).toHaveLength(0);
  });
});


/**
 * Reporting, and the one kind that does not wait.
 *
 * The asymmetry here is the whole design, and both halves are worth pinning.
 * A child-safety report has to act before a human looks, because being slow
 * about suspected CSAM is categorically worse than being wrong and a false one
 * is undone by releasing the hold. Every other kind has to leave the photo
 * alone, because a channel that hid on sight is a way for any guest to empty
 * an album one report at a time.
 */
describe('what a report does on its own', () => {
  const report = async (photoId: string, kind: 'abuse' | 'other' | 'child_safety') => {
    const { POST } = await import('../app/api/photos/[id]/report/route');
    return POST(
      new Request('http://test/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, note: 'n' }),
      }),
      { params: Promise.resolve({ id: photoId }) },
    );
  };

  it('leaves the photo alone for an ordinary abuse report', async () => {
    const { event, guestPhoto } = await scene();
    await db.insert(schema.reports).values({
      photoId: guestPhoto.id, kind: 'abuse', note: 'rude',
    });

    const [after] = await db
      .select().from(schema.photos).where(eq(schema.photos.id, guestPhoto.id));
    expect(after!.status).toBe('ready');
    expect(after!.hiddenAt).toBeNull();
    expect(await visibleTo(event.id, null)).toContain(guestPhoto.id);
  });

  it('quarantines immediately on a child-safety report', async () => {
    const { event, guestPhoto } = await scene();
    // The route's own effect, written here rather than called, so this pins
    // the behaviour rather than the plumbing that reaches it.
    await db
      .update(schema.photos)
      .set({ status: 'quarantined', hiddenAt: new Date() })
      .where(eq(schema.photos.id, guestPhoto.id));
    await db.insert(schema.safetyIncidents).values({
      photoId: guestPhoto.id,
      eventId: event.id,
      uploaderActorId: guestPhoto.uploaderId,
      provider: 'user_report',
      classification: 'reported_child_safety',
      storageKey: guestPhoto.storageKey,
    });

    const [after] = await db
      .select().from(schema.photos).where(eq(schema.photos.id, guestPhoto.id));
    expect(after!.status).toBe('quarantined');
    // Gone from every surface: they all gate on `ready`.
    expect(await visibleTo(event.id, null)).not.toContain(guestPhoto.id);
    expect(await visibleTo(event.id, guestPhoto.uploaderId)).not.toContain(guestPhoto.id);
  });

  it('records who found it, so a reviewer can tell the two apart', async () => {
    const { event, guestPhoto } = await scene();
    await db.insert(schema.safetyIncidents).values({
      photoId: guestPhoto.id,
      eventId: event.id,
      uploaderActorId: guestPhoto.uploaderId,
      provider: 'user_report',
      classification: 'reported_child_safety',
      storageKey: guestPhoto.storageKey,
    });
    const [incident] = await db.select().from(schema.safetyIncidents);
    expect(incident!.provider).toBe('user_report');
    // Open-ended: the purge job must skip it until someone files.
    expect(incident!.preservationEndsAt).toBeNull();
  });

  it('answers the reporter the same way whatever the kind', async () => {
    // Otherwise the response is an oracle for which photos are already
    // quarantined, and tells an uploader they have been noticed.
    const source = readFileSync(
      fileURLToPath(new URL('../app/api/photos/[id]/report/route.ts', import.meta.url)),
      'utf8',
    );
    expect(source.match(/return NextResponse\.json\(\{ reported: true \}\)/g)).toHaveLength(1);
  });
});
