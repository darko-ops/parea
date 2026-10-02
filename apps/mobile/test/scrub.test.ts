import { describe, expect, it } from 'vitest';

import { scrub, scrubText, scrubUrl } from '../src/scrub';

describe('what a crash report from the phone may say', () => {
  it('keeps a link’s shape and never its token', () => {
    expect(scrubUrl('https://www.parea.photos/e/AbC123xyz')).toBe('https://www.parea.photos/e/[token]');
    expect(scrubUrl('parea://e/AbC123xyz?from=qr')).toBe('parea://e/[token]');
  });

  it('drops every query string, the album token included', () => {
    expect(scrubUrl('https://www.parea.photos/api/events/42/photos?t=secret-token')).toBe(
      'https://www.parea.photos/api/events/42/photos',
    );
  });

  it('scrubs URLs, emails and phone numbers inside free text', () => {
    expect(scrubText('fetch failed: /api/events/42/read?t=abc for sam@example.com, +1 (415) 555-0100')).toBe(
      'fetch failed: /api/events/42/read for [email], [number]',
    );
  });

  it('blanks secret-bearing keys and drops the user, at any depth', () => {
    const event = {
      message: 'boom at https://www.parea.photos/e/tok?x=1',
      user: { id: 'actor-1', email: 'sam@example.com' },
      request: { url: 'https://www.parea.photos/api/join', headers: { authorization: 'Bearer abc', cookie: 'p=1' } },
      breadcrumbs: [{ category: 'fetch', data: { url: '/api/events/1/photos?t=tok', status_code: 500 } }],
      extra: { linkToken: 'tok', code: 'apple-river-stone', count: 3 },
    };
    expect(scrub(event)).toEqual({
      message: 'boom at https://www.parea.photos/e/[token]',
      request: { url: 'https://www.parea.photos/api/join', headers: { authorization: '[redacted]', cookie: '[redacted]' } },
      breadcrumbs: [{ category: 'fetch', data: { url: '/api/events/1/photos', status_code: 500 } }],
      extra: { linkToken: '[redacted]', code: '[redacted]', count: 3 },
    });
  });

  it('leaves numbers, booleans and stack frames alone', () => {
    const frame = { filename: 'app:///index.bundle', lineno: 120, colno: 4, in_app: true, function: 'onPress' };
    expect(scrub(frame)).toEqual(frame);
  });
});
