/**
 * Keeping a photograph: a shortlist of an album, private to whoever made it.
 *
 * An album of two hundred has maybe six pictures somebody would actually come
 * back for. This is those — a second page of the same grid over a different
 * set, and a star in the viewer that puts a picture in it.
 *
 * The privacy is the design, not a setting on it. Nobody is told what you
 * kept, no count of it appears anywhere, and the person who added the
 * photograph cannot see that you did — which is why it is a table of its own
 * rather than a reserved emoji in `photo_reaction`, where every read is a
 * read of what other people did.
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
const API = read('src/api.ts');
const VIEWER = read('src/PhotoViewer.tsx');
const GLYPH = read('src/Glyph.tsx');
const SCHEMA = read('../../packages/core/src/schema.ts');
const ROUTE = read('../../apps/web/app/api/photos/[id]/favourite/route.ts');
const FEED = read('../../apps/web/app/api/events/[id]/photos/route.ts');

describe('what the server keeps', () => {
  it('is a table of its own, not a reaction wearing a star', () => {
    /*
     * Every read of `photo_reaction` is a read of what other people did. A
     * private row living in it would be one `select` away from being
     * published by a route that had every reason to think it was listing
     * reactions.
     */
    expect(SCHEMA).toMatch(/pgTable\(\s*'photo_favourite'/);
    // One kind of keeping, so no emoji column to say which.
    const table = SCHEMA.slice(SCHEMA.indexOf("'photo_favourite'"));
    expect(table.slice(0, table.indexOf(');'))).not.toMatch(/emoji/);
  });

  it('answers for the viewer and for nobody else', () => {
    expect(FEED).toMatch(/eq\(schema\.photoFavourites\.actorId, viewerId\)/);
    expect(FEED).toMatch(/favourite: keptIds\.has\(photo\.id\)/);
  });

  it('needs only the right to look, not the right to contribute', () => {
    /*
     * Reacting is addressed to everybody in the album. Keeping is addressed
     * to nobody, so somebody who may read an album may shortlist it —
     * requiring more would mean a reader could not.
     */
    expect(ROUTE).toMatch(/guard\(found\.db, found\.event, 'view', requester\)/);
  });

  it('needs an account, because a shortlist has to outlive the phone', () => {
    // A guest actor is a credential in one keychain; a shortlist that cannot
    // survive a new phone is one that quietly empties.
    expect(ROUTE).toMatch(/currentAccountActorId\(\)/);
    expect(ROUTE).toMatch(/sign_in_required/);
  });

  it('is idempotent, because the client is a toggle and a toggle retries', () => {
    // A press that times out and is sent again must not undo itself.
    expect(ROUTE).toMatch(/onConflictDoNothing\(\)/);
    expect(API).toMatch(/method: on \? 'PUT' : 'DELETE'/);
  });

  it('moves with a merge and is disclosed', () => {
    // Both guarded by their own suites in `apps/web`; named here because this
    // is the file somebody reads when they add the next per-person table.
    const MERGE = read('../../apps/web/src/merge.ts');
    expect(MERGE).toMatch(/table: 'photo_favourite'/);
    const PRIVACY = read('../../apps/web/app/privacy/page.tsx');
    expect(PRIVACY).toMatch(/shortlist of an album that is/);
  });
});

describe('the star', () => {
  it('reports a state rather than naming an action', () => {
    // The one glyph in a family of strokes that is also drawn filled.
    expect(GLYPH).toMatch(/case 'star':/);
    expect(GLYPH).toMatch(/fill=\{filled \? color : 'none'\}/);
    expect(VIEWER).toMatch(/filled=\{photo\.favourite\}/);
  });

  it('sits in the chrome, not on the photograph', () => {
    // A control on the image is a mark on somebody's photograph.
    expect(VIEWER).toMatch(/<View style=\{styles\.tools\}>/);
    expect(VIEWER).toMatch(/tools: \{ flexDirection: 'row', gap: 10 \}/);
  });

  it('asks for the state it wants, not for the opposite of what it sees', () => {
    expect(VIEWER).toMatch(/onFavourite\(photo\.id, !photo\.favourite\)/);
    expect(APP).toMatch(/api\s*\.setFavourite\(photoId, on\)/);
  });
});

describe('the second shelf', () => {
  it('is the same grid over a different set', () => {
    expect(APP).toMatch(/data=\{kept\}/);
    expect(APP).toMatch(/\['kept', 'star', 'Kept'\]/);
    expect(APP).toMatch(/\['all', 'grid', 'All photos'\]/);
  });

  it('opens on everything, because nobody arrives to read their own shortlist', () => {
    expect(APP).toMatch(/useState<'all' \| 'kept'>\('all'\)/);
    // And the grid is the left-hand page, so the control's order is the
    // pager's order.
    const pager = APP.slice(APP.indexOf('ref={shelves}'));
    expect(pager.indexOf('data={feed?.photos ?? []}')).toBeLessThan(pager.indexOf('data={kept}'));
  });

  it('says what an empty shortlist is, which is not an empty album', () => {
    expect(APP).toMatch(/Nothing kept yet\./);
    // And that nobody else is looking at it.
    expect(APP).toMatch(/Only you see this\./);
  });
});

describe('which ones were kept, on the contact sheet', () => {
  it('marks a kept tile, in the corner the byline is not in', () => {
    /*
     * A tile already carries who added it, bottom-left. This is the other
     * question somebody scanning two hundred asks — which of these did I keep
     * — and the two are in different corners so they never meet.
     */
    expect(APP).toMatch(/\{item\.favourite && \(/);
    expect(APP).toMatch(/<Glyph name="star" size=\{13\} color="#fff" filled \/>/);
    expect(APP).toMatch(/gridKept: \{\s*position: 'absolute',\s*top: 6,\s*right: 6,/);
  });

  it('carries its own contrast, because it lies on a photograph', () => {
    // White with a shadow rather than a chip: furniture behind a 13pt glyph
    // on a 129pt tile is more of the tile than the glyph.
    const kept = APP.slice(APP.indexOf('gridKept: {'));
    expect(kept.slice(0, kept.indexOf('},'))).toMatch(/shadowColor: '#000'/);
  });

  it('is not a control, for the reason the face beside it is not', () => {
    // A 16pt target inside a 129pt tile is a place the tile stops opening the
    // photograph for no reason a thumb can predict.
    expect(APP).toMatch(/\{item\.favourite && \(\s*<View pointerEvents="none" style=\{styles\.gridKept\}>/);
  });
});
