/**
 * Configuration, and whether this deployment actually has it.
 *
 * Every one of these has a failure mode that only shows up in production, and
 * several are silent: a missing IMAGE_SECRET does not break anything visibly,
 * it just means image URLs are signed with the session secret and the image
 * Worker rejects all of them. So they are enumerated in one place and checked
 * from the health endpoint, rather than discovered one broken feature at a
 * time.
 */

import {
  CARRIERS,
  DEFAULT_CARRIER,
  DEFAULT_PROVIDER,
  PROVIDERS,
  isKnownCarrier,
  isKnownProvider,
} from '@parea/core';

export type ConfigItem = {
  name: string;
  present: boolean;
  /** What breaks when it is absent. */
  consequence: string;
  requiredInProduction: boolean;
};

const has = (name: string): boolean => Boolean(process.env[name]?.trim());

export function describeConfig(): ConfigItem[] {
  return [
    {
      name: 'SESSION_SECRET',
      present: has('SESSION_SECRET'),
      consequence: 'cookies cannot be signed; every request is anonymous',
      requiredInProduction: true,
    },
    {
      name: 'DATABASE_URL',
      present: has('DATABASE_URL'),
      consequence: 'nothing works',
      requiredInProduction: true,
    },
    {
      name: 'R2_ACCOUNT_ID',
      present: has('R2_ACCOUNT_ID'),
      consequence: 'photos would be written to container disk and lost',
      requiredInProduction: true,
    },
    {
      name: 'R2_ACCESS_KEY_ID',
      present: has('R2_ACCESS_KEY_ID'),
      consequence: 'photos would be written to container disk and lost',
      requiredInProduction: true,
    },
    {
      name: 'R2_SECRET_ACCESS_KEY',
      present: has('R2_SECRET_ACCESS_KEY'),
      consequence: 'photos would be written to container disk and lost',
      requiredInProduction: true,
    },
    {
      name: 'R2_BUCKET',
      present: has('R2_BUCKET'),
      consequence: 'photos would be written to container disk and lost',
      requiredInProduction: true,
    },
    {
      name: 'ZIP_BASE_URL',
      present: has('ZIP_BASE_URL'),
      consequence: 'downloads return 503 — the product has no terminal action',
      requiredInProduction: true,
    },
    {
      name: 'MANIFEST_SECRET',
      present: has('MANIFEST_SECRET'),
      // Falls back to SESSION_SECRET, which works only if the zip Worker was
      // given the same value. Silent mismatch otherwise: every download 404s.
      consequence: 'downloads refuse to start; must match the zip Worker',
      requiredInProduction: true,
    },
    {
      name: 'IMAGE_BASE_URL',
      present: has('IMAGE_BASE_URL'),
      consequence:
        'image URLs are presigned per request — correct, but the CDN never caches',
      requiredInProduction: false,
    },
    {
      name: 'IMAGE_SECRET',
      present: has('IMAGE_SECRET'),
      consequence: 'images are served as presigned originals, uncached; must match the image Worker',
      requiredInProduction: true,
    },
    {
      name: 'SAFETY_CONTACT_EMAIL',
      present: has('SAFETY_CONTACT_EMAIL'),
      // App Store Guideline 1.2 requires published contact details for an app
      // carrying user-generated content.
      consequence: 'the safety page shows a placeholder address',
      requiredInProduction: true,
    },
    {
      name: 'LEGAL_ENTITY',
      // Named on /terms and /privacy as the party making the promises. The
      // fallback is a visible placeholder rather than a guess, because a
      // published legal document confidently wrong about who wrote it is
      // worse than one that is obviously unfinished.
      present: has('LEGAL_ENTITY'),
      consequence: 'the terms and privacy pages name no operator',
      requiredInProduction: true,
    },
    {
      name: 'LEGAL_JURISDICTION',
      present: has('LEGAL_JURISDICTION'),
      consequence: 'the terms state no governing law',
      requiredInProduction: true,
    },
    {
      name: 'QSTASH_TOKEN',
      present: has('QSTASH_TOKEN'),
      // Without it `complete` answers 503 and the upload is refused, which is
      // deliberate: the deriver no longer polls, so a photo nobody announced
      // is a photo nobody derives. Loud beats stranded.
      consequence: 'uploads cannot be queued for deriving, and are refused',
      requiredInProduction: true,
    },
    {
      name: 'QSTASH_URL',
      present: has('QSTASH_URL'),
      // Optional, and only because the library has a default that is right for
      // one region. An account elsewhere publishing to the default endpoint is
      // told "user not found in this region", which reads like a bad token.
      consequence: 'publishes go to the default region, which may not be yours',
      requiredInProduction: false,
    },
    {
      name: 'DERIVER_JOB_URL',
      present: has('DERIVER_JOB_URL'),
      // Paired with the token: configured to publish with nowhere to publish
      // to is the one combination that looks live and strands every photo.
      consequence: 'queued work has no destination; uploads are refused',
      requiredInProduction: true,
    },
    {
      name: 'MAIL_PROVIDER',
      // Not "is it set" — unset is fine and means the default. This reports
      // whether the mailer can be *built*, so the answer is false only when
      // someone has set it to something no transport exists for. A typo here
      // would otherwise be indistinguishable from working configuration: the
      // code route swallows send failures on purpose, so the symptom is
      // nobody ever receiving a code.
      present: isKnownProvider(process.env.MAIL_PROVIDER?.trim() || DEFAULT_PROVIDER),
      consequence: `unrecognised; must be one of ${Object.keys(PROVIDERS).join(', ')}`,
      requiredInProduction: false,
    },
    {
      name: 'MAIL_API_URL',
      // Optional twice over: three of the four providers have a fixed
      // endpoint this fills in, and it is only load-bearing for Mailgun,
      // whose path carries the sending domain.
      present: has('MAIL_API_URL'),
      consequence: 'defaults to the provider endpoint; required for mailgun',
      requiredInProduction: false,
    },
    {
      name: 'MAIL_API_KEY',
      // Not required: the product works without accounts, which are optional
      // by design. But an app that offers sign-in and cannot send is worse
      // than one that does not offer it, so the deriver-style rule applies —
      // in production an unconfigured mailer refuses rather than pretending.
      present: has('MAIL_API_KEY'),
      consequence: 'sign-in codes are never sent; accounts cannot be claimed',
      requiredInProduction: false,
    },
    {
      name: 'MAIL_FROM',
      present: has('MAIL_FROM'),
      consequence: 'sign-in codes are never sent; accounts cannot be claimed',
      requiredInProduction: false,
    },
    {
      name: 'SMS_PROVIDER',
      // Reported the way MAIL_PROVIDER is: unset is fine and means the default,
      // and false here means somebody set it to a carrier no transport exists
      // for. The consequence is worth spelling out because it is invisible —
      // the route that sends a code answers the same either way, so a typo
      // shows up as everybody's phone verification silently never arriving.
      present: isKnownCarrier(process.env.SMS_PROVIDER?.trim() || DEFAULT_CARRIER),
      consequence: `unrecognised; must be one of ${Object.keys(CARRIERS).join(', ')}`,
      requiredInProduction: false,
    },
    {
      name: 'SMS_API_URL',
      // Load-bearing for Twilio, whose path carries the account SID, and
      // filled in from the carrier table for the other two.
      present: has('SMS_API_URL'),
      consequence: 'defaults to the carrier endpoint; required for twilio',
      requiredInProduction: false,
    },
    {
      name: 'SMS_API_KEY',
      // Not required: the product is complete without phone discovery, the way
      // it is complete without accounts. But an app offering to verify a number
      // and unable to send is worse than one not offering it, so the same rule
      // applies — in production an unconfigured texter refuses rather than
      // pretending a code went out.
      present: has('SMS_API_KEY'),
      consequence: 'phone numbers cannot be verified; friend discovery stays closed',
      requiredInProduction: false,
    },
    {
      name: 'SMS_FROM',
      present: has('SMS_FROM'),
      consequence: 'phone numbers cannot be verified; friend discovery stays closed',
      requiredInProduction: false,
    },
    {
      name: 'PHONE_PEPPER',
      /*
       * Its own key, in production. It fell back to `SESSION_SECRET`, which
       * tied two things that should rotate separately together — see
       * `dedicatedSecret`. Rotating it still invalidates every stored number
       * hash, so everybody would enter and verify their number again.
       */
      present: has('PHONE_PEPPER'),
      consequence: 'phone numbers cannot be confirmed or matched; rotating it re-verifies every number',
      requiredInProduction: true,
    },
    {
      name: 'APPLE_TEAM_ID',
      present: has('APPLE_TEAM_ID'),
      // Not required, because the web client is complete without an app. But
      // the app's entitlement names this domain, so while it is unset every
      // tapped link opens Safari on a phone that has the app installed.
      consequence: 'iOS Universal Links do not verify; tapped links open Safari',
      requiredInProduction: false,
    },
    {
      name: 'ANDROID_CERT_FINGERPRINTS',
      present: has('ANDROID_CERT_FINGERPRINTS'),
      // Two features off one value now. The same fingerprint that verifies a
      // tapped link is what the passkey verifier turns into the
      // `android:apk-key-hash:` origin it will accept an assertion from, so an
      // unset value is also every Android passkey sign-in failing.
      consequence:
        'Android App Links do not verify; tapped links open Chrome, and Android passkeys are refused',
      requiredInProduction: false,
    },
    {
      name: 'PASSKEY_RP_ID',
      present: has('PASSKEY_RP_ID'),
      /*
       * Only for a deployment on a domain the code does not know about.
       *
       * `rpIdFor` derives the right answer for `parea.photos`, for a preview
       * host and for localhost, so this is unset on every intended deployment.
       * It exists because getting it wrong is unrecoverable in one direction: a
       * passkey is bound to its RP ID for life, so a deployment that registers
       * keys under the wrong one has to have every person re-enrol.
       */
      consequence: 'derived from the request host, which is right unless the domain changed',
      requiredInProduction: false,
    },
  ];
}

export function missingInProduction(): ConfigItem[] {
  return describeConfig().filter((c) => c.requiredInProduction && !c.present);
}

/**
 * A key that must be its own, in production.
 *
 * The image-signing, manifest-signing and phone-hashing keys each fell back to
 * `SESSION_SECRET` when unset. Harmless where the two agree, and the wrong
 * shape everywhere else: the image and zip Workers then have to be handed the
 * session secret to verify anything, and a Worker's environment leaking would
 * hand over the key that signs every session. So in production there is no
 * fallback — a missing key is missing, and whatever needs it refuses rather
 * than quietly sharing another. Previews and local development still fall
 * back, because they are not worth a separate key each.
 */
export function dedicatedSecret(
  name: 'IMAGE_SECRET' | 'MANIFEST_SECRET' | 'PHONE_PEPPER',
): string | undefined {
  const own = process.env[name];
  if (own) return own;
  if (process.env.VERCEL_ENV === 'production') return undefined;
  return process.env.SESSION_SECRET;
}
