/**
 * Making an album now starts with the photographs.
 *
 * It used to start with a form: a name, a place, a cover, and a question about
 * when it happened — four answers before the product had seen a single picture.
 * Two of those four existed only because it had not: the cover asked somebody to
 * go back to the camera roll they were about to be asked about, and "when was
 * it?" was a phrase resolved to a six-hour box so that everybody *else*'s
 * photographs could be found later.
 *
 * Choosing first answers both for free, exactly, and leaves a form with four
 * things on it.
 *
 * Source checks, because there is no renderer in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const APP = read('App.tsx');
const PICK = read('src/PickPhotos.tsx');
const CREATE = read('src/CreateEvent.tsx');
const LIBRARY = read('src/library.ts');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the picker', () => {
  it('is where every way of making an album now begins', () => {
    expect(APP).toMatch(/screen: 'pick'/);
    expect(APP).toMatch(/<PickPhotos/);
    // No entry point goes straight to the form: it has nothing to draw its
    // window or its cover from without a selection behind it.
    expect(APP).not.toMatch(/setRoute\(\{ screen: 'create' \}\)/);
  });

  it('shows one big and the rest as a grid', () => {
    /*
     * A thumbnail 120 points across cannot be judged. The grid is for finding,
     * the frame above it is for looking — and the one last touched is the one in
     * the frame, so tapping along the grid is how somebody goes through them.
     */
    expect(code(PICK)).toMatch(/numColumns=\{COLUMNS\}/);
    expect(code(PICK)).toMatch(/styles\.frame/);
    // `contain` in the frame: cropping the thing being judged defeats it.
    expect(code(PICK)).toMatch(/contentFit="contain"/);
    // `cover` in the tiles, where the crop is the point.
    expect(code(PICK)).toMatch(/contentFit="cover"/);
  });

  it('numbers the selection rather than ticking it', () => {
    // The order is information: the first chosen leads the album.
    expect(code(PICK)).toMatch(/chosen\.findIndex\(\(p\) => p\.id === item\.id\)/);
    expect(code(PICK)).toMatch(/\{at \+ 1\}/);
    expect(code(PICK)).toMatch(/\[\.\.\.was, photo\]/);
  });

  it('asks for the library rather than waiting to be told', () => {
    // The screen is nothing but the library, so there is no version of it that
    // works without access.
    expect(code(PICK)).toMatch(/if \(state === 'undetermined'\) state = await requestLibraryAccess\(\)/);
    // And a refusal is a way on, not a dead end: an album can be made empty.
    expect(code(PICK)).toMatch(/label="Carry on without"/);
  });

  it('lets somebody through with nothing chosen', () => {
    /*
     * An album with no photographs is a real thing — made before the evening,
     * or to hand the link out at it — and the picker is not the place to refuse
     * it. The count on the button is so the next page is never a surprise.
     */
    expect(code(PICK)).not.toMatch(/disabled=\{chosen\.length === 0\}/);
    expect(code(PICK)).toMatch(/chosen\.length > 0 \? ` \(\$\{chosen\.length\}\)` : ''/);
  });

  it('pays for no location lookup to draw a grid', () => {
    /*
     * `scanWindow` exists for auto-selection and reads a location per asset so
     * it can group them by where they were. That is the expensive call, and a
     * grid somebody is scrolling needs none of it.
     */
    const fn = LIBRARY.slice(LIBRARY.indexOf('export async function recentPhotos'));
    const body = code(fn.slice(0, fn.indexOf('\n}')));
    expect(body).not.toMatch(/getLocation/);
    expect(body).toMatch(/ascending: false/);
  });
});

describe('the form, once the photographs have been chosen', () => {
  const form = code(CREATE);

  it('asks four things and posts', () => {
    // `CAPTION`, not `WHAT WAS IT?`: the framed cover sits above this field
    // now, and a caption is what words under a picture are called.
    expect(form).toMatch(/CAPTION/);
    expect(form).not.toMatch(/WHAT WAS IT\?/);
    expect(form).toMatch(/WHERE/);
    expect(form).toMatch(/WHO IS IN IT/);
    expect(form).toMatch(/WHO CAN SEE IT/);
    expect(form).toMatch(/'Post'/);
  });

  it('no longer asks when it was', () => {
    // Answered exactly by the photographs: first shutter to last, rather than a
    // phrase resolved to a six-hour box.
    expect(form).not.toMatch(/WHEN</);
    expect(form).not.toMatch(/WHEN_OPTIONS|windowFor|eventDateFor/);
    // Off what is going in, not off what was chosen: the row under the cover
    // can take photographs out, and dropping the last four of the night moves
    // when the album ends.
    expect(form).toMatch(/windowOf\(photos\)/);
  });

  it('never asks which picture leads — the first one chosen does', () => {
    /*
     * It used to ask, as `EVENT COVER`: a whole second trip through the library
     * to pick one of the pictures you had just picked, which is the same act
     * twice. Then it asked again on a page of its own. The rule is the order of
     * the selection, and the row on this screen is how it is changed.
     */
    expect(form).not.toMatch(/EVENT COVER/);
    expect(form).not.toMatch(/ImagePicker/);
    expect(form).toMatch(/const cover = photos\[0\] \?\? null/);
  });

  it('asks how it is framed on arrival, once', () => {
    /*
     * Framing behind a control is framing most people never find, and the cover
     * is the one thing on this screen everybody else sees. So the frame comes
     * up by itself — and exactly once: the ref is set before the state change
     * and never released, so React's pair of development invocations opens one
     * framer rather than two.
     */
    expect(form).toMatch(/if \(asked\.current \|\| chosen\.length === 0\) return;/);
    expect(form).toMatch(/asked\.current = true;\s*setFramerOpen\(true\);/);
  });

  it('frames the photographs already chosen, not ones picked again', () => {
    /*
     * `allowsEditing` is the obvious answer and cannot be used: iOS offers that
     * crop UI only as part of picking, so reaching for it means the whole camera
     * roll in front of somebody who chose these pictures ten seconds ago.
     *
     * The album goes in with it, so a different one can be tried in the frame —
     * which is the only place the question "does this work as a card" can
     * actually be answered.
     */
    expect(form).toMatch(/<CoverFramer/);
    expect(form).toMatch(/photos=\{photos\}/);
    expect(form).toMatch(/coverId=\{cover\.id\}/);
  });

  it('treats a photograph kept from the frame as a promotion', () => {
    // One path to "which one leads", so the cover cannot become a second fact
    // that disagrees with the order of the list.
    expect(form).toMatch(/if \(picked\) promote\(picked\);/);
    // And the framing lands after it, because `promote` centres what it is
    // handed.
    expect(form).toMatch(/if \(picked\) promote\(picked\);\s*setFraming\(next\);/);
  });

  it('takes a cancelled frame for an answer', () => {
    // Backing out leaves the first photograph leading, centred, which is what
    // the window would have shown anyway. It must not block the form or ask
    // again.
    expect(form).toMatch(/onCancel=\{\(\) => setFramerOpen\(false\)\}/);
    expect(form).toMatch(/useState<CoverFraming>\(CENTRED\)/);
  });

  it('has no page between the picker and itself', () => {
    // That page drew the cover in a 3:2 window and let somebody drag it. It
    // was a whole step everybody paid for so that some people could pan a
    // photograph, and the operating system already does it better.
    expect(APP).not.toMatch(/screen: 'cover'/);
    expect(APP).not.toMatch(/FrameCover/);
    expect(APP).toMatch(/route\.screen === 'pick'[\s\S]{0,400}screen: 'create'/);
  });

  it('asks who is in it whether or not a run was detected', () => {
    /*
     * These two used to sit inside a `{!picked && …}` branch, so an album made
     * from a detected run never offered them at all — you could not add anybody
     * or choose private on the path most people took.
     */
    expect(form).not.toMatch(/\{!picked &&/);
    expect(form).toMatch(/<InvitePicker/);
  });

  it('dates the album in local parts, not a UTC slice', () => {
    // A photograph taken at eleven at night is dated tomorrow in UTC, and "the
    // evening of the 14th" is exactly what the field is for.
    expect(form).toMatch(/function dayOf/);
    expect(form).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });

  it('waits only for a name', () => {
    expect(form).toMatch(/const ready = Boolean\(name\.trim\(\)\)/);
  });
});

describe('the size that made them fail', () => {
  it('sends the real one, read off the file', () => {
    /*
     * `resolveForUpload` returned `size: 0`, with a comment claiming the queue
     * sent the real size from disk. It does not — it presigns with exactly the
     * number handed to it — and `/api/events/[id]/uploads` refuses any file
     * whose size is not greater than zero. So every upload through this helper
     * was rejected before a byte moved, and the only symptom was
     * "3 didn't upload".
     */
    // Read off the copy that is actually being sent, not off a file the sender
    // cannot open. The media store has no size at all.
    expect(LIBRARY).toMatch(/size: copy\.size \?\? 0/);
    expect(LIBRARY).not.toMatch(/\bsize: 0,/);
    expect(LIBRARY).toMatch(/from 'expo-file-system'/);
  });

  it('is still the one thing the presign route insists on', () => {
    // Pinned from this side too: if the route ever stops refusing zero, the
    // comment above becomes a lie rather than a fixed bug.
    const route = readFileSync(
      fileURLToPath(
        new URL('../../web/app/api/events/[id]/uploads/route.ts', import.meta.url).href,
      ),
      'utf8',
    );
    expect(route).toMatch(/size <= 0\) return null/);
  });
});

describe('the sandbox copy', () => {
  it('copies each asset out of the Photos container first', () => {
    /*
     * `getUri()` returns a real `file://` path — `fullSizeImageURL` — but it
     * points inside the Photos library and is reached through a grant scoped to
     * this app in the foreground. The uploader runs a *background* URLSession,
     * so an out-of-process daemon opens the file, and it does not hold that
     * grant. The transfer failed before a byte moved.
     *
     * That is also why the symptom was so misleading: `uploadItem` reads any
     * throw as "no network", so it surfaced as "waiting for a connection, they
     * are saved and will go up on their own" — not waiting, not saved, never
     * going up.
     */
    expect(LIBRARY).toMatch(/new Directory\(Paths\.cache, OUTBOX\)/);
    expect(LIBRARY).toMatch(/await new File\(uri\)\.copy\(copy\)/);
    // The copy is what the queue is handed, not the asset.
    expect(LIBRARY).toMatch(/source: copy\.uri/);
  });

  it('names the copy by the asset, not by its filename', () => {
    // Two photographs taken a second apart can share `IMG_0042.HEIC`, and a
    // collision would upload one of them twice.
    expect(LIBRARY).toMatch(/assetId\.replace\(\/\[\^A-Za-z0-9\._-\]\/g, '_'\)/);
  });

  it('does not copy again over a copy it already made', () => {
    expect(LIBRARY).toMatch(/if \(!copy\.exists\)/);
  });

  it('deletes the copy once the bytes have landed, and not before', () => {
    const PLATFORM = read('src/platform.ts');
    // After a 2xx. A retry needs the bytes, so anything earlier is a queue that
    // cannot try again.
    const after = PLATFORM.slice(PLATFORM.indexOf('upload failed: ${result.status}'));
    expect(after).toMatch(/new File\(source\)\.delete\(\)/);
    // And only ever our own outbox: the same function sends covers, and
    // deleting a file somebody else owns would be a way to eat a camera roll.
    expect(after).toMatch(/inOutbox\(source\)/);
  });

  it('keeps the copies somewhere the system may reclaim', () => {
    // They are reproducible from the library, which is exactly the bargain
    // `Paths.cache` describes.
    expect(LIBRARY).toMatch(/Paths\.cache/);
    expect(LIBRARY).not.toMatch(/Paths\.document, OUTBOX/);
  });
});

describe('the two paths that still handed iOS a library file', () => {
  it('repairs a queue item that predates the copy', () => {
    /*
     * The queue is persisted, so items added before the copy existed still
     * carry the asset's own path. Left alone they retry forever against
     * something a background session can never open — which is what the device
     * log showed after the first fix landed:
     *
     *   Failed to issue sandbox extension for file
     *   file:///var/mobile/Media/DCIM/100APPLE/IMG_0891.PNG
     *
     * Repaired at the one place every upload passes through, so a future caller
     * that queues a library path gets the same repair rather than the same week.
     */
    const PLATFORM = read('src/platform.ts');
    expect(PLATFORM).toMatch(/if \(!inOutbox\(source\) \|\| !new File\(source\)\.exists\)/);
    expect(PLATFORM).toMatch(/source = \(await sandboxCopy\(item\.id\)\)\.uri/);
  });

  it('re-copies a copy that has gone, rather than crashing on it', () => {
    /*
     * Two conditions, and getting it down to one took the app out entirely.
     * A copy this code made can be *gone*: it is deleted after a successful
     * upload, and `Paths.cache` is a directory iOS empties whenever it likes.
     * Checking only "is it ours" pointed `UploadTask` at a deleted path, and the
     * native side raises for that rather than returning an error —
     *
     *   *** Terminating app due to uncaught exception 'NSInvalidArgumentException',
     *   reason: 'Cannot read file at file:///…/Caches/outbox/…'
     *
     * — which the queue runs into on launch, so one unreadable item made the
     * whole app unusable instead of making one photograph fail.
     */
    const PLATFORM = read('src/platform.ts');
    expect(PLATFORM).toMatch(/new File\(source\)\.exists/);
    // Checked once more at the last moment, because the cache can be reclaimed
    // between the copy and the upload.
    expect(PLATFORM).toMatch(/throw new SourceGone\(`copy missing after preparing it/);
    // An asset that cannot be read at all goes stale rather than burning
    // retries — and never raises.
    expect(PLATFORM).toMatch(/throw new SourceGone\(err instanceof Error/);
  });

  it('never hands the cover upload a file it has not checked', () => {
    // The cover is sent with nobody waiting on it, so a crash there would be
    // one nobody could connect to anything they had done.
    const PLATFORM = read('src/platform.ts');
    expect(PLATFORM).toMatch(/cover source is not readable/);
  });

  it('makes the first cover out of the derivative, not the picked original', () => {
    /*
     * The cover goes up on a background session exactly as a photograph does,
     * and an asset's own `uri` is a path inside the Photos container that the
     * background daemon cannot open — so it failed the same way, and was the
     * half of this that got missed.
     *
     * It is not sent from the form at all now. Sending it there meant sending
     * it before any photograph existed, with no id to record it against, and
     * the card then showed the cover and its own source picture side by side.
     *
     * The sandbox copy that fixed the first problem caused a quieter one: a
     * copy of the camera's own file is HEIC on any iPhone, `uploadCover` sends
     * bytes untouched, and the endpoint sniffs bytes rather than the declared
     * type. libheif answered `bad seek`, the endpoint answered 400, and this
     * effect threw it away — so a cover chosen while making an album silently
     * never took, on the format every iPhone photograph is in.
     *
     * So it waits for the derivative, which is what the other two ways into a
     * cover already use. `card` is null until the derivatives exist, which is
     * what makes it the thing to wait on, and `fetchForCover` writes into the
     * cache — this app's own sandbox, so the property the copy was here for is
     * kept.
     */
    expect(CREATE).not.toMatch(/uploadCover/);
    expect(APP).toMatch(/photo\.id === from && photo\.card !== null/);
    expect(APP).toMatch(/await fetchForCover\(derived\.full, derived\.id\)/);
    expect(APP).toMatch(/await sendCover\(file\.uri, initialCover, derived\.id\)/);
    expect(APP).not.toMatch(/const copy = await sandboxCopy\(local\);/);
  });

  it('keeps looking until the derivative its cover needs exists', () => {
    /*
     * Waiting for the derivative introduced a way to wait forever. The album
     * polls only while something is arriving, and it stops the moment nothing
     * is — which is a second or two before the derivative the cover is cut
     * from actually exists. So the framing was kept, the picture became ready,
     * and nobody asked again: no cover, no request, and nothing to report,
     * because nothing was attempted. It read as a cover that silently came out
     * unframed, which is what an album with no cover looks like — the card
     * leads with that same photograph either way.
     *
     * Bounded, because a derivative that is never coming must not be polled
     * for in somebody's pocket.
     */
    expect(APP).toMatch(
      /stillComing\.current =\s*uploading > 0 \|\| \(feed\?\.arriving \?\? 0\) > 0 \|\| coverWaiting\(\)/,
    );
    expect(APP).toMatch(
      /const coverWaiting = \(\) =>\s*coverOwed\.current && Date\.now\(\) < coverGiveUpAt\.current/,
    );
    expect(APP).toMatch(/coverGiveUpAt\.current = Date\.now\(\) \+ COVER_WAIT_MS/);
  });

  it('remembers which photograph it is waiting on, because the queue forgets', () => {
    /*
     * Polling for the derivative was not enough on its own, and production
     * shows why: the album asked `/photos` every two seconds for the whole
     * wait, the deriver had the picture ready at the second ask, and no cover
     * request was ever made.
     *
     * The id came out of the upload queue on every pass, and the queue stops
     * holding it: `runUploads` prunes every `done` item when a run ends, which
     * is a second after the bytes land and twenty-odd seconds before the
     * derivative exists. So the effect spent the entire wait returning at the
     * lookup — still owed a cover, still polling for it, and no longer able to
     * name the photograph it was polling for.
     *
     * Read once and kept. The lookup is inside the latch so a pruned queue is
     * not consulted again, and the id it reads is written at presign, long
     * before anything prunes.
     */
    expect(APP).toMatch(/const coverPhotoId = useRef<string \| null>\(null\);/);
    expect(APP).toMatch(
      /if \(!coverPhotoId\.current\) \{\s*const item = uploads\.items\.find\([\s\S]*?\);\s*if \(!item\?\.photoId\) return;\s*coverPhotoId\.current = item\.photoId;\s*\}/,
    );
    expect(APP).toMatch(/const from = coverPhotoId\.current;/);
    // And the wait itself is no longer read out of the queue.
    expect(APP).not.toMatch(/photo\.id === item\.photoId/);
  });

  it('says so when the derivative it needs cannot be fetched', () => {
    // `sendCover` reports its own failures; this one is the download in front
    // of it, which reported nothing at all. Not an alert — an album with no
    // cover leads with the same photograph — but not silence either.
    expect(APP).toMatch(/setQueueStatus\('Could not set the cover — use Change cover\.'\)/);
  });

  it('leaves the avatar upload alone, which never needed it', () => {
    // The system picker already hands back a copy in this app's own sandbox.
    const PROFILE = read('src/Profile.tsx');
    expect(PROFILE).toMatch(/uploadCover\(target\.url, target\.headers, picked\.assets\[0\]\.uri\)/);
    expect(PROFILE).not.toMatch(/sandboxCopy/);
  });
});

describe('the bar, and when the album is actually full', () => {
  it('measures the whole journey, not just the bytes leaving', () => {
    /*
     * A photograph is not in the album when it has been uploaded — it is in the
     * album when the deriver has been round. Measuring only the upload meant the
     * bar finished, the screen said "Nothing here yet", and the pictures then
     * appeared one at a time to anybody who kept pulling down.
     */
    expect(APP).toMatch(/const outstanding = uploading \+ \(feed\?\.arriving \?\? 0\)/);
    expect(APP).toMatch(/\(batch - outstanding\) \/ batch/);
    /*
     * And a zero is held rather than believed. `uploading` drops the instant
     * the last byte leaves, while the feed is still the one fetched before any
     * of this began — it says `arriving: 0` because it was read before the rows
     * existed. Believing that ended the batch on a stale answer, which is the
     * bar vanishing partway with the album still empty.
     */
    expect(APP).toMatch(/const settle = setTimeout\(\(\) => \{\s*setBatch\(null\);\s*setProgress\(null\);/);
    expect(APP).toMatch(/return \(\) => clearTimeout\(settle\)/);
  });

  it('asks again while anything is still being processed', () => {
    // The deriver tells nobody when it is done, so without this the album sits
    // on whatever it knew when it opened.
    /*
     * The condition is a ref, not a dependency, and that distinction is the
     * whole bug it was written for. As a dependency it included `uploading`,
     * which the queue writes every 400ms — so the effect tore its two-second
     * timer down and built a new one four hundred milliseconds into every wait.
     * It never reached the end of a cycle, so it never fired: what looked like
     * "polling stops after the first photograph" was polling that had never
     * started, with the single post-upload refresh doing all the work.
     */
    expect(APP).toMatch(/stillComing\.current = uploading > 0 \|\| \(feed\?\.arriving \?\? 0\) > 0/);
    expect(APP).toMatch(/if \(stillComing\.current\) void refresh\(\);/);
    // Made once, from a stable callback, so nothing re-renders it away.
    expect(APP).toMatch(/setInterval\(\(\)[\s\S]{0,80}\}, 2000\);\s*return \(\) => clearInterval\(timer\);\s*\}, \[refresh\]\);/);
  });

  it('sits on the cover’s own edge, in white that can be seen', () => {
    // It was on the page's top edge, sixteen points lower, reading as a line
    // floating in the gap.
    expect(APP).toMatch(/uploadBar: \{\s*position: 'absolute',\s*bottom: 0,/);
    /*
     * White, and this has been both.
     *
     * It was white, then the accent — because the bottom two points of the
     * header are the page's own near-white by design, where a white line is
     * not there at all. It is white again by request, and the objection was
     * real, so the line carries its own contrast now: a soft dark shadow
     * under 2.5 points reads as an edge rather than a glow and survives both
     * ends of the fade.
     *
     * The accent was never right over the top of it. Most of the bar's length
     * lies on somebody's photograph, and a blue chosen to sit on this
     * product's own surfaces is one more colour competing with whatever is in
     * the picture.
     */
    expect(APP).toMatch(/styles\.uploadBar,[\s\S]{0,800}\{ backgroundColor: '#fff' \}/);
    const bar = APP.slice(APP.indexOf('uploadBar: {'), APP.indexOf('uploadBar: {') + 1400);
    expect(bar).toMatch(/shadowColor: '#000'/);
    expect(bar).toMatch(/shadowOpacity: 0\.45/);
    // Drawn inside the cover, and still above everything that fades under it.
    const cover = APP.slice(APP.indexOf('<View style={styles.cover}>'));
    expect(cover.indexOf('styles.uploadBar')).toBeLessThan(cover.indexOf('styles.coverBack'));
    expect(cover.indexOf('styles.coverFoot')).toBeLessThan(cover.indexOf('styles.uploadBar'));
  });
});

describe('what happens to the photographs', () => {
  it('are uploaded, not merely implied by a window', () => {
    /*
     * The album used to be handed the event's window and left to re-scan the
     * library for it, which offers everything taken in those hours rather than
     * the pictures somebody actually chose. Close enough when the window came
     * from a phrase; wrong now that it comes from a selection.
     */
    expect(APP).toMatch(/initialUpload/);
    expect(APP).toMatch(/await enqueue\(await resolveForUpload\(initialUpload\)\)/);
    // The form's list, not the picker's: the row under the cover has a ⊗ on
    // every tile, so what arrives is not always what was chosen.
    expect(APP).toMatch(/photos\.map\(\(photo\) => photo\.id\)/);
  });

  it('are sent once, however often the effect re-runs', () => {
    // The guard is "this set, ever" — the effect re-runs when `enqueue` is
    // rebuilt, and without the latch a refresh would send them all again.
    expect(APP).toMatch(/if \(sent\.current \|\| !initialUpload\?\.length\) return/);
    expect(APP).toMatch(/sent\.current = true/);
  });

  it('says so rather than failing silently', () => {
    expect(APP).toMatch(/Could not start those uploads/);
  });
});

/**
 * Typing a name with a keyboard in the way.
 *
 * The caption field sits below a strip of detected runs, deliberately — the
 * screen opens on the photographs rather than on a text box. Which is exactly
 * why focusing it has to move the page: the field is below the fold by design,
 * so the keyboard that comes up when somebody taps it comes up over the thing
 * they tapped, and what that looks like is typing blind.
 */
describe('the fields on the create screen', () => {
  const CREATE = readFileSync(
    fileURLToPath(new URL('../src/CreateEvent.tsx', import.meta.url).href),
    'utf8',
  );

  it('brings the focused field above the keyboard', () => {
    // Measured rather than guessed: a constant would be wrong the moment the
    // strip above is there or is not.
    expect(CREATE).toMatch(/const measureField = useCallback\(/);
    expect(CREATE).toMatch(/onLayout=\{measureField\('name'\)\}/);
    expect(CREATE).toMatch(/onFocus=\{\(\) => bringIntoView\('name'\)\}/);
    // The label above belongs to the field, so the scroll stops short of it.
    expect(CREATE).toMatch(/Math\.max\(top - 24, 0\)/);
  });

  it('gives the scroll somewhere to move to', () => {
    /*
     * The other half, and neither works alone: the scroll used to end at its
     * content, so a field near the foot had nowhere to scroll *to* — the
     * keyboard came up over it and the view was already at the bottom.
     */
    expect(CREATE).toMatch(/automaticallyAdjustKeyboardInsets/);
    // And a tap on a pill while a field has focus presses the pill rather than
    // spending itself dismissing the keyboard.
    expect(CREATE).toMatch(/keyboardShouldPersistTaps="handled"/);
  });
});

/**
 * The duplicate on a card of four photographs.
 *
 * An album of four showed a cover and three thumbnails under it, and one of
 * the three was the cover again. Not a rendering fault: the card already
 * skips `mosaic[0]`, and the server already drops the photograph a cover was
 * cropped from — where it knows which one that was.
 *
 * It did not know. The form sent the cover the moment the album existed,
 * before a single photograph had been presigned, so there was no id to name
 * it by and `coverPhotoId` was written null. Setting a cover from inside an
 * album has always passed the id and has never had this.
 */
describe('a cover that knows which photograph it came from', () => {
  it('is sent once that photograph has an id, not before', () => {
    // The wait: the queue item for the first chosen picture, with a photoId.
    expect(APP).toMatch(/const local = initialUpload\?\.\[0\];/);
    expect(APP).toMatch(/uploads\.items\.find\(\(i\) => i\.id === local && i\.eventId === event\.id\)/);
    expect(APP).toMatch(/if \(!item\?\.photoId\) return;/);
  });

  it('names it, which is the whole point', () => {
    // `derived` is found by `photo.id === item.photoId`, so naming it by
    // `derived.id` is naming it by the id the wait above was for.
    expect(APP).toMatch(/sendCover\(file\.uri, initialCover, derived\.id\)/);
    // `sendCover` hands it to the route as `?photo=`, which is what the
    // server records and later uses to drop it from the strip.
    expect(APP).toMatch(/api\.coverTarget\(event\.id, framing, photoId\)/);
    const API = read('src/api.ts');
    expect(API).toMatch(/if \(photoId\) query\.set\('photo', photoId\);/);
  });

  it('sends one cover, however often the queue is saved', () => {
    // The queue state changes on every save, and this effect watches it.
    expect(APP).toMatch(/const coverSent = useRef\(false\);/);
    expect(APP).toMatch(/coverSent\.current = true;/);
  });

  it('leaves the card looking right in the meantime', () => {
    /*
     * Uncovered, a card leads with `mosaic[0]` — which is that same
     * photograph. So the seconds before the cover lands show the same
     * picture, unframed, rather than a gap.
     */
    const CARDS = read('../../apps/web/src/cards.ts');
    expect(CARDS).toMatch(/const cover = await coverSrc\(listing\.coverKey\);\s*if \(cover\) return cover;/);
    expect(CARDS).toMatch(/const first = listing\.mosaic\[0\];/);
  });
});
