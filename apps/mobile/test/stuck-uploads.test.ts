/**
 * The line under the tabs that would not go away.
 *
 * "6 didn't upload" sat below the album's tabs with nothing to press and
 * nothing to dismiss, through every later run, on an album whose uploads had
 * all just succeeded. Two separate faults, and both of them read to somebody
 * using the app as the same thing: a permanent error that has nothing to do
 * with what they just did.
 *
 * **It was counting the whole queue.** `failedCount` and `staleItems` are the
 * queue's, not an album's, and nothing but `done` is ever pruned — so a failure
 * in one album outlived every run and captioned every other album's uploads.
 * The counts this screen reads are scoped to the event now.
 *
 * **And there was no way back.** `failed` is terminal after `MAX_ATTEMPTS`, and
 * it has to be: a queue that retried forever would sit in a pocket burning a
 * battery on a file the server keeps refusing. But terminal is not permanent,
 * and there was no way to spend another attempt — four tries against a
 * condition that has since changed were the end of the photograph. A report
 * with no remedy beside it is not information, it is a scar, and a line that
 * never clears is one people learn to read past. Which is the real cost: the
 * one message on this screen that might one day matter stops being read.
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
const QUEUE = read('../../packages/upload/src/index.ts');

describe('what the line counts', () => {
  it('is this album’s stuck uploads, not the queue’s', () => {
    expect(APP).toMatch(/const failed = queue\.failedIn\(event\.id\)\.length;/);
    expect(APP).toMatch(/const stale = queue\.staleIn\(event\.id\)\.length;/);
    // The global counts are still there for a screen that is about the queue.
    // What must not come back is this screen reading them.
    const run = APP.slice(APP.indexOf('const runQueue'), APP.indexOf('const retryStuck'));
    expect(run).not.toMatch(/queue\.failedCount/);
    expect(run).not.toMatch(/queue\.staleItems/);
  });

  it('asks the queue in a way that can answer per album', () => {
    expect(QUEUE).toMatch(/failedIn\(eventId: string\): QueueItem\[\]/);
    expect(QUEUE).toMatch(/staleIn\(eventId: string\): QueueItem\[\]/);
  });
});

describe('the way out', () => {
  it('offers another attempt when something failed', () => {
    expect(APP).toMatch(/stuck\.failed > 0 \? \(/);
    expect(APP).toMatch(/onPress=\{\(\) => void retryStuck\(\)\}/);
    expect(APP).toMatch(/>Try again</);
  });

  it('offers to let go when the bytes are gone instead', () => {
    /*
     * A stale item cannot be retried into existence — another four attempts
     * would find its bytes just as gone — so the only honest offer is to stop
     * asking. Nothing is lost: the photographs are in the camera roll, which is
     * where they were all along.
     */
    expect(APP).toMatch(/stuck\.stale > 0 && \(/);
    expect(APP).toMatch(/onPress=\{\(\) => void forgetStuck\(\)\}/);
    expect(APP).toMatch(/>Never mind</);
    expect(APP).toMatch(/queue\.forget\(queue\.staleIn\(event\.id\)\.map\(\(i\) => i\.source\)\)/);
  });

  it('never offers both at once', () => {
    // They are opposite advice. A screen showing "try again" beside "never
    // mind" is a screen that does not know which of them is true.
    expect(APP).toMatch(/stuck\.failed > 0 \? \([\s\S]{0,900}\) : \([\s\S]{0,200}stuck\.stale > 0 &&/);
  });

  it('retries only this album’s failures', () => {
    // Pressing "try again" under one album must not wake another's, which
    // would upload into a room the person is not looking at.
    expect(APP).toMatch(/queue\.retryFailed\(event\.id\)/);
    expect(QUEUE).toMatch(/retryFailed\(eventId\?: string\): number/);
  });

  it('spends real attempts rather than one more', () => {
    /*
     * The cap exists to stop an unattended loop. A person pressing a button is
     * not an unattended loop, and leaving the count at the cap would buy a
     * single attempt and then put the same dead line back on the screen.
     */
    const retry = QUEUE.slice(QUEUE.indexOf('retryFailed(eventId'), QUEUE.indexOf('retryFailed(eventId') + 500);
    expect(retry).toMatch(/item\.attempts = 0;/);
    expect(retry).toMatch(/item\.status = 'pending';/);
  });

  it('says something while the retry is running', () => {
    // The press has to land. Without this the line sits unchanged until the
    // run finishes, which looks like a button that did nothing.
    expect(APP).toMatch(/setQueueStatus\('Trying again…'\)/);
  });
});

describe('one album at a time', () => {
  it('runs only this album’s work', () => {
    /*
     * The queue holds work for every album this phone has uploaded into, and
     * it will happily work all of it. This client cannot: it presigns and
     * completes with the link token of the album on screen, so a leftover item
     * from another evening went up with the wrong credential and came back
     * refused — a failure invented by the queue being more capable than its
     * caller.
     */
    expect(APP).toMatch(/await queue\.run\(event\.id\)/);
    expect(QUEUE).toMatch(/async run\(eventId\?: string\): Promise<void>/);
  });

  it('does not start a run because another album has leftovers', () => {
    expect(APP).toMatch(
      /if \(!state\.items\.some\(\(i\) => i\.eventId === event\.id\)\) return;/,
    );
  });

  it('counts the bar off this album too', () => {
    // Another evening's pending items in the total is a bar that cannot reach
    // the end, for photographs this screen is not sending and will never show.
    expect(APP).toMatch(/const done = queue\.doneIn\(event\.id\);/);
    expect(APP).toMatch(/const pending = queue\.pendingIn\(event\.id\);/);
  });

  it('leaves the other album’s work in the saved state', () => {
    /*
     * The load-bearing half, and the reason this is scoped inside `run` rather
     * than by filtering the state on the way in: every run writes the whole
     * state back, so a filtered queue would erase the other album's items the
     * first time this one saved.
     */
    expect(QUEUE).toMatch(
      /\(i\.status === 'presigned' \|\| i\.status === 'uploaded'\) &&\s*\(!eventId \|\| i\.eventId === eventId\)/,
    );
    expect(QUEUE).toMatch(/i\.status === 'pending' && \(!eventId \|\| i\.eventId === eventId\)/);
    // And nothing in the client narrows the state before constructing a queue.
    expect(APP).not.toMatch(/state\.items\.filter/);
  });
});

describe('the run that ends with work left', () => {
  /*
   * The silent case, and the one that put four of eight photographs nowhere.
   *
   * `run` used to stop after a single failed attempt per item, leaving it
   * `pending` with its retries unspent. That is not `failed`, so no count
   * reported it; the run was not paused, so it was not waiting for a network
   * either. This screen computed "nothing to say", cleared the line and emptied
   * the bar, and the photographs waited for somebody to reopen the album.
   *
   * The queue spends its attempts in one run now. This is the belt: whatever is
   * still outstanding when a run finishes gets counted and gets a button.
   */
  it('counts what is still outstanding, not only what failed', () => {
    expect(APP).toMatch(
      /const unfinished = queue\.waitingFor\(event\.id\) \? 0 : queue\.pendingIn\(event\.id\);/,
    );
    expect(APP).toMatch(/const stuckNow = failed \+ unfinished;/);
    expect(APP).toMatch(/setStuck\(\{ failed: stuckNow, stale \}\)/);
  });

  it('says so, rather than clearing the line', () => {
    expect(APP).toMatch(/stuckNow > 0\s*\?\s*`\$\{stuckNow\} didn't upload`/);
  });

  it('lets the button run them even though none reached failed', () => {
    // `retryFailed` returns 0 when nothing is terminal yet. Bailing on that was
    // how the case with no message also ended up with no remedy.
    expect(APP).toMatch(
      /if \(woken === 0 && queue\.pendingIn\(event\.id\) === 0\) return;/,
    );
  });

  it('spends the attempts inside one run, because nothing calls it twice', () => {
    // Both clients call `run` once per batch and neither watches for
    // leftovers, so a budget only spendable across runs was a budget of one.
    expect(QUEUE).toMatch(/const again = this\.retryable\(eventId\);/);
    expect(QUEUE).toMatch(/await this\.wait\(RETRY_BACKOFF_MS \* retries\);/);
  });

  it('picks up bytes that are up but unconfirmed', () => {
    // `uploaded` was written and never read: not `pending`, so never
    // presigned; not `presigned`, so never pushed. A crash between the PUT and
    // the confirmation stranded the photograph in the queue for good.
    expect(QUEUE).toMatch(/if \(item\.status !== 'uploaded'\) \{/);
  });
});

describe('what stays true', () => {
  it('still tells somebody in a basement to do nothing', () => {
    /*
     * Waiting for a connection is not a failure and must not grow a button.
     * Nothing is lost and nothing needs doing — saying that plainly is the
     * difference between somebody waiting and somebody force-quitting the app
     * on their photographs.
     */
    expect(APP).toMatch(/they are saved and will go up on their own/);
    // Scoped, like everything else this line says: a signal this album is
    // waiting for, not one another evening's leftovers are waiting for.
    expect(APP).toMatch(
      /queue\.waitingFor\(event\.id\)\s*\?\s*`\$\{queue\.pendingIn\(event\.id\)\} waiting for a connection`/,
    );
  });

  it('does not tell somebody to keep the app open about a dead upload', () => {
    // That advice is for work still in flight. Printed beside "6 didn't
    // upload" it reads as "wait and this will fix itself", which it will not.
    expect(APP).toMatch(/stuck\.failed === 0 &&\s*stuck\.stale === 0 &&\s*' — keep the app open until this finishes'/);
  });
});
