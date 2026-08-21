/**
 * Sending the link from inside an event.
 *
 * It was not possible: the link appeared once, on the screen that made the
 * event, and after that the only way to get it in front of somebody was to
 * make another event. Everything else about an event is reachable from the
 * event; this was the exception, and it is the one thing an event is for.
 *
 * Asserted against the source — the screen imports Expo modules at module
 * scope and needs a device, which is the boundary `api.test.ts` documents.
 * What is checked here is the two decisions, not the layout.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8');

const screen = app.slice(app.indexOf('function EventScreen('));

describe('sharing an event from the event', () => {
  it('hands it to the system sheet rather than drawing one', () => {
    // The sheet knows which group chat these people use, and picking somebody
    // in it tells this app nothing about who they are — which is why there is
    // no contact list of our own anywhere in this product.
    expect(screen).toMatch(/Share\.share\(\{ message: `\$\{webBase\}\/e\/\$\{event\.linkToken\}` \}\)/);
  });

  it('sends the link and nothing else', () => {
    /*
     * No name in the message body: a shared link unfurls into a card carrying
     * the event's title, so putting it in the text as well says it twice. And
     * no spoken phrase — that is the other door, for somebody in the room.
     */
    const call = screen.slice(screen.indexOf('Share.share('), screen.indexOf('Share.share(') + 200);
    expect(call).not.toMatch(/event\.name|code|phrase/);
  });

  it('takes the host it should link to rather than guessing one', () => {
    // A link built from the API base is a link that works wherever this build
    // points; one built from a constant is a link to production in a test app.
    expect(screen).toMatch(/webBase: string;/);
    expect(app).toMatch(/<EventScreen[\s\S]{0,200}webBase=\{API_BASE\}/);
  });
});

/**
 * And the screen that makes an event.
 *
 * The phrase used to be offered here behind a button, on the one screen whose
 * job is sending a link. Two doors shown as one act again, and this one had a
 * second problem coming: the server stopped minting a phrase unless an event
 * asks for one, so it was on its way to being a button that revealed nothing.
 */
describe('the create screen sends a link and offers nothing else', () => {
  const create = readFileSync(
    fileURLToPath(new URL('../src/CreateEvent.tsx', import.meta.url)),
    'utf8',
  );

  it('has no spoken phrase in it', () => {
    /*
     * Matched as rendered text — `>Say a code<` — rather than anywhere in the
     * file, because the paragraph above this describes the button that was
     * removed and would otherwise fail the test that removed it. The web side
     * has `stripComments` for this; there is no such helper here, and one
     * anchored regex is cheaper than importing one across a workspace.
     */
    expect(create).not.toMatch(/>\s*(Say a code|OR SAY IT OUT LOUD)\s*</);
    // The state it was revealed by, and the field it read.
    expect(create).not.toMatch(/showCode|made\.code/);
  });

  it('still sends the link itself', () => {
    // The removal is of a second option, not of the thing the screen is for.
    expect(create).toMatch(/Share\.share\(\{ message: made\.url \}\)/);
    expect(create).toMatch(/Send the link/);
  });
});
