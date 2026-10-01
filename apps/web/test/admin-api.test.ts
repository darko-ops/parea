/**
 * The admin API the hub calls — `src/admin.ts`.
 *
 * Through the handlers, because the questions worth pinning are who gets in
 * (the right token *and* a name on the staff list), what comes back (never an
 * image), and that every change leaves a `staff_action` row behind it.
 */

import { PGlite } from '@electric-sql/pglite';
import { newLinkToken, PRESERVATION_DAYS, schema } from '@parea/core';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const responderAlerts: unknown[] = [];
vi.mock('@parea/core', async (original) => ({
  ...(await original<typeof import('@parea/core')>()),
  alertResponder: async (alert: unknown) => void responderAlerts.push(alert),
}));

import type { Db } from '@/db';

const { __setDbForTests } = await import('@/db');
const overviewRoute = await import('../app/api/admin/overview/route');
const incidentsRoute = await import('../app/api/admin/incidents/route');
const incidentRoute = await import('../app/api/admin/incidents/[id]/route');
const reportsRoute = await import('../app/api/admin/reports/route');
const reportRoute = await import('../app/api/admin/reports/[id]/route');
const activityRoute = await import('../app/api/admin/activity/route');
const flagsRoute = await import('../app/api/admin/flags/route');
const flagRoute = await import('../app/api/admin/flags/[id]/route');
const revealRoute = await import('../app/api/admin/flags/[id]/reveal/route');
const peopleRoute = await import('../app/api/admin/people/route');
const personRoute = await import('../app/api/admin/people/[id]/route');

const MIGRATIONS = fileURLToPath(new URL('../../../packages/core/drizzle', import.meta.url));
const TOKEN = 'a'.repeat(48);
const STAFF = 'mod@daed.io';

let db: Db;
const saved = { ...process.env };

beforeAll(async () => {
  db = drizzle(new PGlite(), { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: MIGRATIONS });
  __setDbForTests(db);
});

afterAll(() => {
  process.env = { ...saved };
});

beforeEach(async () => {
  process.env.ADMIN_API_TOKEN = TOKEN;
  process.env.ADMIN_STAFF = `${STAFF}, Other@Daed.io`;
  await db.execute(sql`
    truncate "actor", "event", "photo", "report", "content_report",
             "safety_incident", "staff_action", "group_message", "groups",
             "moment", "moment_comment", "event_message", "derivative",
             "moderation_action", "moderation_flag", "account", "suspension",
             "session"
    restart identity cascade
  `);
});

function req(path: string, init: { method?: string; body?: unknown; token?: string | null; staff?: string | null } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' });
  const token = init.token === undefined ? TOKEN : init.token;
  const staff = init.staff === undefined ? STAFF : init.staff;
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (staff) headers.set('x-parea-staff', staff);
  return new Request(`https://parea.test/api/admin/${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function person(displayName: string) {
  const [row] = await db.insert(schema.actors).values({ kind: 'guest', displayName }).returning();
  return row!.id;
}

async function photoIn(uploaderId: string) {
  const [event] = await db
    .insert(schema.events)
    .values({ name: 'Party', linkToken: newLinkToken(), createdBy: uploaderId })
    .returning();
  const [photo] = await db
    .insert(schema.photos)
    .values({ eventId: event!.id, uploaderId, storageKey: `k-${Math.random()}`, byteSize: 1, mime: 'image/jpeg', status: 'ready' })
    .returning();
  return { eventId: event!.id, photoId: photo!.id };
}

async function incident(hoursAgo = 1) {
  const uploader = await person('Uploader');
  const { eventId, photoId } = await photoIn(uploader);
  const [row] = await db
    .insert(schema.safetyIncidents)
    .values({
      photoId,
      eventId,
      uploaderActorId: uploader,
      provider: 'photodna',
      classification: 'match',
      storageKey: 'preserved/secret-key',
      contentHash: Buffer.alloc(32, 7),
      detectedAt: new Date(Date.now() - hoursAgo * 3_600_000),
    })
    .returning();
  return row!.id;
}

const staffActions = () => db.select().from(schema.staffActions);

describe('who gets in', () => {
  it('hides every route when no token is configured', async () => {
    delete process.env.ADMIN_API_TOKEN;
    expect((await overviewRoute.GET(req('overview'))).status).toBe(404);
  });

  it('treats a short token as no token', async () => {
    process.env.ADMIN_API_TOKEN = 'short';
    expect((await overviewRoute.GET(req('overview', { token: 'short' }))).status).toBe(404);
  });

  it('hides from a wrong or missing token', async () => {
    expect((await overviewRoute.GET(req('overview', { token: 'b'.repeat(48) }))).status).toBe(404);
    expect((await overviewRoute.GET(req('overview', { token: null }))).status).toBe(404);
  });

  it('refuses the right token acting for somebody who is not staff', async () => {
    expect((await overviewRoute.GET(req('overview', { staff: 'stranger@example.com' }))).status).toBe(403);
    expect((await overviewRoute.GET(req('overview', { staff: null }))).status).toBe(403);
  });

  it('lets staff in, whatever case their email arrives in', async () => {
    expect((await overviewRoute.GET(req('overview', { staff: 'other@daed.io' }))).status).toBe(200);
    expect((await overviewRoute.GET(req('overview', { staff: 'MOD@daed.io' }))).status).toBe(200);
  });
});

describe('incidents', () => {
  it('come back with their clock, a hash, and nothing that renders the image', async () => {
    await incident(59.5);
    const body = await (await incidentsRoute.GET(req('incidents'))).json();
    const [row] = body.incidents;
    expect(row.state).toBe('open');
    expect(row.hoursLeft).toBe(12);
    expect(row.urgency).toBe('urgent');
    expect(row.contentHash).toBe('07'.repeat(32));
    expect(JSON.stringify(body)).not.toContain('preserved/secret-key');
    expect(row).not.toHaveProperty('storageKey');
  });

  it('count toward the overview, overdue ones separately', async () => {
    await incident(79.5);
    await incident(1);
    const body = await (await overviewRoute.GET(req('overview'))).json();
    expect(body.incidents).toEqual({ open: 2, overdue: 1, soonestHoursLeft: -8 });
  });

  it('are filed with a reference, which starts the preservation clock and is recorded', async () => {
    const id = await incident();
    const res = await incidentRoute.POST(
      req(`incidents/${id}`, { method: 'POST', body: { action: 'file', reference: 'CT-123' } }),
      params(id),
    );
    expect(res.status).toBe(200);

    const [row] = await db.select().from(schema.safetyIncidents).where(eq(schema.safetyIncidents.id, id));
    expect(row!.reportReference).toBe('CT-123');
    expect(row!.reportedAt).not.toBeNull();
    const days = (row!.preservationEndsAt!.getTime() - row!.reportedAt!.getTime()) / 86_400_000;
    expect(days).toBe(PRESERVATION_DAYS);

    const [action] = await staffActions();
    expect(action).toMatchObject({ staff: STAFF, action: 'incident_filed', targetKind: 'safety_incident', targetId: id });
  });

  it('need a reference to be filed', async () => {
    const id = await incident();
    const res = await incidentRoute.POST(req(`incidents/${id}`, { method: 'POST', body: { action: 'file' } }), params(id));
    expect(res.status).toBe(400);
    expect(await staffActions()).toEqual([]);
  });

  it('need a reason to be released, and keep it', async () => {
    const id = await incident();
    const without = await incidentRoute.POST(
      req(`incidents/${id}`, { method: 'POST', body: { action: 'release' } }),
      params(id),
    );
    expect(without.status).toBe(400);

    const res = await incidentRoute.POST(
      req(`incidents/${id}`, { method: 'POST', body: { action: 'release', note: 'hash collision, confirmed with provider' } }),
      params(id),
    );
    expect(res.status).toBe(200);
    const [row] = await db.select().from(schema.safetyIncidents).where(eq(schema.safetyIncidents.id, id));
    expect(row!.releasedAt).not.toBeNull();
    expect(row!.notes).toContain(`released by ${STAFF}: hash collision`);
    expect((await staffActions())[0]!.action).toBe('incident_released');
  });

  it('cannot be released once filed — preservation is then a duty', async () => {
    const id = await incident();
    await incidentRoute.POST(req(`incidents/${id}`, { method: 'POST', body: { action: 'file', reference: 'CT-1' } }), params(id));
    const res = await incidentRoute.POST(
      req(`incidents/${id}`, { method: 'POST', body: { action: 'release', note: 'changed my mind' } }),
      params(id),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('already_filed');
    const [row] = await db.select().from(schema.safetyIncidents).where(eq(schema.safetyIncidents.id, id));
    expect(row!.releasedAt).toBeNull();
    expect(await staffActions()).toHaveLength(1);
  });

  it('cannot be filed twice', async () => {
    const id = await incident();
    const file = () =>
      incidentRoute.POST(req(`incidents/${id}`, { method: 'POST', body: { action: 'file', reference: 'CT-1' } }), params(id));
    expect((await file()).status).toBe(200);
    expect((await file()).status).toBe(409);
  });
});

describe('reports', () => {
  async function photoReport(kind: 'abuse' | 'child_safety' | 'removal_request') {
    const uploader = await person('Uploader');
    const reporter = await person('Reporter');
    const { photoId } = await photoIn(uploader);
    const [row] = await db.insert(schema.reports).values({ photoId, reporterActorId: reporter, kind, note: 'not ok' }).returning();
    return row!.id;
  }

  it('list Parea’s reports and leave hosts’ removal requests out', async () => {
    await photoReport('abuse');
    await photoReport('removal_request');
    const author = await person('Author');
    const reporter = await person('Reporter');
    const [group] = await db.insert(schema.groups).values({ name: 'Fam', slug: 'fam' }).returning();
    const [message] = await db
      .insert(schema.groupMessages)
      .values({ groupId: group!.id, authorActorId: author, body: 'something threatening' })
      .returning();
    await db.insert(schema.contentReports).values({
      targetKind: 'group_message',
      targetId: message!.id,
      subjectActorId: author,
      reporterActorId: reporter,
      kind: 'abuse',
    });

    const body = await (await reportsRoute.GET(req('reports'))).json();
    expect(body.photo).toHaveLength(1);
    expect(body.photo[0]).toMatchObject({ kind: 'abuse', eventName: 'Party', uploaderName: 'Uploader' });
    expect(body.content[0]).toMatchObject({ excerpt: 'something threatening', subjectName: 'Author' });

    const overview = await (await overviewRoute.GET(req('overview'))).json();
    expect(overview.reports).toEqual({ photo: 1, content: 1 });
    expect(overview.removalRequests).toBe(1);
  });

  it('are declined with a record of who did it', async () => {
    const id = await photoReport('abuse');
    const res = await reportRoute.POST(
      req(`reports/${id}`, { method: 'POST', body: { source: 'photo', action: 'decline', note: 'fine' } }),
      params(id),
    );
    expect(res.status).toBe(200);
    const [row] = await db.select().from(schema.reports).where(eq(schema.reports.id, id));
    expect(row!.status).toBe('declined');
    expect((await staffActions())[0]).toMatchObject({ action: 'report_declined', targetKind: 'report', note: 'fine' });
  });

  it('about child safety on a photo go through the incident, not a decline', async () => {
    const id = await photoReport('child_safety');
    const res = await reportRoute.POST(
      req(`reports/${id}`, { method: 'POST', body: { source: 'photo', action: 'decline' } }),
      params(id),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('use_incident');
  });

  it('that are removal requests are the host’s, and look absent', async () => {
    const id = await photoReport('removal_request');
    const res = await reportRoute.POST(
      req(`reports/${id}`, { method: 'POST', body: { source: 'photo', action: 'decline' } }),
      params(id),
    );
    expect(res.status).toBe(404);
  });

  it('about child safety in words need a reason to be declined', async () => {
    const [row] = await db
      .insert(schema.contentReports)
      .values({ targetKind: 'profile', targetId: await person('Someone'), kind: 'child_safety' })
      .returning();
    const decline = (note?: string) =>
      reportRoute.POST(
        req(`reports/${row!.id}`, { method: 'POST', body: { source: 'content', action: 'decline', note } }),
        params(row!.id),
      );
    expect((await decline()).status).toBe(409);
    expect((await decline('reviewed: a joke between adults, no minor involved')).status).toBe(200);
  });
});

describe('activity', () => {
  it('lists what staff did, newest first', async () => {
    const a = await incident();
    const b = await incident();
    await incidentRoute.POST(req(`incidents/${a}`, { method: 'POST', body: { action: 'file', reference: 'CT-1' } }), params(a));
    await incidentRoute.POST(
      req(`incidents/${b}`, { method: 'POST', body: { action: 'release', note: 'false match' } }),
      params(b),
    );
    const body = await (await activityRoute.GET(req('activity'))).json();
    expect(body.actions.map((x: { action: string }) => x.action)).toEqual(['incident_released', 'incident_filed']);
  });
});

describe('removing what a report is about', () => {
  const deleted: string[] = [];
  beforeEach(async () => {
    deleted.length = 0;
    const { __setStorageForTests } = await import('../src/storage/factory');
    __setStorageForTests({
      async presignPut() { throw new Error('not used'); },
      async presignGet() { return 'x'; },
      async putSmall() {},
      async head() { return null; },
      async delete(key: string) { deleted.push(key); },
    } as never);
  });
  afterAll(async () => {
    const { __setStorageForTests } = await import('../src/storage/factory');
    __setStorageForTests(null);
  });

  const remove = (id: string, source: 'photo' | 'content', note?: string) =>
    reportRoute.POST(req(`reports/${id}`, { method: 'POST', body: { source, action: 'remove', note } }), params(id));

  async function contentReport(targetKind: string, targetId: string, subject: string | null) {
    const [row] = await db
      .insert(schema.contentReports)
      .values({ targetKind: targetKind as never, targetId, subjectActorId: subject, kind: 'abuse' })
      .returning();
    return row!.id;
  }

  it('takes a photo down as a host would, closes every abuse report on it, and says who', async () => {
    const uploader = await person('Uploader');
    const { photoId, eventId } = await photoIn(uploader);
    await db.insert(schema.derivatives).values(
      (['thumb', 'full'] as const).map((kind) => ({
        photoId, kind, format: 'jpeg' as const, storageKey: `ev/${kind}.jpg`, width: 1, height: 1, mime: 'image/jpeg',
      })),
    );
    const [first] = await db.insert(schema.reports).values({ photoId, kind: 'abuse' }).returning();
    const [second] = await db.insert(schema.reports).values({ photoId, kind: 'other' }).returning();
    const [removal] = await db.insert(schema.reports).values({ photoId, kind: 'removal_request' }).returning();

    const res = await remove(first!.id, 'photo', 'harassment');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'actioned', alreadyGone: false });

    const [photo] = await db.select().from(schema.photos).where(eq(schema.photos.id, photoId));
    expect(photo!.status).toBe('removed');
    expect(photo!.deletedAt).not.toBeNull();
    expect(deleted).toEqual(expect.arrayContaining(['ev/thumb.jpg', 'ev/full.jpg']));
    // The original is evidence and the purge job's to remove.
    expect(deleted).not.toContain(photo!.storageKey);

    const statuses = Object.fromEntries(
      (await db.select().from(schema.reports)).map((r) => [r.id, r.status]),
    );
    expect(statuses[first!.id]).toBe('actioned');
    expect(statuses[second!.id]).toBe('actioned');
    expect(statuses[removal!.id]).toBe('open');

    const [audit] = await db.select().from(schema.moderationActions);
    expect(audit).toMatchObject({ photoId, eventId, action: 'removed', actorId: null, reason: 'staff_removed' });
    const [action] = await staffActions();
    expect(action).toMatchObject({ staff: STAFF, action: 'content_removed', targetKind: 'photo', targetId: photoId });
    expect(action!.note).toBe(`report ${first!.id} — harassment`);
  });

  it('leaves a quarantined photo to its incident', async () => {
    const uploader = await person('Uploader');
    const { photoId } = await photoIn(uploader);
    await db.update(schema.photos).set({ status: 'quarantined' }).where(eq(schema.photos.id, photoId));
    const [report] = await db.insert(schema.reports).values({ photoId, kind: 'abuse' }).returning();
    const res = await remove(report!.id, 'photo');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('under_review');
    const [photo] = await db.select().from(schema.photos).where(eq(schema.photos.id, photoId));
    expect(photo!.status).toBe('quarantined');
    expect(await staffActions()).toEqual([]);
  });

  it('empties a group message the way its author deleting it would', async () => {
    const author = await person('Author');
    const [group] = await db.insert(schema.groups).values({ name: 'Fam', slug: 'fam2' }).returning();
    const [message] = await db
      .insert(schema.groupMessages)
      .values({ groupId: group!.id, authorActorId: author, body: 'threat' })
      .returning();
    const a = await contentReport('group_message', message!.id, author);
    const b = await contentReport('group_message', message!.id, author);

    expect((await remove(a, 'content')).status).toBe(200);
    const [row] = await db.select().from(schema.groupMessages).where(eq(schema.groupMessages.id, message!.id));
    expect(row!.body).toBe('');
    expect(row!.deletedAt).not.toBeNull();
    const reports = await db.select().from(schema.contentReports);
    expect(reports.map((r) => r.status)).toEqual(['actioned', 'actioned']);
    expect(b).toBeTruthy();
  });

  it('empties a message in a roll', async () => {
    const author = await person('Author');
    const { eventId } = await photoIn(author);
    const [message] = await db
      .insert(schema.eventMessages)
      .values({ eventId, authorActorId: author, body: 'nasty' })
      .returning();
    expect((await remove(await contentReport('event_message', message!.id, author), 'content')).status).toBe(200);
    const [row] = await db.select().from(schema.eventMessages).where(eq(schema.eventMessages.id, message!.id));
    expect(row!.body).toBe('');
  });

  it('takes a moment down and its pictures out of storage', async () => {
    const author = await person('Author');
    const [moment] = await db
      .insert(schema.moments)
      .values({ actorId: author, key: 'm/full.jpg', thumbKey: 'm/thumb.jpg', width: 1, height: 1 })
      .returning();
    expect((await remove(await contentReport('moment', moment!.id, author), 'content')).status).toBe(200);
    const [row] = await db.select().from(schema.moments).where(eq(schema.moments.id, moment!.id));
    expect(row!.deletedAt).not.toBeNull();
    expect(deleted.sort()).toEqual(['m/full.jpg', 'm/thumb.jpg']);
  });

  it('deletes a comment on a moment', async () => {
    const author = await person('Author');
    const [moment] = await db
      .insert(schema.moments)
      .values({ actorId: author, key: 'm/k.jpg', width: 1, height: 1 })
      .returning();
    const [comment] = await db
      .insert(schema.momentComments)
      .values({ momentId: moment!.id, actorId: author, body: 'cruel' })
      .returning();
    expect((await remove(await contentReport('moment_comment', comment!.id, author), 'content')).status).toBe(200);
    expect(await db.select().from(schema.momentComments)).toEqual([]);
  });

  it('clears a profile’s name and picture, and keeps its handle', async () => {
    const [actor] = await db
      .insert(schema.actors)
      .values({ kind: 'guest', displayName: 'Slur', avatarKey: 'avatars/a.jpg', handle: 'someone' })
      .returning();
    expect((await remove(await contentReport('profile', actor!.id, actor!.id), 'content')).status).toBe(200);
    const [row] = await db.select().from(schema.actors).where(eq(schema.actors.id, actor!.id));
    expect(row).toMatchObject({ displayName: null, avatarKey: null, handle: 'someone' });
    expect(deleted).toEqual(['avatars/a.jpg']);
  });

  it('clears a group’s name and picture, and takes it out of search', async () => {
    const [group] = await db
      .insert(schema.groups)
      .values({ name: 'Bad name', slug: 'bad-name', findable: true, photoKey: 'groups/g.jpg' })
      .returning();
    expect((await remove(await contentReport('group', group!.id, null), 'content')).status).toBe(200);
    const [row] = await db.select().from(schema.groups).where(eq(schema.groups.id, group!.id));
    expect(row).toMatchObject({ name: null, slug: null, findable: false, photoKey: null });
    expect(deleted).toEqual(['groups/g.jpg']);
  });

  it('closes the report as actioned when the author already deleted it', async () => {
    const author = await person('Author');
    const [group] = await db.insert(schema.groups).values({ name: 'Fam', slug: 'fam3' }).returning();
    const [message] = await db
      .insert(schema.groupMessages)
      .values({ groupId: group!.id, authorActorId: author, body: '', deletedAt: new Date() })
      .returning();
    const id = await contentReport('group_message', message!.id, author);
    const res = await remove(id, 'content');
    expect(await res.json()).toEqual({ status: 'actioned', alreadyGone: true });
    expect((await staffActions())[0]!.action).toBe('content_already_gone');
  });

  it('refuses a child-safety report on a photo, which its incident decides', async () => {
    const uploader = await person('Uploader');
    const { photoId } = await photoIn(uploader);
    const [report] = await db.insert(schema.reports).values({ photoId, kind: 'child_safety' }).returning();
    const res = await remove(report!.id, 'photo');
    expect((await res.json()).error).toBe('use_incident');
  });

  it('acts once: a second press finds the report already closed', async () => {
    const author = await person('Author');
    const [group] = await db.insert(schema.groups).values({ name: 'Fam', slug: 'fam4' }).returning();
    const [message] = await db
      .insert(schema.groupMessages)
      .values({ groupId: group!.id, authorActorId: author, body: 'x' })
      .returning();
    const id = await contentReport('group_message', message!.id, author);
    expect((await remove(id, 'content')).status).toBe(200);
    expect((await remove(id, 'content')).status).toBe(404);
    expect(await staffActions()).toHaveLength(1);
  });
});

describe('classifier flags', () => {
  const deleted: string[] = [];
  beforeEach(async () => {
    deleted.length = 0;
    responderAlerts.length = 0;
    process.env.IMAGE_BASE_URL = 'https://img.parea.test';
    process.env.IMAGE_SECRET = 'image-secret';
    const { __setStorageForTests } = await import('../src/storage/factory');
    __setStorageForTests({
      async presignPut() { throw new Error('not used'); },
      async presignGet() { return 'presigned'; },
      async putSmall() {},
      async head() { return null; },
      async delete(key: string) { deleted.push(key); },
    } as never);
  });

  async function flagged(score = 80, labels = 'sexual_activity, nudity') {
    const uploader = await person('Uploader');
    const { photoId, eventId } = await photoIn(uploader);
    await db.update(schema.photos).set({ contentHash: Buffer.alloc(32, 1) }).where(eq(schema.photos.id, photoId));
    const [flag] = await db
      .insert(schema.moderationFlags)
      .values({ photoId, eventId, provider: 'sightengine', labels, score })
      .returning();
    return { flagId: flag!.id, photoId, eventId };
  }

  const answer = (id: string, action: string, note?: string) =>
    flagRoute.POST(req(`flags/${id}`, { method: 'POST', body: { action, note } }), params(id));
  const reveal = (id: string) => revealRoute.POST(req(`flags/${id}/reveal`, { method: 'POST' }), params(id));
  const photoOf = async (id: string) => (await db.select().from(schema.photos).where(eq(schema.photos.id, id)))[0]!;

  it('are listed most confident first, with labels and no picture', async () => {
    await flagged(40);
    await flagged(95);
    const body = await (await flagsRoute.GET(req('flags'))).json();
    expect(body.flags.map((f: { score: number }) => f.score)).toEqual([95, 40]);
    expect(body.flags[0]).toMatchObject({ labels: ['sexual_activity', 'nudity'], eventName: 'Party', shown: true });
    expect(JSON.stringify(body)).not.toMatch(/img\.parea|presigned|k-0/);
  });

  it('are cleared with nothing else changed', async () => {
    const { flagId, photoId } = await flagged();
    expect((await answer(flagId, 'clear', 'swimwear')).status).toBe(200);
    expect((await photoOf(photoId)).status).toBe('ready');
    const [flag] = await db.select().from(schema.moderationFlags);
    expect(flag!.status).toBe('cleared');
    expect((await staffActions())[0]).toMatchObject({ action: 'flag_cleared', targetId: photoId });
  });

  it('remove the photo as a report would, and close the reports on it', async () => {
    const { flagId, photoId } = await flagged();
    await db.insert(schema.reports).values({ photoId, kind: 'abuse' });
    expect((await answer(flagId, 'remove')).status).toBe(200);
    expect((await photoOf(photoId)).status).toBe('removed');
    expect((await db.select().from(schema.reports))[0]!.status).toBe('actioned');
    expect((await db.select().from(schema.moderationFlags))[0]!.status).toBe('actioned');
    expect((await db.select().from(schema.moderationActions))[0]).toMatchObject({ reason: 'staff_removed', actorId: null });
  });

  it('escalate to child safety: quarantined, an incident opened, the responder woken', async () => {
    const { flagId, photoId } = await flagged();
    const res = await answer(flagId, 'escalate', 'looked under 18');
    expect(res.status).toBe(200);
    const { incidentId } = await res.json();

    expect((await photoOf(photoId)).status).toBe('quarantined');
    const [incident] = await db.select().from(schema.safetyIncidents);
    expect(incident).toMatchObject({ id: incidentId, photoId, provider: 'staff_review', reportedAt: null });
    expect(responderAlerts).toHaveLength(1);
    expect((await db.select().from(schema.moderationActions))[0]).toMatchObject({
      action: 'quarantined',
      reason: 'staff_escalated',
      actorId: null,
    });
    // And it shows up where the 72-hour clock is watched.
    const incidents = await (await incidentsRoute.GET(req('incidents'))).json();
    expect(incidents.incidents[0]).toMatchObject({ state: 'open', provider: 'staff_review' });
  });

  it('on a photo already out of sight can only be cleared', async () => {
    const { flagId, photoId } = await flagged();
    await db.update(schema.photos).set({ status: 'removed' }).where(eq(schema.photos.id, photoId));
    expect((await (await answer(flagId, 'remove')).json()).error).toBe('not_shown');
    expect((await (await answer(flagId, 'escalate')).json()).error).toBe('not_shown');
    expect((await answer(flagId, 'clear')).status).toBe(200);
  });

  describe('looking at the photo', () => {
    it('gives a signed card-sized link, and records who looked first', async () => {
      const { flagId, photoId } = await flagged();
      const res = await reveal(flagId);
      expect(res.status).toBe(200);
      const { url } = await res.json();
      expect(url).toMatch(/^https:\/\/img\.parea\.test\//);
      expect(url).toContain('card');
      expect((await staffActions())[0]).toMatchObject({ staff: STAFF, action: 'flag_photo_viewed', targetId: photoId });
    });

    it('refuses a photo held for child safety, and records nothing', async () => {
      const { flagId, photoId } = await flagged();
      await db.update(schema.photos).set({ status: 'quarantined' }).where(eq(schema.photos.id, photoId));
      const res = await reveal(flagId);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('under_review');
      expect(await staffActions()).toEqual([]);
    });

    it('refuses once the flag is answered', async () => {
      const { flagId } = await flagged();
      await answer(flagId, 'clear');
      expect((await reveal(flagId)).status).toBe(404);
    });

    it('refuses a photo that is gone', async () => {
      const { flagId, photoId } = await flagged();
      await db.update(schema.photos).set({ deletedAt: new Date() }).where(eq(schema.photos.id, photoId));
      expect((await (await reveal(flagId)).json()).error).toBe('not_shown');
    });
  });
});

describe('people', () => {
  async function withAccount(displayName: string, handle: string, email: string) {
    const [account] = await db.insert(schema.accounts).values({ email }).returning();
    const [actor] = await db
      .insert(schema.actors)
      .values({ kind: 'user', displayName, handle, accountId: account!.id })
      .returning();
    return actor!.id;
  }
  const search = async (q: string) =>
    (await (await peopleRoute.GET(req(`people?q=${encodeURIComponent(q)}`))).json()).people as {
      id: string;
      email: string | null;
      suspended: boolean;
    }[];

  it('are found by email, handle, name or id — and a merged id finds who they became', async () => {
    const sam = await withAccount('Sam Rivera', 'samr', 'sam@example.com');
    await withAccount('Alex Kim', 'alexk', 'alex@example.com');
    expect((await search('sam@example.com')).map((p) => p.id)).toEqual([sam]);
    expect((await search('@sam')).map((p) => p.id)).toEqual([sam]);
    expect((await search('rivera')).map((p) => p.id)).toEqual([sam]);

    const [old] = await db.insert(schema.actors).values({ kind: 'guest', mergedIntoId: sam }).returning();
    expect((await search(old!.id)).map((p) => p.id)).toEqual([sam]);
    // A tombstone is not a person in a name search.
    await db.update(schema.actors).set({ displayName: 'Sam Rivera' }).where(eq(schema.actors.id, old!.id));
    expect((await search('rivera')).map((p) => p.id)).toEqual([sam]);
  });

  it('treats % and _ as the characters they are', async () => {
    await withAccount('100% real', 'pct', 'p@example.com');
    await withAccount('nothing', 'x_y', 'x@example.com');
    expect(await search('0%')).toHaveLength(1);
    expect(await search('@x_')).toHaveLength(1);
  });

  it('show what was reported about them, and no picture', async () => {
    const sam = await withAccount('Sam', 'sam', 'sam@example.com');
    await db.update(schema.actors).set({ avatarKey: 'avatars/sam.jpg' }).where(eq(schema.actors.id, sam));
    const { photoId } = await photoIn(sam);
    await db.insert(schema.reports).values({ photoId, kind: 'abuse', note: 'mean' });
    await db.insert(schema.contentReports).values({ targetKind: 'profile', targetId: sam, subjectActorId: sam, kind: 'other' });

    const res = await personRoute.GET(req(`people/${sam}`), params(sam));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.person).toMatchObject({ email: 'sam@example.com', handle: 'sam' });
    expect(body.counts.photos).toEqual({ ready: 1 });
    expect(body.counts.rolls).toBe(1);
    expect(body.reportsAbout.map((r: { source: string }) => r.source).sort()).toEqual(['content', 'photo']);
    expect(JSON.stringify(body)).not.toContain('avatars/sam.jpg');
  });

  it('are suspended with a reason, recorded, and lifted with one', async () => {
    const sam = await withAccount('Sam', 'sam', 'sam@example.com');
    const post = (body: unknown) => personRoute.POST(req(`people/${sam}`, { method: 'POST', body }), params(sam));

    expect((await post({ action: 'suspend' })).status).toBe(400);
    expect((await post({ action: 'suspend', reason: 'threats in a group' })).status).toBe(200);
    expect((await search('sam@example.com'))[0]!.suspended).toBe(true);
    expect((await (await post({ action: 'suspend', reason: 'again' })).json()).error).toBe('already_suspended');

    expect((await post({ action: 'lift' })).status).toBe(400);
    expect((await post({ action: 'lift', note: 'appeal accepted' })).status).toBe(200);

    const detail = await (await personRoute.GET(req(`people/${sam}`), params(sam))).json();
    expect(detail.suspended).toBe(false);
    expect(detail.suspensions).toHaveLength(1);
    expect(detail.staffActions.map((a: { action: string }) => a.action)).toEqual(['suspension_lifted', 'suspended']);
  });

  it('refuses to suspend a merged-away actor, which signs nobody in', async () => {
    const sam = await withAccount('Sam', 'sam', 'sam@example.com');
    const [old] = await db.insert(schema.actors).values({ kind: 'guest', mergedIntoId: sam }).returning();
    const res = await personRoute.POST(
      req(`people/${old!.id}`, { method: 'POST', body: { action: 'suspend', reason: 'x' } }),
      params(old!.id),
    );
    expect((await res.json()).error).toBe('merged');
  });
});

describe('everybody', () => {
  const get = async (query: string) => (await peopleRoute.GET(req(`people?${query}`))).json();

  async function seed() {
    const [acc] = await db.insert(schema.accounts).values({ email: 'old@example.com' }).returning();
    const [old] = await db
      .insert(schema.actors)
      .values({ kind: 'user', displayName: 'Old', accountId: acc!.id, createdAt: new Date(Date.now() - 40 * 86_400_000) })
      .returning();
    const [recent] = await db.insert(schema.actors).values({ kind: 'guest', displayName: 'Recent' }).returning();
    const [busy] = await db
      .insert(schema.actors)
      .values({ kind: 'guest', displayName: 'Busy', createdAt: new Date(Date.now() - 3 * 86_400_000) })
      .returning();
    // Merged away: the same person as Old, and never counted twice.
    await db.insert(schema.actors).values({ kind: 'guest', displayName: 'Old (phone)', mergedIntoId: old!.id });

    const { eventId } = await photoIn(busy!.id);
    await db.insert(schema.photos).values({ eventId, uploaderId: busy!.id, storageKey: 'k2', byteSize: 1, mime: 'image/jpeg', status: 'ready' });
    await db.insert(schema.sessions).values({ actorId: old!.id, kind: 'ios', method: 'code', lastSeenAt: new Date() });
    await db.insert(schema.suspensions).values({ actorId: recent!.id, reason: 'spam', suspendedBy: STAFF });
    return { old: old!.id, recent: recent!.id, busy: busy!.id };
  }

  it('count live people, newcomers, the recently active and the suspended', async () => {
    await seed();
    const { totals, signups } = await get('stats=1');
    expect(totals).toEqual({ total: 3, accounts: 1, guests: 2, new7: 2, new30: 2, active7: 1, suspended: 1 });
    expect(signups).toHaveLength(30);
    expect(signups.reduce((n: number, d: { guests: number }) => n + d.guests, 0)).toBe(2);
    expect(signups.at(-1).guests).toBe(1);
  });

  it('list newest first by default, and leave merged-away identities out', async () => {
    const { old, recent, busy } = await seed();
    const body = await get('');
    expect(body.people.map((p: { id: string }) => p.id)).toEqual([recent, busy, old]);
    expect(body.hasMore).toBe(false);
  });

  it('sort by uploads and by last seen', async () => {
    const { old, busy } = await seed();
    expect((await get('sort=uploads')).people[0]).toMatchObject({ id: busy, uploads: 2 });
    expect((await get('sort=last_seen')).people[0].id).toBe(old);
  });

  it('filter to accounts, guests or the suspended', async () => {
    const { old, recent } = await seed();
    expect((await get('filter=accounts')).people.map((p: { id: string }) => p.id)).toEqual([old]);
    expect((await get('filter=guests')).people).toHaveLength(2);
    expect((await get('filter=suspended')).people).toMatchObject([{ id: recent, suspended: true }]);
  });

  it('count open reports against each person', async () => {
    const { busy } = await seed();
    const [photo] = await db.select().from(schema.photos).where(eq(schema.photos.uploaderId, busy)).limit(1);
    await db.insert(schema.reports).values([
      { photoId: photo!.id, kind: 'abuse' },
      { photoId: photo!.id, kind: 'removal_request' },
    ]);
    await db.insert(schema.contentReports).values({ targetKind: 'profile', targetId: busy, subjectActorId: busy, kind: 'other' });
    expect((await get('sort=uploads')).people[0].openReports).toBe(2);
  });

  it('page fifty at a time', async () => {
    await db.insert(schema.actors).values(Array.from({ length: 51 }, (_, i) => ({ kind: 'guest' as const, displayName: `g${i}` })));
    const first = await get('page=1');
    const second = await get('page=2');
    expect(first.people).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(second.people).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });
});
