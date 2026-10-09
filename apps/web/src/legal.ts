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

import { scannerFromEnv } from '@parea/core';

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
export const LEGAL_UPDATED = '9 October 2026';

/**
 * Whether this deployment checks images against known child-abuse material.
 *
 * Read from the same configuration the scanner itself reads
 * (`scannerFromEnv` in @parea/core), so the privacy page and the terms say
 * what is actually happening rather than what is planned. They promised
 * "every image is checked" while no provider was configured anywhere; a page
 * that states the posture from the configuration cannot drift from it that
 * way again. The deriver reads its own copy of these on Fly — both have to be
 * set for every image to be covered.
 */
export function hashMatchingLive(
  env: Record<string, string | undefined> = process.env,
): boolean {
  // The scanner's own test, so a PhotoDNA key — which needs no URL — counts.
  return scannerFromEnv(env as NodeJS.ProcessEnv) !== null;
}
