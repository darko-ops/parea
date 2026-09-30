/**
 * Reporting a thing that is not a roll's photograph, and what the phone says
 * afterwards.
 *
 * The words are the photo sheet's (`PhotoActions` and its `DONE` in `App.tsx`)
 * on purpose: a report is one act whatever it is about, and somebody who has
 * reported a photograph and a comment should be told the same thing about
 * both. One place for them, so five screens cannot drift into five stories.
 */

import { Alert } from 'react-native';

import { ApiError, type Api, type TargetKind } from './api';

export async function reportContent(api: Api, kind: TargetKind, id: string): Promise<void> {
  try {
    await api.reportContent(kind, id);
    Alert.alert('Reported', 'Reported. Someone will look at it.');
  } catch (err) {
    /*
     * The refusals somebody can act on, said as what to do. Everything else —
     * gone, yours after all, malformed — is nothing they can fix from here.
     */
    if (err instanceof ApiError && err.status === 401) {
      Alert.alert('Sign in first', 'Reporting needs an account. Open You and sign in.');
    } else if (err instanceof ApiError && err.status === 429) {
      Alert.alert('That is a lot at once', 'Wait a while and try again.');
    } else {
      Alert.alert('That did not work', 'Try again in a moment.');
    }
  }
}
