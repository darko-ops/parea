// Expo's default Metro config, with Sentry's debug IDs stamped into each
// bundle so a crash report can be matched to the source map uploaded with
// the build. Nothing else is changed; see `src/crashReports.ts`.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
