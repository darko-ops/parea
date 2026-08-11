/**
 * Auto-selection — docs/design.md §7.1–7.3.
 *
 * Three files, in the order the product uses them:
 *
 *   sessions.ts  find the event on the phone: runs of photos with no long gap,
 *                the most recent offered as one tappable thing
 *   narrow.ts    decide which of a run to tick, and how confidently
 *   when.ts      the older path — ask a human which evening they mean. Still
 *                used by the web, which has no library to read, and as the
 *                native fallback when nothing was detected
 */

export {
  WHEN_OPTIONS,
  eventDateFor,
  windowFor,
  type EventWindow,
  type WhenOption,
  type WindowId,
} from './when';

export {
  DEFAULT_CLUSTER_RADIUS_M,
  MIN_CLUSTER_SHARE,
  MIN_GEO_RATE,
  describe,
  dominantCluster,
  haversineM,
  narrow,
  resolveWindow,
  type Candidate,
  type Confidence,
  type Suggestion,
  type SuggestionReason,
  type Window,
} from './narrow';

export {
  DEFAULT_GAP_HOURS,
  MIN_SESSION_PHOTOS,
  RECENT_DAYS,
  SESSION_PAD_MS,
  eventDateOf,
  eventDayFor,
  labelFor,
  recentBundles,
  sessionise,
  type Bundle,
  type Session,
} from './sessions';
