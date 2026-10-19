/**
 * Swiping a chat left: Pin and Delete.
 *
 * Read from the source, as the rest of this app's tests are. What Delete does
 * to rows is the server's, and `apps/web/test/chat-pin-clear.test.ts` runs it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const EVENTS = read('src/Events.tsx');
const ROW = read('src/SwipeRow.tsx');
const API = read('src/api.ts');

describe('a chat swiped left', () => {
  it('shows Pin and Delete behind it', () => {
    expect(EVENTS).toMatch(/<SwipeRow\s+key=\{group\.id\}/);
    expect(EVENTS).toMatch(/label: pinned \? 'Unpin' : 'Pin'/);
    expect(EVENTS).toMatch(/\{ label: 'Delete', glyph: 'trash'/);
  });

  it('takes only a sideways finger, and never gives it back to the list', () => {
    expect(ROW).toMatch(/Math\.abs\(dx\) > Math\.abs\(dy\) \* 1\.5/);
    expect(ROW).toMatch(/\(dx < 0 \|\| live\.current\.open\)/);
    expect(ROW).toMatch(/onMoveShouldSetPanResponderCapture/);
    expect(ROW).toMatch(/onPanResponderTerminationRequest: \(\) => false/);
  });

  it('moves the row by layout, so a press on Pin or Delete lands', () => {
    // A native `translateX` moved the picture of the row and not where React
    // thought it was, and presses on the buttons were taken by the row.
    expect(ROW).toMatch(/left: x,/);
    expect(ROW).not.toMatch(/translateX: x/);
    expect(ROW).not.toMatch(/useNativeDriver: true/);
  });

  it('acts on a quick tap, not only a held press', () => {
    // A `Pressable` in the list lost quick taps to the gesture system. The
    // buttons claim the touch on landing and keep it from the list.
    expect(ROW).not.toMatch(/<Pressable/);
    expect(ROW).toMatch(/onStartShouldSetResponder=\{\(\) => true\}/);
    expect(ROW).toMatch(/onResponderTerminationRequest=\{\(\) => false\}/);
    expect(ROW).toMatch(/if \(moved < ACTION \/ 2\) action\.onPress\(\);/);
  });

  it('keeps one row open, and a tap or a scroll puts it away', () => {
    expect(EVENTS).toMatch(/onPress=\{\(\) => \(openId \? setOpenId\(null\) : onOpenGroupThread\(group\)\)\}/);
    expect(EVENTS).toMatch(/onScrollBeginDrag=\{\(\) => setOpenId\(null\)\}/);
  });

  it('asks before deleting, and says it is for you only', () => {
    expect(EVENTS).toMatch(/'Delete this chat\?'/);
    expect(EVENTS).toMatch(/deleted for you only/);
    expect(API).toMatch(/deleteChat\(id: string\)[\s\S]{0,120}method: 'DELETE'/);
    expect(API).toMatch(/pinChat\(id: string, pinned: boolean\)[\s\S]{0,160}method: 'PATCH'/);
  });

  it('orders pinned first and leaves a deleted chat out until something new', () => {
    expect(EVENTS).toMatch(/\.filter\(\(group\) => !\(group\.clearedAt && !group\.lastMessage\)\)/);
    expect(EVENTS).toMatch(/\(b\.pinnedAt \?\? ''\)\.localeCompare\(a\.pinnedAt \?\? ''\) \|\|/);
  });

  it('can be done without swiping', () => {
    expect(EVENTS).toMatch(/accessibilityActions=\{\[\s*\{ name: 'pin'/);
  });
});
