/**
 * The album's conversation is a comment board, on the site as in the app.
 *
 * It was bubbles on sides — yours on the right in the mark's blue, everybody
 * else's on the left in its mint — on the argument that a thread is people
 * talking to each other and a bubble is the shape everybody knows for that.
 * It is the shape everybody knows for a *messenger*, and this column is not
 * one: it is what was said about somebody's evening, read under the
 * photographs of it, on a tab called Comments.
 *
 * Both clients now draw the same board, so both are pinned from here: the app
 * by `apps/mobile/test/thread.test.ts`, the shared rules by this.
 *
 * Source checks, because there is no browser in this suite.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from './support/source';

const raw = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const THREAD = stripComments(raw('../app/components/Thread.tsx'));
const CSS = raw('../app/globals.css');
/* Comments stripped for the rules, kept for nothing else: every claim below
   is about what a browser does, and a browser does not read the prose. */
const RULES = stripComments(CSS);
const APP_THREAD = raw('../../mobile/src/Thread.tsx');

describe('one shape for every comment, and a side for your own', () => {
  it('hangs your own from the right, and takes nothing else with it', () => {
    /*
     * The mirror and the fill used to be one decision and they are two. A
     * column with everybody in it is a wall of other people's comments with
     * yours somewhere in it, and which edge a block hangs from is seen before
     * a word is read; what made this a messenger was the pastel fill behind
     * the words, not the edge.
     */
    expect(THREAD).toMatch(/message\.author\.mine \? ' message-mine' : ''/);
    expect(RULES).toMatch(/\.message-mine \{ flex-direction: row-reverse; \}/);
    // The face goes with it: a block hanging off the right with its avatar
    // still on the left is neither side.
    expect(RULES).not.toMatch(/\.message-mine \.message-face/);
    // And what turns round with it is furniture, never the paragraph. Right-
    // aligned prose over three lines is read a word at a time.
    /* Pushed rather than reversed: `row-reverse` reads the line backwards —
       "just now You" — and the app's meta is one string that cannot reverse
       at all. The name goes first in every row on the page. */
    expect(RULES).toMatch(/\.message-mine \.message-meta \{ justify-content: flex-end; \}/);
    /* The reactions are the exception: centred under every comment rather
       than following the side of one, because a reaction belongs to everybody
       who tapped it and not to whoever wrote the words above it. */
    expect(RULES).not.toMatch(/\.message-mine \.reactions/);
    expect(RULES).toMatch(/\.reactions \{[^}]*justify-content: center;/);
    expect(RULES).not.toMatch(/\.message-mine[^{]*\{[^}]*text-align: right/);
    // The name and the menu still say whose it is, which is what said it on
    // paper anyway.
    expect(THREAD).toMatch(/message\.author\.mine \? 'You' : message\.author\.name/);
    expect(THREAD).toMatch(/message\.author\.mine && !editing && \(\s*<MessageMenu/);
  });

  it('is prose on the page rather than a fill', () => {
    // No bubble, so no bubble colours: the pair that used to be here were the
    // mark's blue and mint, and taking them out is the point.
    expect(RULES).not.toMatch(/--bubble-mine|--bubble-them/);
    const text = RULES.slice(RULES.indexOf('.message-text {'));
    expect(text.slice(0, text.indexOf('}'))).not.toMatch(/background|border-radius/);
    expect(text).toMatch(/color: var\(--fg\)/);
  });

  it('marks a mention in the accent, like everywhere else in the product', () => {
    /*
     * A mention inside a bubble of the mark's blue cannot carry accent ink —
     * two blues arguing — so there was a second rule underlining it instead.
     * With the fill gone the colour is available, and one rule beats two.
     */
    expect(RULES).toMatch(/\.mention \{ font-weight: 600; color: var\(--accent\); \}/);
    expect(RULES).not.toMatch(/\.message-text \.mention/);
  });

  it('caps the measure for reading rather than for the bubble', () => {
    // 78% was there so a long message did not stop reading as a bubble. The
    // reason to cap a line of prose is the older one: past about 70
    // characters the eye loses its place coming back to the left edge.
    expect(RULES).toMatch(/\.message-body \{ min-width: 0; max-width: min\(100%, 600px\); \}/);
  });

  it('says what the box is for, and what the empty board is for', () => {
    expect(THREAD).toMatch(/placeholder="Add a comment…"/);
    expect(THREAD).not.toMatch(/Message everyone in this album/);
    // The same words the app's board says, because it is the same empty board.
    expect(THREAD).toMatch(/Say something about these photographs\./);
    expect(APP_THREAD).toMatch(/'Say something about these photographs\.'/);
  });
});

describe('the photograph a line is about', () => {
  it('is under the comment that is about one', () => {
    /*
     * A comment written under a picture is a line in this same board carrying
     * its `photo_id` — one thread, two ways in. This column drew the words
     * and dropped the picture, so "look at her face in this one" arrived with
     * no *this one* in it.
     */
    expect(THREAD).toMatch(/className="message-about"/);
    expect(RULES).toMatch(/\.message-about \{/);
    // The same 52 the app's board uses, so the two are one drawing.
    expect(RULES).toMatch(/width: 52px; height: 52px/);
    expect(APP_THREAD).toMatch(/aboutShot: \{ width: 52, height: 52 \}/);
  });

  it('is what a reaction is drawn with, rather than an empty bubble', () => {
    /*
     * The feed merges every reaction in the album into this thread so that
     * one column reads in one order, and this file never knew the difference:
     * each drew as a message with a face, a name, a time and an empty
     * paragraph.
     */
    expect(THREAD).toMatch(/if \(message\.emoji\) \{/);
    expect(THREAD).toMatch(/className="muted thread-reacted"/);
    // In the slot a comment gives its author's face, and square where that is
    // round: that slot holds a person in every other row and a picture here.
    expect(RULES).toMatch(/\.thread-reacted-shot \{[^}]*border-radius: 8px/);
    expect(RULES).toMatch(/\.thread-reacted \{[^}]*gap: 10px/);
  });

  it('is a link, not a handler', () => {
    // The middle-click, the Copy-link and the Back button all come from the
    // element — the same reason `PhotoTile` is an `<a href>`.
    expect(THREAD).toMatch(/`\/event\/\$\{eventId\}\/p\/\$\{photo\.id\}`/);
    expect(THREAD).toMatch(/<a href=\{about\.href\}/);
  });

  it('has the failure path every other image on this site has', () => {
    /*
     * These URLs are signed against the event's `cap_epoch`, so they stop
     * resolving for ordinary reasons. A failed one leaves the line reading
     * "Ana reacted ❤️" with nothing beside it, which is what the app draws
     * when its feed no longer holds the photograph.
     */
    expect(THREAD).toMatch(/useImageFailure\(about\?\.src \?\? ''\)/);
    expect(THREAD).toMatch(/!shot\.failed/);
  });
});
