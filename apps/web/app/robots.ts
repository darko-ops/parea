/**
 * What a crawler is asked not to fetch.
 *
 * The second line of the same defence as the `X-Robots-Tag` header in
 * `next.config.ts`, not a replacement for it. This one stops a well-behaved
 * crawler from requesting these paths at all; the header is what stops a URL
 * discovered some other way — a pasted link in a public channel, a toolbar,
 * a prefetching mail client — from being indexed once it has been fetched.
 *
 * The landing page stays indexable. It is the only page with nothing private
 * on it, and being findable is the entire point of it.
 *
 * Listing the prefixes here does disclose their shape, which is why they are
 * prefixes and never tokens: `/e/` says events exist and says nothing about
 * which. Everything under them is unguessable and signed.
 */

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/e/', '/event/', '/group/', '/api/'],
      },
    ],
  };
}
