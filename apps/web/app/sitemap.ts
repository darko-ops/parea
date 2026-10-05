/**
 * The pages a search engine is welcome to.
 *
 * Short on purpose, and a list rather than anything generated: everything else
 * here is somebody's roll, group or profile, and is `noindex` — see `robots.ts`
 * and the headers in `next.config.ts`. A page joins this list only when it has
 * nothing private on it, which is a decision to make by hand.
 */

import type { MetadataRoute } from 'next';

import { SITE } from '@/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE}/safety`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE}/texts`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE}/terms`, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
