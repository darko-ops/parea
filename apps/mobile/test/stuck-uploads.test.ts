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

describe('what stays true', () => {
  it('still tells somebody in a basement to do nothing', () => {
    /*
     * Waiting for a connection is not a failure and must not grow a button.
     * Nothing is lost and nothing needs doing — saying that plainly is the
     * difference between somebody waiting and somebody force-quitting the app
     * on their photographs.
     */
    expect(APP).toMatch(/they are saved and will go up on their own/);
    expect(APP).toMatch(/queue\.waitingForNetwork\s*\?\s*`\$\{queue\.pendingCount\} waiting for a connection`/);
  });

  it('does not tell somebody to keep the app open about a dead upload', () => {
    // That advice is for work still in flight. Printed beside "6 didn't
    // upload" it reads as "wait and this will fix itself", which it will not.
    expect(APP).toMatch(/stuck\.failed === 0 &&\s*stuck\.stale === 0 &&\s*' — keep the app open until this finishes'/);
  });
});
