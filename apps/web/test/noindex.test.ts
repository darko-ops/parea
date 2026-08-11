/**
 * Nothing behind a link is indexable.
 *
 * Possession of the link is the entire access model, so a link that reaches a
 * crawler is a set of someone's photos in a search index — and unlike most
 * leaks, that one is served back to strangers on purpose, at scale, for as
 * long as the cache lives.
 *
 * These assert the configuration rather than a running server, because what
 * can go wrong here is a path pattern that quietly matches nothing. A regex
 * that covers `/event/:id` and misses `/event/:id/manage` looks correct in a
 * diff and leaves the host's controls open to indexing.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import config from '../next.config';
import robots from '../app/robots';

const read = (path: string) =>
  readFile(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

async function headersFor(pathname: string): Promise<Record<string, string>> {
  const rules = await config.headers!();
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (!matches(rule.source, pathname)) continue;
    for (const header of rule.headers) out[header.key.toLowerCase()] = header.value;
  }
  return out;
}

/**
 * Enough of Next's `source` syntax for the patterns this config uses.
 *
 * Hand-rolled because `path-to-regexp` is bundled inside Next rather than
 * resolvable here. It handles exactly three forms, all of which begin a
 * segment: `/:name`, `/:name(alt|alt)` and `/:name*`. A matcher that matched
 * nothing would be the dangerous failure — it would report every path as
 * unprotected — which is why the assertions below are that the private paths
 * *have* the header, and only one asserts an absence.
 */
function matches(source: string, pathname: string): boolean {
  const token = /\/:(\w+)(?:\(([^)]*)\))?(\*)?/g;
  const escape = (literal: string) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let pattern = '';
  let last = 0;
  for (let m = token.exec(source); m; m = token.exec(source)) {
    pattern += escape(source.slice(last, m.index));
    const [, , group, star] = m;
    if (star) pattern += '(?:/.*)?';
    else if (group) pattern += `/(?:${group})`;
    else pattern += '/[^/]+';
    last = m.index + m[0].length;
  }
  pattern += escape(source.slice(last));
  return new RegExp(`^${pattern}$`).test(pathname);
}

const PRIVATE = [
  '/e/AbCdEfGhIjKlMnOpQrStUv',
  '/account',
  '/event/3f1c9a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
  '/event/3f1c9a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/manage',
  '/group/3f1c9a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b',
  '/api/events/3f1c9a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b/photos',
];

describe('X-Robots-Tag', () => {
  it.each(PRIVATE)('marks %s noindex', async (pathname) => {
    const headers = await headersFor(pathname);
    expect(headers['x-robots-tag']).toBeDefined();
    expect(headers['x-robots-tag']).toContain('noindex');
    expect(headers['x-robots-tag']).toContain('nofollow');
  });

  it('tells crawlers not to index the photos either', async () => {
    // The images come from the Worker on another origin, so the page's own
    // directive is what speaks for them.
    const headers = await headersFor('/event/3f1c9a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b');
    expect(headers['x-robots-tag']).toContain('noimageindex');
  });

  it.each(['/', '/safety', '/privacy', '/terms'])(
    'leaves %s indexable',
    async (pathname) => {
      // The pages with nothing private on them, where being findable is the
      // job: the landing page sells the product, and App Store review has to
      // reach the other three without being sent a link.
      expect((await headersFor(pathname))['x-robots-tag']).toBeUndefined();
    },
  );

  it('keeps the link out of the Referer on the way anywhere else', async () => {
    // Same threat, different channel: the link is the credential, and a
    // Referer carries it to whatever a visitor clicks next.
    expect((await headersFor('/event/x'))['referrer-policy']).toBe('no-referrer');
  });
});

describe('robots.txt', () => {
  it('disallows the private prefixes and allows the landing page', () => {
    const [rule] = robots().rules as { allow?: string; disallow?: string[] }[];
    expect(rule!.allow).toBe('/');
    expect(rule!.disallow).toEqual(
      expect.arrayContaining(['/e/', '/event/', '/group/', '/account', '/api/']),
    );
  });

  it('names prefixes and never a token', () => {
    // Disclosing that events exist is free. Disclosing one is not.
    const [rule] = robots().rules as { disallow?: string[] }[];
    for (const path of rule!.disallow ?? []) {
      expect(path.split('/').filter(Boolean)).toHaveLength(1);
    }
  });
});

describe('the pages say so themselves', () => {
  // The header is a deployment property — applied by the Next server, and not
  // necessarily by whatever else might front it. The page-level directive
  // survives that.
  it.each([
    'app/event/[id]/page.tsx',
    'app/event/[id]/manage/page.tsx',
    'app/group/[id]/page.tsx',
    'app/account/page.tsx',
  ])('%s exports robots metadata', async (path) => {
    expect(await read(`../${path}`)).toMatch(/robots:\s*\{\s*index:\s*false/);
  });
});
