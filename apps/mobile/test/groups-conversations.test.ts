/**
 * The Groups tab, once it became every conversation.
 *
 * It was a directory: a letter tile, a name, a line of counts, repeated — a
 * list of rooms with no way to say anything in any of them, on the tab that is
 * meant to hold the product's conversations. The handoff's 4b makes it one
 * scroll of every thread this person has: the groups they are in, each showing
 * its own talk, and the one-off evenings that belong to no group.
 *
 * Source checks, because there is no renderer in this suite. What they are
 * guarding is mostly the two rules that are invisible until a row is wrong:
 * which conversations appear, and which of them belongs to whom.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url).href), 'utf8');

const EVENTS = read('src/Events.tsx');
const APP = read('App.tsx');
const API = read('src/api.ts');
const THREAD = read('src/Thread.tsx');
const GROUP_THREAD = read('src/GroupThread.tsx');

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TAB = code(
  EVENTS.slice(EVENTS.indexOf('export function GroupsTab'), EVENTS.indexOf('function GroupBlock')),
);

describe('which conversations appear', () => {
  it('lists the evenings that belong to no group', () => {
    /*
     * A grouped event's talk belongs under its group's block. Listing it in
     * both places would make the busiest rooms the noisiest part of a screen
     * whose whole job is to be scanned.
     */
    expect(TAB).toMatch(/events\s*\n?\s*\.filter\(\(event\) => !event\.groupId\)/);
  });

  it('orders them by what was last said, not by what was last uploaded', () => {
    // A silent album full of photographs above the one somebody is talking in
    // is the wrong answer on a tab about talking.
    expect(TAB).toMatch(/b\.lastMessage\?\.at \?\? b\.lastActiveAt/);
  });

  it('keeps an event nobody has spoken in', () => {
    // It is a door: the thread is how you reach it, and hiding it until
    // somebody speaks means nobody ever does.
    expect(TAB).toMatch(/Nobody has said anything yet\./);
  });
});

describe('one conversation, as one line', () => {
  it('is written once and drawn in both places', () => {
    // A group block and an event-chat row are the same sentence about two
    // kinds of room; written twice they drift.
    expect(EVENTS).toMatch(/function ConversationLine\(/);
    expect(EVENTS.match(/<ConversationLine/g) ?? []).toHaveLength(2);
  });

  it('carries unread in the ink as well as in the badge', () => {
    // The pill alone is a small blue circle somebody has to find; the weight
    // of the line is what they see first.
    expect(EVENTS).toMatch(/color: unread \? t\.fg : t\.dim/);
  });

  it('is a count on a group and a dot on an event chat', () => {
    /*
     * A group is busy and the number is the useful part; an event chat is
     * usually one or two messages, and a number there is precision nobody
     * asked for.
     */
    expect(EVENTS).toMatch(/styles\.unreadPill/);
    expect(EVENTS).toMatch(/styles\.unreadDot/);
    // The dot is asked for at the event-chat call site and nowhere else.
    expect(EVENTS.match(/\n\s+dot\n/g) ?? []).toHaveLength(1);
  });

  it('says "You" rather than your own name back at you', () => {
    expect(EVENTS).toMatch(/last\.mine \? 'You' : last\.author/);
  });
});

describe('where a row goes', () => {
  it('separates the room from its conversation', () => {
    // The block is the group — its people and its evenings. The line at the
    // foot is the talk, which is a different screen.
    expect(TAB).toMatch(/onPress=\{\(\) => onOpenGroup\(group\.id\)\}/);
    expect(TAB).toMatch(/onOpenThread=\{\(\) => onOpenGroupThread\(group\)\}/);
  });

  it('opens an event chat on the conversation rather than the photographs', () => {
    expect(APP).toMatch(/onOpenEventThread=\{\(listing\) => \{\s*void open\(listing, 'talk'\);/);
  });

  it('still opens a link on the photographs, always', () => {
    /*
     * The rule that survives: an event's *link* must never open on its roster
     * or halfway down somebody's conversation. The pane is optional and only
     * an in-app row that is itself a conversation sets it.
     */
    expect(APP).toMatch(/useState<Pane>\(initialPane \?\? 'photos'\)/);
    expect(APP).toMatch(/pane\?: Pane;/);
    // The deep-link path does not pass one.
    expect(APP).not.toMatch(/screen: 'event', event, pane: '(talk|people)'/);
  });
});

describe('a group’s own thread', () => {
  it('reuses the album’s thread rather than drawing a second one', () => {
    // Same composer, same tombstones, same mention rules.
    expect(GROUP_THREAD).toMatch(/import \{ Thread \} from '\.\/Thread'/);
    expect(THREAD).toMatch(/export type ThreadActions/);
  });

  it('is given its verbs rather than reaching for them', () => {
    /*
     * A message id from `group_message` is not a message id from
     * `event_message`, and a component that guessed which route to call would
     * be one that can guess wrong.
     */
    expect(THREAD).toMatch(/actions: ThreadActions;/);
    expect(THREAD).not.toMatch(/api\.postMessage|api\.deleteMessage|api\.editMessage/);
    expect(GROUP_THREAD).toMatch(/api\.postGroupMessage\(group\.id, body\)/);
    expect(APP).toMatch(/post: \(body: string\) => api\.postMessage\(event\.id, body\)/);
  });

  it('draws no reaction picker where there is nothing behind it', () => {
    // A group message has no reactions yet; offering a picker that does
    // nothing is worse than not offering one.
    expect(THREAD).toMatch(/canPost && canReact/);
    expect(THREAD).toMatch(/canReact=\{actions\.react != null\}/);
  });

  it('carries the summary it already has rather than re-fetching a title', () => {
    // Re-reading a name, a member count and a lens to render a header is a
    // spinner where a name should be.
    expect(APP).toMatch(/screen: 'groupThread'; group: MyGroupDetail/);
  });
});

describe('what the server had to grow', () => {
  it('asks for both halves of a row in the list call, not per row', () => {
    expect(API).toMatch(/export type ThreadLine = \{/);
    expect(API).toMatch(/unreadCount: number;/);
    // Events carry one too, so an event chat can be drawn from the same list
    // the home screen already loads.
    expect(API).toMatch(/\} & ThreadLine;/);
  });

  it('marks an event read explicitly rather than as a side effect', () => {
    /*
     * The phone reads photographs, roster and thread out of one request.
     * Clearing a badge because somebody opened an album would clear it for a
     * conversation they never looked at.
     */
    expect(API).toMatch(/markEventRead\(eventId: string, linkToken: string\)/);
    expect(API).toMatch(/\/api\/events\/\$\{eventId\}\/read/);
  });

  it('keeps a group’s messages on their own path', () => {
    expect(API).toMatch(/\/api\/groups\/\$\{groupId\}\/messages/);
    expect(API).toMatch(/\/api\/group-messages\/\$\{messageId\}/);
  });
});
