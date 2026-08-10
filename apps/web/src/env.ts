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
  ];
}

export function missingInProduction(): ConfigItem[] {
  return describeConfig().filter((c) => c.requiredInProduction && !c.present);
}
