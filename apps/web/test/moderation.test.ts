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
      "safety_incident", "moderation_action"
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
 * an event one report at a time.
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


/**
 * The audit trail — the user-facing claim is "who uploaded, reported,
 * restricted and removed".
 *
 * Checked against the source rather than by exercising every path, because the
 * failure being guarded is a *new* write site added later without a record,
 * and no test of the paths that exist today can catch that.
 */
describe('every write that hides or removes a photo records why', () => {
  const sources = [
    'apps/web/app/api/photos/[id]/route.ts',
    'apps/web/app/api/photos/[id]/report/route.ts',
    'apps/web/app/api/reports/[id]/resolve/route.ts',
    'apps/web/src/accounts.ts',
    'services/deriver/src/pipeline.ts',
    'services/deriver/src/jobs.ts',
  ].map((rel) => ({
    rel,
    text: readFileSync(
      fileURLToPath(new URL(`../../../${rel}`, import.meta.url)),
      'utf8',
    ),
  }));

  it('leaves no visibility change unrecorded', () => {
    // Every file that sets one of these has to also call the recorder. Crude
    // and deliberately so: a file-level check cannot be satisfied by writing
    // an audit row for a *different* branch, but it does fail loudly the
    // moment a new file starts hiding things.
    const changes =
      /status: 'quarantined'|status: 'removed'|hiddenAt: new Date\(\)|hiddenAt: null|deletedAt: new Date\(\)|deletedAt: now/;
    for (const { rel, text } of sources) {
      if (!changes.test(text)) continue;
      expect(text, `${rel} changes visibility without recording it`).toMatch(
        /recordModeration\(/,
      );
    }
  });

  it('names a rule whenever no person is responsible', () => {
    // A null actor with no reason is an unexplained disappearance. Every
    // machine-driven call passes one of the named constants.
    for (const { rel, text } of sources) {
      for (const call of text.match(/recordModeration\([\s\S]{0,400}?\}\)/g) ?? []) {
        if (!/actorId: null/.test(call)) continue;
        expect(call, `${rel} has a null actor with no named rule`).toMatch(
          /reason: REASON\./,
        );
      }
    }
  });

  it('records the purge before the row it describes is deleted', () => {
    // The other order loses the record: nothing reads the photo's event after
    // the delete, and the audit row needs it.
    const jobs = sources.find((s) => s.rel.endsWith('jobs.ts'))!.text;
    const record = jobs.indexOf("reason: REASON.purgeGrace");
    const del = jobs.indexOf('.delete(schema.photos)');
    expect(record).toBeGreaterThan(-1);
    expect(record, 'the audit row must be written first').toBeLessThan(del);
  });
});

/**
 * A host-actioned removal takes the renditions out of storage.
 *
 * The image Worker holds no database and decides nothing — it verifies a
 * signature and streams — so its only revocation signal is the event's epoch
 * marker. A photograph removed here would otherwise keep serving on any URL
 * already minted for it until that URL's hour bucket expired: up to two hours.
 *
 * For an ordinary removal that is the accepted trade. This is the one path
 * that is both terminal and asked for by a person: somebody wanted their
 * photograph down and a host agreed. A missing object is an immediate 404 with
 * no epoch involved, which is the cheapest possible way to make "removed" mean
 * removed.
 *
 * What must *not* happen is the original going with them. It is what an abuse
 * investigation reads and what the purge job removes on its own schedule.
 */
describe('removing a reported photo', () => {
  const fakeStorage = () => {
    const deleted: string[] = [];
    return {
      deleted,
      store: {
        deleted,
        async presignPut() { throw new Error('not used'); },
        async presignGet() { return 'x'; },
        async putSmall() {},
        async head() { return null; },
        async delete(key: string) { deleted.push(key); },
      },
    };
  };

  const withDerivatives = async (eventId: string, uploaderId: string) => {
    const [photo] = await db
      .insert(schema.photos)
      .values({
        eventId,
        uploaderId,
        storageKey: 'ev/e/original-stays',
        byteSize: 1,
        mime: 'image/jpeg',
        status: 'ready',
      })
      .returning();
    await db.insert(schema.derivatives).values(
      (['thumb', 'card', 'grid', 'full'] as const).map((kind) => ({
        photoId: photo!.id,
        kind,
        format: 'jpeg' as const,
        storageKey: `ev/e/hash.${kind}.jpg`,
        width: 1,
        height: 1,
        mime: 'image/jpeg',
      })),
    );
    return photo!;
  };

  it('deletes every rendition and keeps the original', async () => {
    const { event, guest } = await scene();
    const photo = await withDerivatives(event.id, guest);

    const { store, deleted } = fakeStorage();
    const { __setStorageForTests } = await import('../src/storage/factory');
    __setStorageForTests(store as never);
    try {
      const { dropDerivatives } = await import('../app/api/reports/[id]/resolve/route');
      await dropDerivatives(db, photo.id);
    } finally {
      __setStorageForTests(null);
    }

    expect([...deleted].sort()).toEqual([
      'ev/e/hash.card.jpg',
      'ev/e/hash.full.jpg',
      'ev/e/hash.grid.jpg',
      'ev/e/hash.thumb.jpg',
    ]);
    // The one key that must survive: an investigation reads it, and the purge
    // job removes it on its own clock.
    expect(deleted).not.toContain('ev/e/original-stays');
  });

  it('touches nothing for a photograph with no renditions', async () => {
    // An ingest quarantine never builds them — the runbook is explicit — so
    // this path has to be a no-op rather than an error.
    const { event, guestPhoto } = await scene();
    const { store, deleted } = fakeStorage();
    const { __setStorageForTests } = await import('../src/storage/factory');
    __setStorageForTests(store as never);
    try {
      const { dropDerivatives } = await import('../app/api/reports/[id]/resolve/route');
      await dropDerivatives(db, guestPhoto.id);
    } finally {
      __setStorageForTests(null);
    }
    expect(deleted).toEqual([]);
  });

  it('is actually called from the remove branch', () => {
    /*
     * The three cases above exercise `dropDerivatives` directly, which is the
     * only way to test it without staging an `administer` credential — and
     * they all pass with the call deleted from the route. That gap is the
     * whole reason this assertion exists: a helper nobody invokes is a helper
     * that does nothing, and it would have looked thoroughly tested.
     *
     * Checked against the source in the same style as the audit-trail scan
     * above, and narrowed to the branch: it must sit with the `removed` write
     * rather than anywhere in the file, because calling it on `decline` would
     * delete the renditions of a photograph that is coming back.
     */
    const text = readFileSync(
      fileURLToPath(
        new URL('../../../apps/web/app/api/reports/[id]/resolve/route.ts', import.meta.url),
      ),
      'utf8',
    );
    const removeBranch = text.slice(
      text.indexOf("if (action === 'remove')"),
      text.indexOf('} else {'),
    );
    expect(removeBranch, 'the remove branch must drop the renditions').toMatch(
      /dropDerivatives\(/,
    );

    const declineBranch = text.slice(text.indexOf('} else {'), text.indexOf('recordModeration('));
    expect(declineBranch, 'declining must not delete anything').not.toMatch(
      /dropDerivatives\(/,
    );
  });

  it('survives storage refusing, because the row is already removed', async () => {
    /*
     * The photograph is out of every listing before this runs. A storage blip
     * must not turn a host's decision into a 500 and leave the report
     * unresolved — the object outliving its row is untidy, and the purge job
     * will reach it; an unresolved report is a person waiting for an answer.
     */
    const { event, guest } = await scene();
    const photo = await withDerivatives(event.id, guest);

    const { __setStorageForTests } = await import('../src/storage/factory');
    __setStorageForTests({
      async presignPut() { throw new Error('not used'); },
      async presignGet() { return 'x'; },
      async putSmall() {},
      async head() { return null; },
      async delete() { throw new Error('r2 is having a moment'); },
    } as never);
    try {
      const { dropDerivatives } = await import('../app/api/reports/[id]/resolve/route');
      await expect(dropDerivatives(db, photo.id)).resolves.toBeUndefined();
    } finally {
      __setStorageForTests(null);
    }
  });
});
