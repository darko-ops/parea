/**
 * Crash reports from the app — design §18's one gap the server could not see.
 *
 * Off unless the build carries a DSN (`EXPO_PUBLIC_SENTRY_DSN`), so a local
 * build without one sends nothing. On, it sends what crashed and where:
 * native crashes, and JavaScript errors nothing caught. Not who — no user,
 * no device name, no IP (`sendDefaultPii: false`) — and not what anyone was
 * looking at: no screenshots, no view hierarchy, no console output, no
 * performance tracing, and every string passes through `scrub` first.
 *
 * The app is deliberately not wrapped in `Sentry.wrap`: its touch
 * breadcrumbs name what was tapped, and in this app what was tapped is often
 * a person.
 */

import type * as SentryModule from '@sentry/react-native';

import { scrub } from './scrub';

export function startCrashReports(dsn = process.env.EXPO_PUBLIC_SENTRY_DSN): boolean {
  if (!dsn) return false;
  try {
    // Loaded only when there is somewhere to send to, so a build without a
    // DSN — or a development client built before the native module was
    // added — never touches the SDK at all.
    const Sentry = require('@sentry/react-native') as typeof SentryModule;
    Sentry.init({
      dsn,
      environment: __DEV__ ? 'development' : 'production',
      sendDefaultPii: false,
      tracesSampleRate: 0,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      beforeSend: (event: SentryModule.ErrorEvent) => scrub(event),
      beforeBreadcrumb: (crumb: SentryModule.Breadcrumb) => (crumb.category === 'console' ? null : scrub(crumb)),
    });
    return true;
  } catch (err) {
    // A crash reporter that cannot start must never be the crash.
    console.warn('crash reports not started:', err);
    return false;
  }
}
