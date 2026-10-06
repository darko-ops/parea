/**
 * The `+` on an album, and the camera roll behind it.
 *
 * Granting the photo library turned that button into the auto-selection screen
 * and into nothing else. `addPhotos` reads:
 *
 *     if ((access === 'granted' || access === 'limited') && window) {
 *       setAutoWindow(window);
 *       return;
 *     }
 *     ...the system picker...
 *
 * — so the picker was reachable only by somebody who had *not* granted the
 * permission, which is the opposite of who the feature is for. Everyone else
 * got a grid scoped to the album's window, and for an album whose window holds
 * none of their photographs that grid is empty: "Nothing from this time on
 * this phone", a Cancel, and a disabled "Nothing selected" underneath it.
 *
 * A window can miss for ordinary reasons — a weekend added to on the Tuesday,
 * an evening whose dates somebody else set, a camera whose clock is wrong — so
 * this is not a rare shape. It is the button that adds photographs, ending in
 * a screen with no way to add a photograph.
 *
 * Source checks, because there is no renderer in this suite. What they guard
 * is that the suggestion stays refusable in the direction of *more*: the whole
 * library is one press away from the suggestion screen, and it is the screen's
 * main action when there is nothing to suggest.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');

describe('adding photos to a roll', () => {
  it('keeps the system picker reachable once the library is granted', () => {
    /*
     * The picker is its own function rather than the tail of `addPhotos`,
     * which is what lets a second caller reach it. If it goes back to being
     * unreachable code after an early `return`, this is the test that says so.
     */
    expect(APP).toMatch(/const pickFromLibrary = useCallback\(async \(\) => \{/);
    // It is now the only thing the button does — see `pick-photos.test.ts`.
    expect(APP).toMatch(/const addPhotos = pickFromLibrary;/);
  });

  it('says so when the picker will not open', () => {
    /*
     * `launchImageLibraryAsync` rejects rather than returning `canceled` when
     * iOS will not present it, and every caller reaches it through a `void`:
     * a rejection was an unhandled promise and no UI at all. Press `+`, and
     * nothing happens — which from the outside is the same thing as broken.
     */
    expect(APP).toMatch(/\} catch \{\s*\n\s*setQueueStatus\('Could not open your photos/);
  });
});
