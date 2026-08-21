/**
 * What a link looks like in a chat window.
 *
 * A share link is `/e/<token>`, which is a route handler: it exchanges the
 * token for a capability, writes the participant row, and redirects. That is
 * right for a person and wrong for the fetcher that runs when the link is
 * pasted into iMessage, because a fetcher holds no cookie — so it was
 * redirected to the sign-in page, and the card in the chat took that page's
 * title. Every private event anybody sent read "Profile".
 *
 * The second half of the same bug is quieter and worse. On a public event the
 * redirect does not happen; the fetcher gets the exchange instead, which means
 * `ensureActor` mints an actor for Apple's crawler and `recordParticipant`
 * writes it in. Pasting a link into a group chat added a participant to the
 * event. The counts on the card — "6 people" — are the product's own claim
 * about who was there.
 *
 * So the fetchers are answered before anything happens: a small HTML document,
 * no cookie, no actor, no row.
 *
 * ## Why a list of names rather than a pattern
 *
 * Matching /bot|crawler|preview/ would catch more of them and would also,
 * eventually, catch a real browser — and the cost of that is not a bad card,
 * it is somebody tapping a link they were sent and not getting in. The list is
 * the ones that actually unfurl links people share. Anything not on it gets
 * the old behaviour, which is a poor preview rather than a broken door.
 */

/**
 * The fetchers that unfurl a pasted link.
 *
 * iMessage is the important one and it does not announce itself as Apple: its
 * fetcher sends a Safari UA with `facebookexternalhit/1.1 Facebot
 * Twitterbot/1.0` appended, which is why that string appears here rather than
 * anything Apple-shaped. `Applebot` is separate and is the search crawler.
 */
const UNFURLERS = [
  'facebookexternalhit',
  'facebot',
  'twitterbot',
  'slackbot',
  'slack-imgproxy',
  'discordbot',
  'telegrambot',
  'whatsapp',
  'linkedinbot',
  'skypeuripreview',
  'redditbot',
  'applebot',
  'googlebot',
  'bingbot',
  'embedly',
  'iframely',
  'quora link preview',
  'pinterest',
  'vkshare',
  'nuzzel',
  'outbrain',
];

export function isLinkUnfurler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return UNFURLERS.some((name) => ua.includes(name));
}

/**
 * HTML entities, on the way into a page and into an attribute at once.
 *
 * An event's name is whatever somebody typed, and it goes into both the title
 * element and a `content="…"` attribute. Both quote characters are escaped so
 * one function covers both positions rather than two that can be used in the
 * wrong place.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The card, and nothing else.
 *
 * The name and one fixed line. Not the caption, not the photo count, not a
 * photograph: this document is served to anything that fetches the URL, which
 * includes the scanners that mail systems and chat apps run over links before
 * a person ever sees them. The name is already the minimum needed for the card
 * to be worth having — "somebody sent you a link" is not an invitation anyone
 * can act on — and everything past it is a fact about the evening given to
 * whoever happens to touch the URL.
 *
 * `noindex` as well, because a preview fetcher and a search crawler are the
 * same shape and only one of them is welcome. The event pages carry it too;
 * this is the one page a crawler can reach without a credential.
 */
export function previewHtml(event: { name: string; url: string }): string {
  const title = escapeHtml(event.name);
  const description = 'Everyone’s photos from this, in one place.';
  const url = escapeHtml(event.url);
  const image = escapeHtml(new URL('/api/og', event.url).toString());

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Parea">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${image}">
</head>
<body>
<p>${title}</p>
<p>${escapeHtml(description)} <a href="${url}">Open it</a>.</p>
</body>
</html>
`;
}
