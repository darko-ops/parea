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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { Db } from '@/db';

const { __setDbForTests } = await import('@/db');
const overviewRoute = await import('../app/api/admin/overview/route');
const incidentsRoute = await import('../app/api/admin/incidents/route');
const incidentRoute = await import('../app/api/admin/incidents/[id]/route');
const reportsRoute = await import('../app/api/admin/reports/route');
const reportRoute = await import('../app/api/admin/reports/[id]/route');
const activityRoute = await import('../app/api/admin/activity/route');

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
             "safety_incident", "staff_action", "group_message", "groups"
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
