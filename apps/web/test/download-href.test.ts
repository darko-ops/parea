/**
 * Download links that save, not open: see `app/components/downloadHref.ts`.
 */

import { describe, expect, it } from 'vitest';

import { downloadHref } from '../app/components/downloadHref';

describe('downloadHref', () => {
  it('asks the image host for an attachment, keeping the signature intact', () => {
    expect(downloadHref('https://img.parea.photos/img/e/h/full.jpg?v=1&e=2&s=abc')).toBe(
      'https://img.parea.photos/img/e/h/full.jpg?v=1&e=2&s=abc&download=1',
    );
    expect(downloadHref('https://img.parea.photos/x.jpg')).toBe('https://img.parea.photos/x.jpg?download=1');
  });

  it('leaves a link where `download` already works, and nothing as nothing', () => {
    expect(downloadHref('blob:https://www.parea.photos/123')).toBe('blob:https://www.parea.photos/123');
    expect(downloadHref('/api/photo/1')).toBe('/api/photo/1');
    expect(downloadHref(null)).toBeUndefined();
  });
});
