import { describe, expect, it } from 'vitest';

import { MAX_REPORTS, parseReports } from '../src/uploadFailures';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const PHOTO = '22222222-2222-4222-8222-222222222222';

describe('parseReports', () => {
  it('keeps what a queue said went wrong', () => {
    const rows = parseReports(
      {
        client: 'web',
        failures: [
          {
            eventId: PHOTO,
            photoId: PHOTO,
            stage: 'put',
            kind: 'TypeError',
            error: 'Load failed',
            attempts: 2,
            status: 'pending',
            mime: 'image/jpeg',
            size: 3_894_720,
          },
        ],
      },
      ACTOR,
      'Mozilla/5.0',
    );
    expect(rows).toEqual([
      expect.objectContaining({
        actorId: ACTOR,
        photoId: PHOTO,
        source: 'client',
        stage: 'put',
        error: 'Load failed',
        client: 'web',
        userAgent: 'Mozilla/5.0',
        byteSize: 3_894_720,
      }),
    ]);
  });

  it('drops reports that do not say what failed, and ids that are not ids', () => {
    const rows = parseReports(
      {
        client: 'toaster',
        failures: [
          { stage: 'put' },
          { stage: 'launch', error: 'x' },
          { stage: 'presign', error: 'presign failed: 413', photoId: "'; drop table" },
          null,
        ],
      },
      ACTOR,
      null,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stage: 'presign', photoId: null, client: null });
  });

  it('bounds the batch and the text', () => {
    const failures = Array.from({ length: MAX_REPORTS + 10 }, () => ({
      stage: 'complete',
      error: 'e'.repeat(5000),
    }));
    const rows = parseReports({ failures }, ACTOR, null);
    expect(rows).toHaveLength(MAX_REPORTS);
    expect(rows[0]!.error).toHaveLength(500);
  });

  it('answers nothing to a body that is not a report', () => {
    expect(parseReports(null, ACTOR, null)).toEqual([]);
    expect(parseReports({ failures: 'no' }, ACTOR, null)).toEqual([]);
  });
});
