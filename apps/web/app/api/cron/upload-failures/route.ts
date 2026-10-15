/**
 * Hourly: upload failures that look like a bug become a GitHub issue, which
 * starts the agent that tries to fix them. See `src/uploadPatterns.ts`.
 *
 * Without GITHUB_ISSUES_TOKEN it still looks, and says what it would have
 * filed in the log, so the check can be watched before it is trusted.
 */

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

import { cronGuard } from '@/cron';
import { getDb } from '@/db';
import { fileIssues, findPatterns } from '@/uploadPatterns';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;

  const patterns = await findPatterns(getDb());
  const token = process.env.GITHUB_ISSUES_TOKEN;
  if (!token) {
    for (const p of patterns) console.warn(`upload pattern (no GITHUB_ISSUES_TOKEN, not filed): ${p.stage} ${p.error} ×${p.failures}`);
    return NextResponse.json({ patterns: patterns.length, opened: [], filed: false });
  }

  try {
    const opened = await fileIssues(patterns, {
      token,
      repo: process.env.GITHUB_ISSUES_REPO || 'darko-ops/parea',
    });
    return NextResponse.json({ patterns: patterns.length, opened, filed: true });
  } catch (err) {
    Sentry.captureException(err, { tags: { kind: 'upload_patterns' } });
    await Sentry.flush(2000).catch(() => false);
    return NextResponse.json({ error: 'github_failed' }, { status: 502 });
  }
}
