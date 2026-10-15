/**
 * Upload failures that look like a bug rather than somebody's signal.
 *
 * Most rows in `upload_failure` are one person's tab closing or one phone
 * losing its connection, and nothing here can fix those. What a fix can reach
 * is a pattern: the same failure for several people, a refusal no network
 * explains, a photo the deriver could not process. Those become a GitHub
 * issue labelled `upload-failure`, and the label starts an agent
 * (`.github/workflows/upload-failure-fix.yml`) that diagnoses it and opens a
 * pull request for somebody to merge.
 *
 * The issue carries counts and errors — never a handle, a name or a full
 * browser string — because it leaves this database for GitHub. One issue per
 * pattern while it is open: the fingerprint in its body is how a repeat is
 * recognised.
 */

import { schema } from '@parea/core';
import { and, gte, ne, or, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import type { Db } from './db';

/** How far back one check looks. Wider than the cron's hour, so a slow build-up still counts. */
export const PATTERN_WINDOW_HOURS = 6;
export const ISSUE_LABEL = 'upload-failure';

export type Pattern = {
  fingerprint: string;
  source: 'client' | 'server';
  stage: string;
  error: string;
  client: string | null;
  kind: string | null;
  failures: number;
  people: number;
  photos: number;
  first: string;
  last: string;
  causes: string[];
  devices: string[];
  types: string[];
};

/**
 * Whether a group of failures is worth an agent's time.
 *
 * Thresholds by how much the failure says on its own: a photo the deriver
 * gave up on is a bug every time; a 4xx from storage for one person's whole
 * selection is very likely one; "waiting for a connection" means something
 * only when several people say it at once.
 */
export function isPattern(g: Omit<Pattern, 'fingerprint' | 'causes' | 'devices' | 'types' | 'first' | 'last'>): boolean {
  if (g.kind === 'SourceGone') return false;
  if (g.source === 'server') {
    if (g.stage === 'derive') return g.photos >= 1;
    if (g.stage === 'abandoned') return g.people >= 3;
    return g.people >= 2;
  }
  if (g.kind === 'Offline') return g.people >= 3;
  return g.people >= 2 || g.photos >= 5;
}

export function fingerprint(g: { source: string; stage: string; error: string; client: string | null }): string {
  return createHash('sha256')
    .update([g.source, g.stage, g.error, g.client ?? ''].join('|'))
    .digest('hex')
    .slice(0, 12);
}

/** "iPhone · Safari 18", from a user agent — enough to point at a platform, no more. */
export function device(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  const browser =
    /Expo|okhttp|CFNetwork|Darwin/.test(userAgent) && !/Mozilla/.test(userAgent)
      ? 'app'
      : /Edg\//.test(userAgent)
        ? 'Edge'
        : /CriOS|Chrome\//.test(userAgent)
          ? 'Chrome'
          : /FxiOS|Firefox\//.test(userAgent)
            ? 'Firefox'
            : /Safari\//.test(userAgent)
              ? ['Safari', /Version\/(\d+)/.exec(userAgent)?.[1]].filter(Boolean).join(' ')
              : null;
  const parts = [os, browser].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export async function findPatterns(db: Db, now = new Date()): Promise<Pattern[]> {
  const since = new Date(now.getTime() - PATTERN_WINDOW_HOURS * 3600_000);
  const f = schema.uploadFailures;

  const groups = await db
    .select({
      source: f.source,
      stage: f.stage,
      error: f.error,
      client: f.client,
      // The queue's reading of it; mixed groups take the commonest.
      kind: sql<string | null>`mode() within group (order by ${f.kind})`,
      failures: sql<number>`count(*)::int`,
      people: sql<number>`count(distinct ${f.actorId})::int`,
      photos: sql<number>`count(distinct coalesce(${f.photoId}::text, ${f.id}::text))::int`,
      first: sql<string>`min(${f.createdAt})`,
      last: sql<string>`max(${f.createdAt})`,
      causes: sql<string[]>`(array_agg(distinct left(${f.cause}, 300)) filter (where ${f.cause} is not null))[1:5]`,
      agents: sql<string[]>`(array_agg(distinct ${f.userAgent}) filter (where ${f.userAgent} is not null))[1:40]`,
      types: sql<string[]>`(array_agg(distinct ${f.mime}) filter (where ${f.mime} is not null))[1:10]`,
    })
    .from(f)
    .where(and(gte(f.createdAt, since), or(isNull(f.kind), ne(f.kind, 'SourceGone'))))
    .groupBy(f.source, f.stage, f.error, f.client);

  return groups
    .filter((g) => isPattern({ ...g, source: g.source as 'client' | 'server' }))
    .map((g) => ({
      fingerprint: fingerprint(g),
      source: g.source as 'client' | 'server',
      stage: g.stage,
      error: g.error,
      client: g.client,
      kind: g.kind,
      failures: g.failures,
      people: g.people,
      photos: g.photos,
      first: new Date(g.first).toISOString(),
      last: new Date(g.last).toISOString(),
      causes: g.causes ?? [],
      devices: [...new Set((g.agents ?? []).map(device).filter((d): d is string => !!d))].sort(),
      types: g.types ?? [],
    }));
}

const STAGE: Record<string, string> = {
  presign: 'asking for an upload URL (POST /api/events/[id]/uploads)',
  put: 'sending the file to storage (PUT to the presigned R2 URL)',
  complete: 'confirming it arrived (POST /api/uploads/[id]/complete)',
  abandoned: 'never confirmed: granted an upload URL, then nothing (swept by services/deriver/src/jobs.ts)',
  derive: 'processing by the deriver (services/deriver)',
};

export function issueFor(p: Pattern): { title: string; body: string } {
  const who = p.source === 'server' ? 'server' : (p.client ?? 'client');
  const title = `Upload failures: ${p.error.slice(0, 80)} (${p.stage}, ${who})`;
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- \`${x.replace(/`/g, "'")}\``).join('\n') : '- (none recorded)');
  const body = [
    `Parea's upload-failure check found a pattern in the last ${PATTERN_WINDOW_HOURS} hours.`,
    '',
    `| | |`,
    `|---|---|`,
    `| Step | ${STAGE[p.stage] ?? p.stage} |`,
    `| Seen by | ${p.source === 'server' ? 'the server' : `the ${who} client's upload queue`} |`,
    `| Error | \`${p.error.replace(/`/g, "'")}\` |`,
    `| Queue's reading | ${p.kind ?? '—'} |`,
    `| Failures | ${p.failures} across ${p.photos} photo${p.photos === 1 ? '' : 's'} and ${p.people} ${p.people === 1 ? 'person' : 'people'} |`,
    `| First / last | ${p.first} / ${p.last} |`,
    `| File types | ${p.types.join(', ') || '—'} |`,
    `| Devices | ${p.devices.join(', ') || '—'} |`,
    '',
    'Underlying causes (as reported, up to five):',
    list(p.causes),
    '',
    'Who was affected is not in this issue on purpose. Staff can see each failure on the hub (Parea → Upload failures).',
    '',
    `<!-- upload-failure-fingerprint: ${p.fingerprint} -->`,
  ].join('\n');
  return { title, body };
}

type GitHub = { token: string; repo: string; fetch?: typeof fetch };

/** Opens an issue for each pattern that has none open. Returns the numbers opened. */
export async function fileIssues(patterns: Pattern[], gh: GitHub): Promise<number[]> {
  if (patterns.length === 0) return [];
  const doFetch = gh.fetch ?? fetch;
  const api = `https://api.github.com/repos/${gh.repo}`;
  const headers = {
    authorization: `Bearer ${gh.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'parea-upload-failures',
  };

  const res = await doFetch(`${api}/issues?state=open&labels=${ISSUE_LABEL}&per_page=100`, { headers });
  if (!res.ok) throw new Error(`github: listing issues failed: ${res.status}`);
  const open = (await res.json()) as { body: string | null }[];
  const known = new Set(
    open.flatMap((i) => [...(i.body ?? '').matchAll(/upload-failure-fingerprint: (\w+)/g)].map((m) => m[1]!)),
  );

  const opened: number[] = [];
  for (const p of patterns) {
    if (known.has(p.fingerprint)) continue;
    const { title, body } = issueFor(p);
    const made = await doFetch(`${api}/issues`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ title, body, labels: [ISSUE_LABEL] }),
    });
    if (!made.ok) throw new Error(`github: opening an issue failed: ${made.status}`);
    opened.push(((await made.json()) as { number: number }).number);
    known.add(p.fingerprint);
  }
  return opened;
}
