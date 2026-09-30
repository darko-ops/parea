/**
 * The guards on verification texts — security review H10.
 *
 * Texting a number the caller chose spends money on a stranger's say-so, so
 * texts go only to the countries Parea serves, one account gets a handful a
 * day, and the whole service has a daily ceiling.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { smsCountries, textableCountry } from '@/phone';
import { PHONE_ACCOUNT_LIMIT, PHONE_DAILY_LIMIT } from '@/ratelimit';

const US_CA_GB = ['US', 'CA', 'GB'];

describe('textableCountry', () => {
  it('texts the US, Canada and the UK', () => {
    expect(textableCountry('+14155550123', US_CA_GB)).toBe(true); // San Francisco
    expect(textableCountry('+14165550123', US_CA_GB)).toBe(true); // Toronto
    expect(textableCountry('+447700900123', US_CA_GB)).toBe(true);
  });

  it('keeps US territories, which share the plan and are the US', () => {
    expect(textableCountry('+17875550123', US_CA_GB)).toBe(true); // Puerto Rico
  });

  it('refuses the Caribbean +1 numbers pumping schemes favour', () => {
    expect(textableCountry('+18765550123', US_CA_GB)).toBe(false); // Jamaica
    expect(textableCountry('+18095550123', US_CA_GB)).toBe(false); // Dominican Republic
    expect(textableCountry('+12425550123', US_CA_GB)).toBe(false); // Bahamas
  });

  it('refuses everywhere not on the list', () => {
    expect(textableCountry('+33612345678', US_CA_GB)).toBe(false);
    expect(textableCountry('+2348012345678', US_CA_GB)).toBe(false);
    expect(textableCountry('+37360123456', US_CA_GB)).toBe(false);
  });

  it('refuses a +1 number of the wrong length', () => {
    expect(textableCountry('+1415555012', US_CA_GB)).toBe(false);
  });
});

describe('smsCountries', () => {
  it('defaults to the US, Canada and the UK', () => {
    expect(smsCountries(undefined)).toEqual(US_CA_GB);
  });

  it('reads a list, ignoring what it does not know', () => {
    expect(smsCountries(' us, fr ,XX')).toEqual(['US', 'FR']);
  });

  it('never ends up empty, which would read as "text everywhere" to nobody', () => {
    expect(smsCountries('XX')).toEqual(US_CA_GB);
  });
});

describe('the limits', () => {
  it('cap an account at five texts a day and the service at two hundred, closed on failure', () => {
    expect(PHONE_ACCOUNT_LIMIT).toMatchObject({ max: 5, windowSeconds: 86_400, failClosed: true });
    expect(PHONE_DAILY_LIMIT).toMatchObject({ max: 200, windowSeconds: 86_400, failClosed: true });
  });

  it('are all checked before a text is sent', () => {
    const route = readFileSync(
      fileURLToPath(new URL('../app/api/account/phone/route.ts', import.meta.url)),
      'utf8',
    );
    const send = route.indexOf('texter.send(');
    for (const guard of ['textableCountry(e164)', 'PHONE_ACCOUNT_LIMIT', 'PHONE_DAILY_LIMIT']) {
      const at = route.indexOf(guard);
      expect(at, guard).toBeGreaterThan(0);
      expect(at, guard).toBeLessThan(send);
    }
  });
});
