/**
 * The three actions at the top of an album's `⋯`, and the one that is two.
 *
 * The sheet used to be a stack in which everything looked like everything
 * else: sharing the link, saving every photograph and changing who could see
 * it were all a title with a line of explanation under it. Two of those are
 * things you *do*, and the rest are things you *decide*. The doing is a row of
 * three icons now; the deciding is below it.
 *
 * What is worth pinning is not the layout. It is the pair that shares the third
 * slot:
 *
 * **Delete** ends the evening for everybody who was in it, and is the host's
 * alone — the server enforces that with `administer`, and a client that offered
 * it to a member would be drawing a button whose only outcome is a 403.
 *
 * **Leave** takes one person off one list and is for everybody else. It is not
 * a smaller delete: the photographs stay, the link still works, and nobody else
 * notices. They are never both on screen, because a row whose meaning turns on
 * who is reading it is a row somebody eventually misreads — and the two
 * misreadings are not symmetrical. Pressing Leave expecting Delete costs an
 * apology; the other way costs the evening.
 *
 * Source checks because there is no renderer in this suite. They stand in for
 * the simulator run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const API = read('src/api.ts');

/** The sheet, without the 2000-line screen that opens it. */
const SHEET = APP.slice(APP.indexOf('function HostSheet'), APP.indexOf('function Action('));

describe('the row of three', () => {
  it('found the sheet at all', () => {
    // Every assertion below is over this slice, and a rename upstream would
    // empty it and pass all of them silently.
    expect(SHEET).not.toBe('');
  });

  it('is copy, download, and the way out', () => {
    expect(SHEET).toMatch(/icon="share"[\s\S]{0,400}'Copy link'/);
    expect(SHEET).toMatch(/icon="download"[\s\S]{0,120}label=\{saving \?\? 'Download Album'\}/);
    expect(SHEET).toMatch(/icon="trash" label="Delete Album"/);
    expect(SHEET).toMatch(/icon="door" label="Leave Album"/);
  });

  it('offers exactly one of Delete and Leave, on `host`', () => {
    /*
     * The structural half of the rule. `host` is `canAdminister` off the feed —
     * the server's own answer to the same question the DELETE route asks — so
     * the button is drawn on the permission rather than on a guess about it.
     */
    expect(SHEET).toMatch(
      /\{host \? \([\s\S]{0,200}Delete Album[\s\S]{0,200}\) : \([\s\S]{0,200}Leave Album/,
    );
    expect(APP).toMatch(/const host = feed\?\.event\.canAdminister === true;/);
  });

  it('draws both in the one red the theme has', () => {
    // Not a colour picked at the call site: `warn` exists so the two actions
    // that take something away are the same red in both themes, and so that
    // nothing else quietly becomes red later.
    expect(SHEET).toMatch(/label="Delete Album" onPress=\{onDelete\} danger/);
    expect(SHEET).toMatch(/label="Leave Album" onPress=\{onLeave\} danger/);
    expect(APP).toMatch(/danger \? t\.warn : t\.fg/);
    expect(APP).toMatch(/warn: '#ff7b70'/);
    expect(APP).toMatch(/warn: '#c23127'/);
  });

  it('will not offer a download of nothing', () => {
    // A live button whose only possible outcome is an apology is worse than one
    // that is plainly not for you yet.
    expect(SHEET).toMatch(/disabled=\{photos === 0 \|\| saving !== null\}/);
  });
});

describe('deleting', () => {
  const call = APP.slice(APP.indexOf('const deleteAlbum'), APP.indexOf('const leaveAlbum'));

  it('asks first, and says what it costs', () => {
    expect(call).toMatch(/Alert\.alert\(\s*`Delete \$\{event\.name\}\?`/);
    expect(call).toMatch(/takes the album and its \$\{count\}/);
    expect(call).toMatch(/It cannot be undone\./);
    // The cancel is the one that needs no thought, and it is not called
    // "Cancel" — it says what keeping it means.
    expect(call).toMatch(/text: 'Keep it', style: 'cancel'/);
    expect(call).toMatch(/style: 'destructive'/);
  });

  it('leaves by `onBack`, which re-reads the list', () => {
    /*
     * Not `onClose`. Closing the sheet would leave somebody looking at an album
     * that no longer exists, and every pull to refresh on it would be a 404.
     * `onBack` is `leaveEvent` in the app shell, which re-reads the events
     * before the home screen is drawn.
     */
    expect(call).toMatch(/await api\.deleteEvent\(event\.id\);\s*onBack\(\);/);
    expect(APP).toMatch(/const leaveEvent = useCallback\(\(\) => \{\s*void refreshEvents\(\);/);
  });
});

describe('leaving', () => {
  const call = APP.slice(APP.indexOf('const leaveAlbum'), APP.indexOf('if (autoWindow)'));

  it('says what it does not take', () => {
    /*
     * The three things somebody is actually worried about, in the order they
     * worry about them: their photographs, whether this is final, and whether
     * they can come back.
     */
    expect(call).toMatch(/Photographs you added stay/);
    expect(call).toMatch(/the link still works/);
    expect(call).toMatch(/text: 'Stay', style: 'cancel'/);
  });

  it('says when the album is staying anyway', () => {
    /*
     * An album inside a group reaches the home screen through the membership,
     * not the participant row — so leaving is real and the album is still
     * there. Unsaid, that reads as the button having failed.
     */
    expect(call).toMatch(/const \{ throughGroup \} = await api\.leaveEvent\(event\.id\)/);
    expect(call).toMatch(/if \(throughGroup\) \{/);
    expect(call).toMatch(/Leaving the group is what takes it off/);
  });

  it('goes through a route of its own, not the delete', () => {
    // Two verbs on two paths. One endpoint whose blast radius depended on who
    // was asking is fine right up until somebody's permissions change.
    expect(API).toMatch(/`\/api\/events\/\$\{eventId\}\/participation`,\s*\{ method: 'DELETE' \}/);
    expect(API).toMatch(/deleteEvent\(eventId: string\)[\s\S]{0,160}`\/api\/events\/\$\{eventId\}`, \{ method: 'DELETE' \}/);
  });
});

describe('the sheet as a surface', () => {
  it('puts nothing above the scroll view that can claim a touch', () => {
    /*
     * The dim used to be the sheet's parent — a `Pressable` for the backdrop, a
     * second one around the sheet to swallow presses that should not close it,
     * and the scroll view inside both. A touch anywhere in it is offered to the
     * deepest view that wants to be the responder, the sheet's own `Pressable`
     * said yes on the way down, and the scroll had to wait for that press to
     * end before it could take the gesture back. You swiped, nothing moved, you
     * swiped again and it worked — which reads as the page taking a moment to
     * wake up.
     *
     * So: the shell is a plain `View`, the dim is an absolutely-filled sibling
     * *under* the sheet, and the sheet itself is a `View`. Re-nesting them is
     * the regression, and it is invisible in a screenshot.
     */
    expect(SHEET).toMatch(/<View style=\{styles\.sheetShell\}>/);
    expect(SHEET).toMatch(
      /<Pressable\s*style=\{StyleSheet\.absoluteFill\}\s*onPress=\{onClose\}/,
    );
    expect(SHEET).toMatch(/<View style=\{\[styles\.sheet, \{ backgroundColor: t\.bg \}\]\}>\s*<ScrollView/);
    expect(SHEET).not.toMatch(/<Pressable style=\{styles\.sheetBackdrop\}/);
    // And the dim still covers everything, so a tap beside the sheet closes it.
    expect(APP).toMatch(/sheetShell: \{ flex: 1, justifyContent: 'flex-end'/);
  });
});

describe('the way out of the sheet', () => {
  it('is the album’s own back button, above it', () => {
    /*
     * It was a Done button under everything, so closing a sheet you had
     * scrolled to the bottom of was easy and closing one you had not meant
     * scrolling to find the exit. The same disc, in the same corner, at the
     * same size as the one on the screen underneath.
     */
    expect(SHEET).toMatch(/<RoundButton[\s\S]{0,160}style=\{styles\.sheetBack\}[\s\S]{0,80}<Back color=\{t\.fg\} \/>/);
    expect(APP).toMatch(/sheetBack: \{ alignSelf: 'flex-start', marginLeft: 16/);
    expect(SHEET).not.toMatch(/label="Done"/);
  });
});
