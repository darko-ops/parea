import { registerRootComponent } from 'expo';

import App from './App';
import { startCrashReports } from './src/crashReports';

// Before anything renders, so a crash on the first screen is caught too.
startCrashReports();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
