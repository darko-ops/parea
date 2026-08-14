/**
 * The card a shared link draws, and what it must not do on the way.
 *
 * `/e/<token>` is the product's front door and it has side effects: it mints
 * an actor, writes a participant row and sets a capability cookie. All three
 * are right for a person and wrong for the fetcher that runs the moment a link
 * is pasted into a chat — which is not a hypothetical, it is what was
 * happening: on a public album the crawler was recorded as somebody who was
 * there, and on a private one it was redirected to the sign-in page, so every
 * card in every chat read "Profile".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { escapeHtml, isLinkUnfurler, previewHtml } from '@/preview';
import { stripComments } from './support/source';

describe('which fetchers get a card instead of a door', () => {
  it('knows iMessage, which does not announce itself as Apple', () => {
    // The one that matters most here, and the one nobody guesses: its UA is
    // Safari's with Facebook's and Twitter's bot names stapled on.
    expect(
      isLinkUnfurler(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 ' +
          '(KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 ' +
          'facebookexternalhit/1.1 Facebot Twitterbot/1.0',
      ),
    ).toBe(true);
  });

  it('knows the others people actually paste links into', () => {
    for (const ua of [
      'WhatsApp/2.23.20.0',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; LinkedInBot/1.0)',
      'Mozilla/5.0 (compatible; Applebot/0.1)',
    ]) {
      expect(isLinkUnfurler(ua), ua).toBe(true);
    }
  });

  it('lets every real browser through to the door', () => {
    /*
     * The asymmetry that decides the shape of this: a browser wrongly treated
     * as a crawler is somebody tapping a link they were sent and not getting
     * in, where a crawler wrongly treated as a browser is only a poor card.
     * So the match is a list of names and not /bot|crawler|preview/.
     */
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    ]) {
      expect(isLinkUnfurler(ua), ua).toBe(false);
    }
    expect(isLinkUnfurler(null)).toBe(false);
    expect(isLinkUnfurler('')).toBe(false);
  });
});

describe('what the card says', () => {
  const card = previewHtml({
    name: 'mayflower',
    url: 'https://www.parea.photos/e/8LJqdbeCbvsTQvHmTbcdMQ',
  });

  it('is the album’s name, so the card is worth having', () => {
    expect(card).toContain('<title>mayflower</title>');
    expect(card).toContain('property="og:title" content="mayflower"');
  });

  it('carries an image that is the same for every album', () => {
    // The mark, not a photograph. Whatever is in the image is handed to every
    // scanner that touches the URL, and a photograph is the one thing this
    // product exists to keep among the people who were there.
    expect(card).toContain('content="https://www.parea.photos/api/og"');
  });

  it('escapes a name somebody typed, in the tag and in the attribute', () => {
    const nasty = previewHtml({ name: '"><script>alert(1)</script>', url: 'https://x/e/t' });
    expect(nasty).not.toContain('<script>');
    expect(nasty).toContain('&quot;&gt;&lt;script&gt;');
    expect(escapeHtml(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &#39; f',
    );
  });

  it('tells crawlers not to index it', () => {
    // The one page in the product a crawler can reach without a credential.
    expect(card).toContain('name="robots" content="noindex, nofollow"');
  });
});

/**
 * The ordering property, asserted on the route.
 *
 * Everything below the preview branch in that file has a side effect, and the
 * bug this fixes was a preview fetcher being given all three of them. A test
 * of `isLinkUnfurler` alone would keep passing if somebody moved the branch
 * down two lines.
 */
describe('a preview costs nothing', () => {
  const source = stripComments(
    readFileSync(
      fileURLToPath(new URL('../app/e/[token]/route.ts', import.meta.url)),
      'utf8',
    ),
  );

  const at = (needle: string) => {
    const index = source.indexOf(needle);
    expect(index, `expected to find ${needle}`).toBeGreaterThan(-1);
    return index;
  };

  it('answers before anything is written or set', () => {
    const preview = at('isLinkUnfurler(');
    expect(preview).toBeLessThan(at('ensureActor('));
    expect(preview).toBeLessThan(at('recordParticipant('));
    expect(preview).toBeLessThan(at('grantCapability('));
    // And before the redirect to sign-in, which is where "Profile" came from.
    expect(preview).toBeLessThan(at('/account?next='));
  });

  it('returns rather than falling through', () => {
    const branch = source.slice(at('isLinkUnfurler('), at('const requester ='));
    expect(branch).toMatch(/return new Response\(/);
  });
});
