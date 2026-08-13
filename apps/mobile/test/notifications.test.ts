/**
 * Where a tapped notification goes — design §12.
 *
 * §12 permits one reminder per event, ever, and the payload has always
 * carried a target that nothing read. So the cost of getting this wrong is
 * not a broken screen: it is the single interruption this product is allowed
 * to make, spent on bringing the app forward and doing nothing.
 *
 * Pure, and tested here, because the alternative is rebuilding the app,
 * reinstalling it, and waiting for a push to arrive.
 */

import { describe, expect, it } from 'vitest';

import { notificationTarget } from '../src/notifications';

const EVENT = '3f1c9a2e-4b5d-4e6f-8a9b-0c1d2e3f4a5b';
const GROUP = '7a2b1c3d-8e9f-4a5b-9c8d-1e2f3a4b5c6d';

describe('the three notifications', () => {
  it('sends a nudge to its event', () => {
    expect(
      notificationTarget({ kind: 'nudge', eventId: EVENT, eventName: 'Party', photoCount: '12' }),
    ).toEqual({ screen: 'event', eventId: EVENT });
  });

  it('sends an answered removal request to its event', () => {
    expect(
      notificationTarget({ kind: 'removal_answered', eventId: EVENT, removed: 'true' }),
    ).toEqual({ screen: 'event', eventId: EVENT });
  });

  it('sends a group event to the group, not the event', () => {
    // The event did not exist when this device last looked, so nothing here
    // holds a link token for it — and the native client presents one for
    // everything it does with an event. The group lists its events with
    // theirs, so that is the only place the tap can usefully land.
    expect(
      notificationTarget({
        kind: 'group_event',
        groupId: GROUP,
        eventId: EVENT,
        eventName: 'Dinner',
        groupName: 'Sunday roast',
      }),
    ).toEqual({ screen: 'group', groupId: GROUP });
  });
});

describe('payloads it should not act on', () => {
  it('ignores a kind this build does not know', () => {
    // The server can be newer than the installed app. An unknown notification
    // should open the app and stop, not navigate somewhere arbitrary.
    expect(notificationTarget({ kind: 'digest', eventId: EVENT })).toBeNull();
  });

  it('ignores a known kind with its target missing', () => {
    expect(notificationTarget({ kind: 'nudge' })).toBeNull();
    expect(notificationTarget({ kind: 'group_event', eventId: EVENT })).toBeNull();
  });

  it('ignores nothing at all', () => {
    expect(notificationTarget(null)).toBeNull();
    expect(notificationTarget(undefined)).toBeNull();
    expect(notificationTarget({})).toBeNull();
  });

  it('ignores a target that is not a string', () => {
    // Expo's data payload is string-valued, so anything else did not come
    // from `toMessage` and should not be trusted to be an id.
    expect(notificationTarget({ kind: 'nudge', eventId: 42 })).toBeNull();
    expect(notificationTarget({ kind: 'nudge', eventId: { id: EVENT } })).toBeNull();
  });
});

describe('against the payload the server actually sends', () => {
  it('reads every kind @parea/push can produce', async () => {
    // The union is closed at the source; this asserts the client covers all
    // of it, so adding a fourth notification fails here rather than shipping
    // as one that does nothing when tapped.
    const push = await import('node:fs/promises').then((fs) =>
      fs.readFile(
        new URL('../../../packages/push/src/index.ts', import.meta.url).pathname,
        'utf8',
      ),
    );
    const kinds = [...push.matchAll(/\{ kind: '(\w+)'/g)].map((m) => m[1]);
    // Not a fixed number. Pinned to 3, this failed when a fourth kind was
    // added — correctly, but for the wrong reason: it reported a count that
    // had changed rather than a kind the client could not route, and the fix
    // it invited was editing the number. The loop below is the real property,
    // and this only guards the regex having matched anything at all.
    expect(kinds.length).toBeGreaterThan(0);

    const client = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../src/notifications.ts', import.meta.url).pathname, 'utf8'),
    );
    for (const kind of kinds) {
      expect(client, kind).toContain(`'${kind}'`);
    }
  });
});
