/**
 * "Get the app" on an iPhone: Safari's own banner where Safari draws it, and
 * the popup everywhere else on iOS. See `GetTheApp.tsx`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { APP_STORE_URL, isIos, isSafari } from '../app/components/GetTheApp';

const UA = {
  safari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  chrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  instagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101',
  ipadAsMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

describe('who gets the popup', () => {
  it('is an iPhone in any browser, and an iPad that says it is a Mac', () => {
    expect(isIos(UA.safari, 'iPhone', 5)).toBe(true);
    expect(isIos(UA.instagram, 'iPhone', 5)).toBe(true);
    expect(isIos(UA.ipadAsMac, 'MacIntel', 5)).toBe(true);
    expect(isIos(UA.ipadAsMac, 'MacIntel', 0)).toBe(false);
    expect(isIos(UA.android, 'Linux armv8l', 5)).toBe(false);
  });

  it('leaves Safari to its own banner and shows everywhere else', () => {
    expect(isSafari(UA.safari)).toBe(true);
    expect(isSafari(UA.chrome)).toBe(false);
    expect(isSafari(UA.instagram)).toBe(false);
  });

  it('sends people to the App Store page, and the layout asks Safari for its banner', () => {
    expect(APP_STORE_URL).toBe('https://apps.apple.com/us/app/parea-photos-with-friends/id6819904142');
    const layout = readFileSync(fileURLToPath(new URL('../app/layout.tsx', import.meta.url)), 'utf8');
    expect(layout).toMatch(/itunes: \{ appId: '6819904142' \}/);
    expect(layout).toMatch(/<GetTheApp \/>/);
  });
});
