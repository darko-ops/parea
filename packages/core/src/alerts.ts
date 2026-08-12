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

/**
 * Two destinations, either of which is enough.
 *
 * A webhook reaches a chat client immediately and is the better answer for a
 * team. Email is the better answer for one person: no extra service to keep
 * running, it survives a chat workspace being abandoned, and it arrives
 * somewhere that is already checked. Both are supported because which is
 * appropriate is a fact about the operator, not about the code.
 *
 * Both are attempted when both are configured. An alert is the one message in
 * this system where arriving twice is unambiguously better than not arriving.
 */
export async function alertResponder(summary: QuarantineAlert): Promise<void> {
  const url = process.env.SAFETY_ALERT_WEBHOOK;
  const email = process.env.SAFETY_ALERT_EMAIL;

  if (!url && !email) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        `SAFETY: no SAFETY_ALERT_WEBHOOK or SAFETY_ALERT_EMAIL configured; incident ` +
          `${summary.incidentId} is quarantined but nobody has been told. ` +
          'Fix this immediately.',
      );
    }
    return;
  }

  // Sequential rather than raced: two independent transports, and one failing
  // must not cancel the other.
  if (url) await viaWebhook(url, summary);
  if (email) await viaEmail(email, summary);
}

async function viaWebhook(url: string, summary: QuarantineAlert): Promise<void> {
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
    console.error(`SAFETY: webhook alert failed for ${summary.incidentId}`, err);
  }
}

async function viaEmail(to: string, summary: QuarantineAlert): Promise<void> {
  try {
    // Imported here rather than at the top: this module is loaded by the
    // deriver, and a deployment with no mailer configured should not pay for
    // the transport table on every boot.
    const { mailerFromEnv } = await import('./email');
    await mailerFromEnv().send({
      to,
      // The incident id in the subject, so it is actionable from a lock
      // screen and searchable later without opening anything.
      subject: `Parea safety: quarantine ${summary.incidentId}`,
      text: [
        'A photo has been quarantined and is no longer served anywhere.',
        '',
        `incident:       ${summary.incidentId}`,
        `event:          ${summary.eventId}`,
        `found by:       ${summary.provider}`,
        `classification: ${summary.classification}`,
        '',
        'Do not open the image. Viewing suspected material is itself',
        'restricted in most jurisdictions and there is no product reason to:',
        'the incident row carries the hash and the classification, which is',
        'what a report needs.',
        '',
        'Next steps are in docs/csam-runbook.md, under "If you get an alert".',
        'The clock starts now, and it is not one you control.',
      ].join('\n'),
    });
  } catch (err) {
    console.error(`SAFETY: email alert failed for ${summary.incidentId}`, err);
  }
}
