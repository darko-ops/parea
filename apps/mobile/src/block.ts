/**
 * Blocking somebody from something they said, or from their page, and what
 * the phone says around it.
 *
 * The roll's photo sheet and a moment's `⋯` each ask in their own way,
 * because each has its own sheet to ask in. Everywhere else — a held
 * message, a comment under a photograph, somebody's page — asks with this,
 * so four places cannot drift into four stories about what a block is.
 *
 * The question says the cost rather than the act: you stop seeing each other,
 * everywhere, and they are not told. A block somebody thinks is a report is a
 * block they will not use on the person they most want to stop seeing. And
 * it names where the undo is, because now there is one.
 */

import { Alert } from 'react-native';

import { ApiError, type Api } from './api';

type Target = Parameters<Api['blockAuthor']>[0];

export const BLOCK_QUESTION = 'Block this person?';
export const BLOCK_COST =
  "You won't see each other's messages, photos, comments or albums, even in groups you share. They won't be told. You can undo this in Settings → Blocked.";

/**
 * Asks, blocks, says so. True once the block has been made — the caller's cue
 * to reload, so what they said goes from the screen — and false when somebody
 * thought better of it or it did not work.
 *
 * The acknowledgement waits for its OK before resolving, so a page that goes
 * back afterwards does not pull the ground out from under its own alert.
 */
export function blockAuthor(api: Api, target: Target): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      BLOCK_QUESTION,
      BLOCK_COST,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Block',
          style: 'destructive',
          onPress: () => {
            api.blockAuthor(target).then(
              () =>
                Alert.alert('Blocked', 'You will not see each other now.', [
                  { text: 'OK', onPress: () => resolve(true) },
                ], { cancelable: true, onDismiss: () => resolve(true) }),
              (err) => {
                /*
                 * The refusals somebody can act on, said as what to do. Gone
                 * already, or yourself after all, is nothing to fix from here.
                 */
                if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
                  Alert.alert('Sign in first', 'Blocking needs an account. Open You and sign in.');
                } else if (err instanceof ApiError && err.status === 429) {
                  Alert.alert('That is a lot at once', 'Wait a while and try again.');
                } else {
                  Alert.alert('That did not work', 'Try again in a moment.');
                }
                resolve(false);
              },
            );
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
