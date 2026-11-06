/**
 * Leaving a roll opened from a group returns to the group, not the tabs.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8');

describe('a roll opened from a group', () => {
  it('is opened with the group as its way back', () => {
    const group = APP.slice(APP.indexOf("route.screen === 'group' &&"));
    // The group's own route, so its `back` comes along: a group opened from
    // Lately, then a roll in it, backs out roll → group → Lately.
    expect(group.slice(0, 1200)).toMatch(
      /onOpenEvent=\{\(event\) => open\(event, undefined, undefined, undefined, route\)\}/,
    );
  });

  it('is left through that way back', () => {
    expect(APP).toMatch(/was\.screen === 'event' && was\.back \? was\.back/);
    expect(APP).toMatch(/was\.screen === 'group' && was\.back \? was\.back/);
  });
});
