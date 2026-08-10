/**
 * What the two `.well-known` files need to say — design §9.
 *
 * The application identifiers live here as constants rather than as
 * configuration, because they are not configurable: both stores fix them at
 * the first upload, and a deployment that served a different one would be
 * claiming links for an app that does not exist. They must match
 * `apps/mobile/app.json`, which its own test asserts.
 *
 * The parts that *are* deployment configuration — an Apple Team ID, an Android
 * signing fingerprint — come from the environment, and their absence makes
 * both routes 404. Serving a well-formed file with the wrong identity in it is
 * worse than serving nothing: Apple caches the AASA aggressively, so a wrong
 * Team ID is a link that stays broken long after someone fixes the variable.
 */

/** Must match `expo.ios.bundleIdentifier`. */
export const IOS_BUNDLE_ID = 'photos.parea';
/** Must match `expo.android.package`. */
export const ANDROID_PACKAGE = 'photos.parea';

const TEAM_ID = /^[A-Z0-9]{10}$/;
const FINGERPRINT = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;

/**
 * `<TeamID>.<bundle id>`, or null when the Team ID is missing or malformed.
 *
 * Validated rather than trusted: a Team ID with a stray newline from a copied
 * dashboard value produces a file that parses, verifies against nothing, and
 * gives no clue why.
 */
export function appIdentifier(): string | null {
  const team = process.env.APPLE_TEAM_ID?.trim().toUpperCase();
  if (!team || !TEAM_ID.test(team)) return null;
  return `${team}.${IOS_BUNDLE_ID}`;
}

/**
 * SHA-256 fingerprints of the certificates the Android app is signed with.
 *
 * A list because there are usually two: the upload key and the key Google
 * re-signs with under Play App Signing. Ship only one and verification fails
 * for everyone who installed from the store, which is everyone.
 *
 * Comma-separated in the environment, uppercased, colon-separated hex.
 */
export function androidFingerprints(): string[] {
  return (process.env.ANDROID_CERT_FINGERPRINTS ?? '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => FINGERPRINT.test(value));
}
