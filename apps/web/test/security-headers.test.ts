/**
 * The headers every page is served with. See `next.config.ts`.
 */

import { describe, expect, it } from 'vitest';

process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://publickey@o123.ingest.us.sentry.io/456';
const { default: config } = await import('../next.config');

const headersFor = async (path: string) => {
  const rules = await (config as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> }).headers();
  const all = rules.find((rule) => rule.source === '/:path*')!;
  return Object.fromEntries(all.headers.map((h) => [h.key, h.value])) as Record<string, string>;
};

describe('security headers', () => {
  it('enforces the part of the policy that cannot break a page', async () => {
    const h = await headersFor('/');
    const enforced = h['Content-Security-Policy']!;
    for (const directive of ["object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(enforced).toContain(directive);
    }
    // Scripts are restricted per page, by the proxy's nonce policy; this one
    // covers files and the API too, which have no nonce to give.
    expect(enforced).not.toMatch(/script-src/);
  });

  it('enforces scripts on a page by nonce, with nothing inline allowed', async () => {
    const { pagePolicy } = await import('../src/csp');
    const policy = pagePolicy('abc123', false);
    expect(policy).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain('report-uri https://o123.ingest.us.sentry.io/api/456/security/?sentry_key=publickey');
    expect(pagePolicy('abc123', true)).toContain("'unsafe-eval'");
  });

  it('sends what the policy saw to Sentry, rather than to nobody', async () => {
    const h = await headersFor('/');
    const uri = 'report-uri https://o123.ingest.us.sentry.io/api/456/security/?sentry_key=publickey';
    expect(h['Content-Security-Policy']).toContain(uri);
    expect(h['Content-Security-Policy-Report-Only']).toContain(uri);
  });

  it('covers every subdomain with HTTPS, and switches off what is never used', async () => {
    const h = await headersFor('/');
    expect(h['Strict-Transport-Security']).toBe('max-age=63072000; includeSubDomains');
    expect(h['Permissions-Policy']).toMatch(/camera=\(\), microphone=\(\), geolocation=\(\)/);
  });

  it('does not name the framework', () => {
    expect((config as { poweredByHeader?: boolean }).poweredByHeader).toBe(false);
  });
});
