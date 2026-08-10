/**
 * What a tapped link resolves to — design §9.
 *
 * The two URL shapes parse differently, and that is the whole reason this has
 * a test: in `parea://e/<token>` the `e` is the URL's *host*, not a path
 * segment, because a custom-scheme URL has no authority and whatever follows
 * `//` becomes one. A parser written against `https://` alone reads that as an
 * empty path and returns nothing — on one platform, in one launch mode, with
 * the only symptom being that the app opens to the wrong screen.
 *
 * The alternative to this file is rebuilding the app, reinstalling it, and
 * tapping a link.
 */

import { describe, expect, it } from 'vitest';

import { arrivalFromUrl } from '../src/links';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

describe('links that should open an event', () => {
  it('takes a verified Universal Link', () => {
    expect(arrivalFromUrl(`https://parea.photos/e/${TOKEN}`)).toEqual({
      linkToken: TOKEN,
    });
  });

  it('takes the custom scheme, where the path segment is really the host', () => {
    expect(arrivalFromUrl(`parea://e/${TOKEN}`)).toEqual({ linkToken: TOKEN });
  });

  it('takes the custom scheme written with an empty authority', () => {
    // `parea:///e/<token>` is what some tooling generates, and it parses with
    // an empty host and a full path — the other way round from the above.
    expect(arrivalFromUrl(`parea:///e/${TOKEN}`)).toEqual({ linkToken: TOKEN });
  });

  it('ignores the query a chat app staples on', () => {
    expect(arrivalFromUrl(`https://parea.photos/e/${TOKEN}?utm_source=whatsapp`)).toEqual(
      { linkToken: TOKEN },
    );
  });

  it('ignores a trailing slash', () => {
    expect(arrivalFromUrl(`https://parea.photos/e/${TOKEN}/`)).toEqual({
      linkToken: TOKEN,
    });
  });

  it('ignores a fragment', () => {
    expect(arrivalFromUrl(`https://parea.photos/e/${TOKEN}#top`)).toEqual({
      linkToken: TOKEN,
    });
  });

  it('does not care which host claimed it', () => {
    // The OS only routes domains this app is entitled to, so re-checking the
    // host here would add a place to get the domain wrong and stop nothing:
    // a link is a credential, and whoever has one can already use it.
    expect(arrivalFromUrl(`https://staging.parea.photos/e/${TOKEN}`)).toEqual({
      linkToken: TOKEN,
    });
  });
});

describe('links that should not', () => {
  it('refuses the post-exchange URL, which carries no credential', () => {
    // `/event/<id>` works in a browser only because the link was already
    // traded for a capability cookie. Neither platform routes that path to
    // us, but the custom scheme has no filter, so it is answered rather than
    // assumed away.
    expect(
      arrivalFromUrl('https://parea.photos/event/3f1c9a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b'),
    ).toBeNull();
    expect(arrivalFromUrl('parea://event/3f1c9a2e')).toBeNull();
  });

  it('refuses a link with no token on it', () => {
    expect(arrivalFromUrl('https://parea.photos/e')).toBeNull();
    expect(arrivalFromUrl('https://parea.photos/e/')).toBeNull();
    expect(arrivalFromUrl('parea://e')).toBeNull();
  });

  it('refuses something shaped like a token but not one', () => {
    expect(arrivalFromUrl(`https://parea.photos/e/${TOKEN}x`)).toBeNull();
    expect(arrivalFromUrl('https://parea.photos/e/short')).toBeNull();
    expect(arrivalFromUrl('https://parea.photos/e/AbCdEfGhIjKlMnOpQrSt-v')).toBeNull();
  });

  it('refuses the landing page and the marketing site', () => {
    expect(arrivalFromUrl('https://parea.photos/')).toBeNull();
    expect(arrivalFromUrl('https://parea.photos/safety')).toBeNull();
  });

  it('does not throw on something that is not a URL', () => {
    // `Linking` hands over whatever the OS gives it.
    for (const junk of ['', 'not a url', 'amber-fox', '://', 'javascript:alert(1)']) {
      expect(arrivalFromUrl(junk), junk).toBeNull();
    }
  });
});
