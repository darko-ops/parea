/**
 * Child-safety scanning at ingest — docs/design.md §13, docs/csam-runbook.md.
 *
 * A product that accepts photo uploads from unverified contributors has this
 * risk surface whether or not it plans for it. The design calls scanning a
 * launch gate; this is the code half.
 *
 * Three things this module is careful about:
 *
 * IT FAILS CLOSED WHEN IT RUNS. If a scanner is configured and cannot be
 * reached, the photo does not become `ready` — and `ready` is what every
 * listing, download and image URL keys off. An outage stalls ingest rather
 * than letting unscanned content through.
 *
 * IT MAY NOT RUN AT ALL, AND THAT IS SAID OUT LOUD. With no provider
 * configured there is no hash matching, photos are published, and the
 * deployment's declared posture (`postureFromEnv`) and the privacy page both
 * say so. Providers are gated behind vetting a pre-launch company may not
 * have passed yet; see `scannerFromEnv` in @parea/core and
 * docs/csam-runbook.md. This comment used to say an unconfigured deployment
 * refused every photo — it has not done that since August, and a header that
 * describes a gate which is not there is how an operator ends up believing
 * they are protected.
 *
 * IT DOES NOT DECIDE ANYTHING. A match quarantines and alerts. It does not
 * report, does not delete, does not email the uploader, does not tell the
 * host. Reporting to NCMEC is a legal act with statutory consequences for
 * getting it wrong in either direction, and it is performed by a person.
 */

export {
  type CsamScanner,
  HttpHashScanner,
  type ScanInput,
  ScanUnavailable,
  type ScanVerdict,
  scannerFromEnv,
} from '@parea/core';

export { alertResponder } from '@parea/core';

