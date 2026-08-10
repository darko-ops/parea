/**
 * The only thing that leaves the device.
 *
 * The privacy contract, in full: this payload contains counts, rates, and one
 * distance in metres. It contains no coordinates, no filenames, no asset ids,
 * no dates, and no image data. `startHour` and `weekday` are included because
 * "was this an evening thing" is the one temporal fact worth analysing, and
 * neither pins down a day.
 *
 * The app shows this JSON verbatim before anything is shared. Testers are doing
 * a favour by running it; they should be able to read exactly what they are
 * handing over, which is also the standard the product itself is meant to hold.
 */

import { Platform } from 'react-native';

import type { SessionResult, Summary } from './analysis';
import type { ScanResult } from './scan';

export const SCHEMA = 'geotag-probe/1' as const;

export type Report = {
  schema: typeof SCHEMA;
  platform: string;
  osVersion: string;
  /** 'limited' means the tester granted access to a subset — sample is biased. */
  accessPrivileges: ScanResult['accessPrivileges'];
  monthsScanned: number;
  totalImagesInRange: number;
  locationLookups: number;
  locationErrors: number;
  truncated: boolean;
  summary: Summary;
  sessions: SessionResult[];
};

export function buildReport(
  scan: ScanResult,
  sessions: SessionResult[],
  summary: Summary,
  monthsScanned: number,
): Report {
  return {
    schema: SCHEMA,
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    accessPrivileges: scan.accessPrivileges,
    monthsScanned,
    totalImagesInRange: scan.totalImagesInRange,
    locationLookups: scan.candidates.length,
    locationErrors: scan.locationErrors,
    truncated: scan.truncated,
    summary,
    sessions,
  };
}

/**
 * Reasons the headline number should not be believed as-is. Shown in the UI and
 * carried in the human-readable share text, because a caveated result that
 * arrives without its caveats is worse than no result.
 */
export function caveats(report: Report): string[] {
  const out: string[] = [];

  if (report.accessPrivileges === 'limited') {
    out.push(
      'Limited photo access: this measures only the photos that were selected, ' +
        'not the library. Coverage here is not representative.',
    );
  }
  if (report.locationErrors > 0) {
    const share = report.locationErrors / Math.max(1, report.locationLookups);
    out.push(
      `${report.locationErrors} location lookups failed (${(share * 100).toFixed(0)}%). ` +
        'On Android this usually means ACCESS_MEDIA_LOCATION was not granted — ' +
        'these are "could not look", not "no GPS", and must not be read as absent coverage.',
    );
  }
  if (report.truncated) {
    out.push(
      'Hit the location-lookup cap, so later sessions were not assessed. ' +
        'Scan a shorter period for full coverage.',
    );
  }
  if (report.summary.events === 0) {
    out.push('No sessions large enough to assess. Try a longer scan period.');
  }
  return out;
}

export function shareText(report: Report): string {
  const s = report.summary;
  const lines = [
    'geotag probe result',
    `${report.platform} ${report.osVersion}`,
    `${s.confidentEvents}/${s.events} events would get a confident pre-selection`,
    `${report.totalImagesInRange} photos scanned over ${report.monthsScanned} months`,
  ];
  const notes = caveats(report);
  if (notes.length) lines.push('', 'CAVEATS', ...notes.map((n) => `- ${n}`));
  lines.push('', JSON.stringify(report, null, 2));
  return lines.join('\n');
}
