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

import { DEFAULT_PROVIDER, PROVIDERS, isKnownProvider } from './email';

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
      consequence: 'falls back to SESSION_SECRET; must match the zip Worker',
      requiredInProduction: false,
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
      consequence: 'falls back to SESSION_SECRET; must match the image Worker',
      requiredInProduction: false,
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
      consequence: 'Android App Links do not verify; tapped links open Chrome',
      requiredInProduction: false,
    },
  ];
}

export function missingInProduction(): ConfigItem[] {
  return describeConfig().filter((c) => c.requiredInProduction && !c.present);
}
