/**
 * Add members, from the top of a roll's People pane.
 *
 * Read from the source, as the rest of this app's tests are.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const APP = read('App.tsx');
const PEOPLE = read('src/Thread.tsx');
const PAGE = read('src/AddMembers.tsx');

describe('add members', () => {
  it('heads the People pane, for whoever runs a roll not in a group', () => {
    expect(PEOPLE).toMatch(/<RoundButton t={t} wide onPress={onAdd} accessibilityLabel="Invite people">/);
    expect(PEOPLE).toMatch(/>Invite people<\/Text>/);
    expect(APP).toMatch(/feed\?\.event\.canAdminister && !feed\.event\.groupId\s*\? \(\) => setAddingMembers\(true\)/);
  });

  it('is a page over the roll, with Back to the list', () => {
    expect(APP).toMatch(/<SwipeBack onBack=\{\(\) => setAddingMembers\(false\)\}>\s*<AddMembers/);
    expect(PAGE).toMatch(/accessibilityLabel="Back"/);
    // An edge swipe there is that page's Back, not the roll's.
    expect(APP).toMatch(/onCovered\?\.\(addingMembers\)/);
  });

  it('suggests friends first, then friends of friends, leaving out who is in', () => {
    expect(PAGE).toMatch(/api\.friends\(\)[\s\S]{0,80}api\.suggestedPeople\(\)/);
    expect(PAGE).toMatch(/for \(const person of \[\.\.\.friends, \.\.\.more\]\)/);
    expect(PAGE).toMatch(/known\.get\(person\.actorId\) === 'in'\) continue/);
    expect(PAGE).toMatch(/>SUGGESTED</);
  });

  it('searches anybody by name or handle', () => {
    expect(PAGE).toMatch(/api\s*\.findPeople\(q\)/);
  });

  it('asks rather than adds, and says so', () => {
    expect(PAGE).toMatch(/await api\.invite\(eventId, \[id\]\)/);
    expect(PAGE).toMatch(/\{state === 'in' \? 'In the roll' : 'Asked'\}/);
    expect(PAGE).toMatch(/They are asked, and they\s+answer in Lately\./);
  });
});
