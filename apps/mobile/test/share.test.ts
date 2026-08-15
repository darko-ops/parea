/**
 * Sending the link from inside an album.
 *
 * It was not possible: the link appeared once, on the screen that made the
 * album, and after that the only way to get it in front of somebody was to
 * make another album. Everything else about an album is reachable from the
 * album; this was the exception, and it is the one thing an album is for.
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

describe('sharing an album from the album', () => {
  it('hands it to the system sheet rather than drawing one', () => {
    // The sheet knows which group chat these people use, and picking somebody
    // in it tells this app nothing about who they are — which is why there is
    // no contact list of our own anywhere in this product.
    expect(screen).toMatch(/Share\.share\(\{ message: `\$\{webBase\}\/e\/\$\{event\.linkToken\}` \}\)/);
  });

  it('sends the link and nothing else', () => {
    /*
     * No name in the message body: a shared link unfurls into a card carrying
     * the album's title, so putting it in the text as well says it twice. And
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
