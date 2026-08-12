/**
 * Waking a human when something has been quarantined — docs/csam-runbook.md.
 *
 * Shared rather than copied, because there are now two things that quarantine:
 * the scanner at ingest, and a person reporting child sexual abuse material
 * from a client. Both start the same clock and both want the same message, and
 * a second implementation is how one of them quietly stops sending.
 *
 * Identifiers only. No image, no thumbnail, no link that renders one —
 * responders work from the runbook, not from a chat notification. Whatever
 * receives this is a general-purpose webhook, which means an ordinary chat
 * client, which means anything renderable would be rendered.
 */

export type QuarantineAlert = {
  incidentId: string;
  eventId: string;
  /** What found it: a scanner's name, or `user_report` when a person did. */
  provider: string;
  classification: string;
};

export async function alertResponder(summary: QuarantineAlert): Promise<void> {
  const url = process.env.SAFETY_ALERT_WEBHOOK;
  if (!url) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        `SAFETY: no SAFETY_ALERT_WEBHOOK configured; incident ${summary.incidentId} ` +
          'is quarantined but nobody has been told. Fix this immediately.',
      );
    }
    return;
  }

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'csam_quarantine',
        ...summary,
        runbook: 'docs/csam-runbook.md',
      }),
    });
  } catch (err) {
    // Swallowed on purpose. The quarantine has already happened and is the
    // part that protects anyone; failing the caller here would roll back a
    // hidden photo because a chat webhook was down.
    console.error(`SAFETY: alert failed for incident ${summary.incidentId}`, err);
  }
}
