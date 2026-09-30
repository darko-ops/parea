/**
 * After sign-in, `next` may only send somebody somewhere on this site.
 */

import { describe, expect, it } from 'vitest';

import { sameOriginPath } from '../src/redirect';

const ORIGIN = 'https://www.parea.photos';

describe('where sign-in may send somebody', () => {
  it('keeps a path on this site, with its query and fragment', () => {
    expect(sameOriginPath('/e/abc?tab=people#top', ORIGIN)).toBe('/e/abc?tab=people#top');
  });

  it('refuses the shapes that start with one slash and leave the site', () => {
    // A backslash is read as a slash, and tabs and newlines are stripped.
    for (const next of ['/\\evil.com', '/\t/evil.com', '//evil.com', '/\\/evil.com', 'https://evil.com', 'javascript:alert(1)']) {
      expect(sameOriginPath(next, ORIGIN), next).toBeNull();
    }
  });

  it('says nothing for no `next` at all', () => {
    expect(sameOriginPath(null, ORIGIN)).toBeNull();
  });
});
