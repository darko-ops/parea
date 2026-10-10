import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cronGuard } from '@/cron';

function call(auth?: string) {
  return cronGuard(new Request('https://parea.test/api/cron/x', auth ? { headers: { authorization: auth } } : {}));
}

describe('cronGuard', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret';
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it('lets the scheduler through', () => {
    expect(call('Bearer cron-secret')).toBeNull();
  });

  it('refuses a wrong secret of the same length, a prefix, and a missing scheme', () => {
    expect(call('Bearer cron-secreT')?.status).toBe(404);
    expect(call('Bearer cron')?.status).toBe(404);
    expect(call('cron-secret')?.status).toBe(404);
    expect(call()?.status).toBe(404);
  });

  it('does nothing without a secret set', () => {
    delete process.env.CRON_SECRET;
    expect(call('Bearer ')?.status).toBe(503);
  });
});
