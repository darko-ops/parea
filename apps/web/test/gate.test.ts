/**
 * Nothing on parea.photos without an account, except the pages that have to
 * be public. See `@/gate`.
 */

import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isPublicPage, PATH_HEADER, signInFor } from '@/gate';
import { proxy } from '../proxy';

const page = (path: string, cookie?: string) =>
  new NextRequest(`https://www.parea.photos${path}`, cookie ? { headers: { cookie } } : undefined);

describe('which pages are public', () => {
  it('are sign-in, the legal pages, the SMS page and share links', () => {
    for (const path of ['/account', '/privacy', '/terms', '/safety', '/texts', '/texts/', '/e/abcdefghijklmnopqrstuv']) {
      expect(isPublicPage(path), path).toBe(true);
    }
  });

  it('are not anything else, home included', () => {
    for (const path of ['/', '/events', '/event/123', '/u/someone', '/groups', '/find', '/activity', '/moments/1', '/privacy-extra']) {
      expect(isPublicPage(path), path).toBe(false);
    }
  });
});

describe('the proxy, for pages', () => {
  it('sends a visitor with no session to sign in, then back where they were going', () => {
    const res = proxy(page('/events?lens=mine'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`https://www.parea.photos${signInFor('/events?lens=mine')}`);
  });

  it('lets the front page through, where the layout draws the sign-in card', () => {
    expect(proxy(page('/')).headers.get('location')).toBeNull();
  });

  it('lets the public pages through without a session', () => {
    for (const path of ['/privacy', '/terms', '/account', '/e/abcdefghijklmnopqrstuv']) {
      expect(proxy(page(path)).headers.get('location'), path).toBeNull();
    }
  });

  it('lets a session through, and tells the layout which page it is', () => {
    const res = proxy(page('/events', 'pa_actor=anything'));
    expect(res.headers.get('location')).toBeNull();
    // NextResponse.next({ request }) passes rewritten request headers on as
    // `x-middleware-request-*`.
    expect(res.headers.get(`x-middleware-request-${PATH_HEADER}`)).toBe('/events');
  });
});

describe('the layout', () => {
  const LAYOUT = readFileSync(fileURLToPath(new URL('../app/layout.tsx', import.meta.url)), 'utf8');

  it('asks the database for an account, not just for a cookie', () => {
    expect(LAYOUT).toMatch(/isSignedIn\(getDb\(\), actorId\)/);
  });

  it('draws the sign-in card on the front page and sends every other page to sign in', () => {
    expect(LAYOUT).toMatch(/if \(pathname === '\/'\) return 'sign-in';\s*redirect\(signInFor\(path\)\);/);
    expect(LAYOUT).toMatch(/shown === 'show' \? children : <SignInPage \/>/);
  });
});
