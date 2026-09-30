/**
 * Evidence preservation — see docs/csam-runbook.md.
 *
 * US law requires an electronic service provider that reports apparent child
 * sexual abuse material to NCMEC to preserve the material and related data
 * after the report (18 U.S.C. §2258A(h)). That period was 90 days; the REPORT
 * Act of 2024 is understood to have extended it to one year. One year is kept
 * here: holding evidence longer than required costs storage, and holding it
 * shorter than required is the failure that cannot be undone. Confirm with
 * counsel. Ordinary deletion paths must not be able to run over it.
 *
 * This module exists so that number appears in exactly one place and the purge
 * job cannot quietly disagree with it — and the privacy page says "at least a
 * year" because of it.
 */

export const PRESERVATION_DAYS = 365;

/**
 * When a hold may end, given the report date.
 *
 * Returns null when nothing has been reported yet, which means the hold is
 * open-ended: content is preserved indefinitely until a human either files and
 * starts the clock, or determines it was a false positive and releases it.
 */
export function preservationHold(reportedAt: Date | null): Date | null {
  if (!reportedAt) return null;
  return new Date(reportedAt.getTime() + PRESERVATION_DAYS * 24 * 3600_000);
}
