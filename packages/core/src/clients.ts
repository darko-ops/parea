/**
 * Naming the thing at the other end of a request — design §3.
 *
 * One job, and a narrow one: turn what a client volunteers into the two words
 * a person needs to recognise their own laptop in a list. "Safari on iPhone"
 * is the whole product of this file.
 *
 * ## Why this is not a user-agent parsing library
 *
 * Those exist, they are large, and they are large because they answer a
 * different question — which rendering engine, which minor version, is this a
 * bot — for an audience of analytics. The question here is "is one of these
 * not me?", and it is answered by a browser family and a device family. Two
 * dozen lines of patterns cover every client this product will meet, and the
 * failure mode of a miss is a row that says "A browser", which is still a row
 * somebody can date-stamp and sign out.
 *
 * ## Why not client hints
 *
 * `Sec-CH-UA-Platform` is the modern answer and it is a second source for the
 * same fact. Chrome's user-agent reduction froze the version numbers and kept
 * the platform token, so the string still says `Macintosh` or `Android`, and
 * a hint that agrees adds nothing while a hint that disagrees is a bug nobody
 * will find. One source.
 *
 * ## Nothing here is trusted
 *
 * A user agent is a string the caller chose. Everything this produces is
 * decoration on a list — it decides no access, and a client that lies about
 * itself has lied about the label on its own row.
 */

/** What kind of client a credential was issued to. */
export type ClientKind = 'browser' | 'ios' | 'android';

export type ClientDescription = {
  kind: ClientKind;
  /** "Safari", "Chrome", "Parea". Null when the string said nothing useful. */
  client: string | null;
  /** "iPhone", "macOS", "Windows". Null likewise. */
  platform: string | null;
};

/**
 * Ordered, and the order is the whole correctness argument.
 *
 * Every Chromium browser says `Chrome`, and most of them say `Safari` too —
 * Edge's user agent ends `Chrome/… Safari/… Edg/…`. So the specific token has
 * to be tested before the generic one it also carries, and Safari, which is
 * the token everybody borrowed, can only be concluded last.
 */
const BROWSERS: [RegExp, string][] = [
  [/\bEdgi?A?(?:OS)?\//, 'Edge'],
  [/\bOPR\/|\bOpera\//, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\bFirefox\/|\bFxiOS\//, 'Firefox'],
  [/\bDuckDuckGo\//, 'DuckDuckGo'],
  [/\bBrave\//, 'Brave'],
  // Chrome on iOS, which is a Safari engine wearing a Chrome badge. Tested
  // before plain Chrome because the string carries both.
  [/\bCriOS\//, 'Chrome'],
  [/\bChrome\//, 'Chrome'],
  // Last. `Safari/` appears in almost every Chromium string ever shipped, so
  // it only means Safari once nothing above has claimed it.
  [/\bSafari\//, 'Safari'],
];

const PLATFORMS: [RegExp, string][] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\biPod\b/, 'iPod'],
  [/\bAndroid\b/, 'Android'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bWindows NT\b/, 'Windows'],
  [/\bLinux\b/, 'Linux'],
];

function match(table: [RegExp, string][], agent: string): string | null {
  for (const [pattern, name] of table) if (pattern.test(agent)) return name;
  return null;
}

/**
 * What to call the client that sent this request.
 *
 * `kind` is passed in rather than sniffed when the caller already knows — the
 * app says which store it came from when it asks for a token, and guessing
 * from a string would be a worse answer to a question already answered.
 */
export function describeClient(
  userAgent: string | null | undefined,
  kind: ClientKind = 'browser',
): ClientDescription {
  if (kind !== 'browser') {
    return { kind, client: 'Parea', platform: kind === 'ios' ? 'iOS' : 'Android' };
  }
  const agent = userAgent ?? '';
  return {
    kind: 'browser',
    client: match(BROWSERS, agent),
    platform: match(PLATFORMS, agent),
  };
}

/**
 * The line the list actually prints.
 *
 * Degrades in the order the words are worth something. Both is "Safari on
 * iPhone"; a platform alone is still enough to pick a device out of a list of
 * three; a client alone is weaker but true. The last case is a string nothing
 * matched, and it says so plainly rather than inventing a device — a row that
 * claims to be an iPhone and is not is worse than one that admits it does not
 * know, because the whole use of this screen is spotting the row that is not
 * yours.
 */
export function clientLabel(description: ClientDescription): string {
  const { kind, client, platform } = description;
  if (kind !== 'browser') return `Parea for ${platform ?? (kind === 'ios' ? 'iOS' : 'Android')}`;
  if (client && platform) return `${client} on ${platform}`;
  if (platform) return `A browser on ${platform}`;
  if (client) return client;
  return 'A browser';
}
