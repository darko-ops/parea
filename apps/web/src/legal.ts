/**
 * The handful of facts the legal pages need from the deployment.
 *
 * Environment variables rather than literals for the same reason
 * `SAFETY_CONTACT_EMAIL` is one: a name and a jurisdiction are things only the
 * operator knows, and hard-coding a guess produces a published, dated legal
 * document that is confidently wrong about who is making the promise.
 *
 * The fallbacks are visibly placeholders and `/api/health` reports both as
 * missing, so a deployment that forgot them says so on the health check
 * instead of on the terms page.
 */

const placeholder = (value: string | undefined, fallback: string) =>
  value?.trim() || fallback;

/** Who is making the promises. App Store review looks for a real name here. */
export const LEGAL_ENTITY = placeholder(
  process.env.LEGAL_ENTITY,
  '[operator name not configured]',
);

/** Whose law governs, and whose courts. Counsel's answer, not a default. */
export const LEGAL_JURISDICTION = placeholder(
  process.env.LEGAL_JURISDICTION,
  '[jurisdiction not configured]',
);

export const SAFETY_CONTACT = placeholder(
  process.env.SAFETY_CONTACT_EMAIL,
  'safety@example.com',
);

/**
 * Changed by hand when the text changes, which is the point: a date that
 * updated itself would say the terms changed every time anything deployed,
 * and a date that never moved would be a lie the first time they did.
 */
export const LEGAL_UPDATED = '11 August 2026';
