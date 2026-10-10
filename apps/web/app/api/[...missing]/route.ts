/**
 * Every `/api` path that is not a route: 404, in JSON, whatever the method.
 *
 * Without this, a GET to an unknown API path got Next's not-found page with a
 * 404, but a POST got the same HTML page with **200** — Next renders the page
 * for a non-GET request as it would for a server action, and keeps the status.
 * So a client calling a route that had been renamed, or a monitor probing one,
 * was told it worked. Specific routes always win over a catch-all, so this
 * answers only what nothing else does.
 */

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function missing() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export const GET = missing;
export const HEAD = missing;
export const POST = missing;
export const PUT = missing;
export const PATCH = missing;
export const DELETE = missing;
export const OPTIONS = missing;
