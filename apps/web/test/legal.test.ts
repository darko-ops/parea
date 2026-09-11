/**
 * The legal pages describe the product that exists.
 *
 * A privacy policy is a dated, public, written statement about what happens to
 * other people's photographs. The normal way it goes wrong is not that it was
 * written carelessly — it is that it was written accurately and then the code
 * moved. Every number on that page came from a constant somewhere, and none of
 * them announce themselves when they change.
 *
 * This is the same rot that took the deriver's Dockerfile, the purge job's
 * derivative keys and the three environment lists, and it is worse here: those
 * failed loudly once someone noticed, and a stale retention period fails by
 * being read and believed.
 *
 * So the numbers are asserted against the constants they were copied from, and
 * the closed list of collected facts is asserted against the schema enum it
 * describes. What cannot be asserted is whether the prose is *good* — that is
 * for a lawyer, and the pages have not had one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { PRESERVATION_DAYS, REMOVAL_REQUEST_GRACE_HOURS, schema } from '@parea/core';
import { NOTIFICATION_KINDS } from '@parea/push';
import { getTableColumns, getTableName, isTable } from 'drizzle-orm';

import { CODE_TTL_MS } from '../src/accounts';
import { describeConfig } from '../src/env';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const PRIVACY = read('../app/privacy/page.tsx');
const TERMS = read('../app/terms/page.tsx');
const FOOTER = read('../app/components/SiteFooter.tsx');

/**
 * The privacy page as prose, with JSX's line wrapping collapsed.
 *
 * Matching sentences against the raw file makes every assertion depend on
 * where the formatter happened to break a line, which is a property of nobody's
 * intent. Tag-shaped patterns still use the raw source.
 */
const PROSE = PRIVACY.replace(/\s+/g, ' ');

describe('the retention periods are the real ones', () => {
  it('states the preservation period from the statute constant', () => {
    // 18 U.S.C. §2258A(h). If this ever moves, the page has to move with it.
    expect(PRESERVATION_DAYS).toBe(90);
    expect(PRIVACY).toContain(`${PRESERVATION_DAYS} days`);
  });

  it('states the deletion grace window from the purge job', () => {
    const source = read('../../../services/deriver/src/jobs.ts');
    const grace = Number(source.match(/PURGE_GRACE_DAYS\s*=\s*(\d+)/)?.[1]);
    expect(grace).toBeGreaterThan(0);

    // The gap between "deleted" and "gone", which is the one number on the
    // page a person might actually rely on.
    expect(PRIVACY).toContain(`${grace} days later`);

    // And the claim next to it. The first draft said this window was for
    // undoing an accidental deletion; nothing in the codebase clears
    // `deleted_at`, so that was a feature promised in a legal document and
    // never built. Asserted so it cannot come back.
    expect(PRIVACY).toMatch(/no way to undo a deletion/);
  });

  it('states the sign-in code lifetime', () => {
    expect(CODE_TTL_MS).toBe(10 * 60_000);
    expect(PRIVACY).toMatch(/[Tt]en minutes/);
  });

  it('states the removal-request grace period on both pages', () => {
    expect(REMOVAL_REQUEST_GRACE_HOURS).toBe(48);
    for (const page of [PRIVACY, TERMS]) {
      expect(page).toContain(`${REMOVAL_REQUEST_GRACE_HOURS} hours`);
    }
  });
});

describe('the closed list of what is collected', () => {
  it('matches the observation kinds the schema allows', () => {
    // The page calls this "five facts" and "a closed list". Adding a sixth
    // kind without touching the page turns that sentence into a false
    // statement about surveillance, which is the sentence people read most
    // carefully.
    const kinds = schema.observations.kind.enumValues;
    expect(kinds).toHaveLength(5);
    expect(PRIVACY).toMatch(/[Ff]ive facts/);
  });

  it('describes the notifications this product actually sends', () => {
    /*
     * All three descriptions were wrong, and had been since they were written.
     * The page said "someone added photos to your event" (the reminder fires
     * when nobody has), "someone asked to join your group" (there is no such
     * notification; the one that exists is a new *event* in a group) and
     * "someone asked for a photo of them to be removed" — which named the
     * wrong recipient: what is sent is the host's *answer*, and it goes to the
     * person who asked, not to the host.
     *
     * That last one is a statement in a published privacy policy about who
     * gets told what, which is the sort of thing people read and believe.
     * Found by going looking for the notification flow, not by any test.
     *
     * Counted against the union rather than the word "three", so a fourth kind
     * fails here instead of quietly making the sentence wrong again.
     */
    expect(NOTIFICATION_KINDS).toHaveLength(8);
    expect(PRIVACY).toMatch(/eight\s+notifications/);

    // One phrase per kind, each distinguishing it from the others. The fourth
    // arrived after this test did, and the test is what made the page follow.
    expect(PRIVACY, 'nudge').toMatch(/have not added anything to/);
    expect(PRIVACY, 'group_event').toMatch(/new event in a group/);
    expect(PRIVACY, 'removal_answered').toMatch(/answer when you have asked/);
    expect(PRIVACY, 'access_requested').toMatch(/somebody is asking to come into a private/);
    expect(PROSE, 'friend_requested').toMatch(/somebody wants to be friends/);
    expect(PROSE, 'event_invited').toMatch(/somebody has asked you into an event/);
    expect(PROSE, 'group_invited').toMatch(/somebody has asked you into a group/);
    // Distinguished from the one above by the verb, which is the whole
    // difference: one waits for an answer and this one does not.
    expect(PRIVACY, 'group_added').toMatch(/put you in a group they made/);
  });

  it('discloses everything an account row holds about a person', () => {
    /*
     * The page said an account "holds an email address and nothing else" long
     * after it had grown a handle, a display name and a profile picture — a
     * photograph of somebody's face, stored, and absent from the document that
     * exists to list what is stored. Nobody noticed because the assertions
     * above check the strings that were there, not the columns that were not.
     *
     * So this is checked the way the "five facts" claim is: against the schema.
     * Every column on `actor` is either bookkeeping, and named here as such, or
     * it is something about a person and the page has to say so. Adding a
     * column fails this test until somebody decides which it is.
     */
    const BOOKKEEPING = new Set([
      'id',
      'kind',
      'account_id',
      'merged_into_id',
      'created_at',
      // When you last opened Invites. About your use of one screen, and it
      // says nothing about you that the participant rows do not already.
      'invites_seen_at',
    ]);

    const DISCLOSED: Record<string, RegExp> = {
      display_name: /display name/i,
      bio: /<h3>A line about you/,
      handle: /<h3>A handle<\/h3>/,
      avatar_key: /<h3>A profile picture/,
      // Two columns, one promise, and the promise is the unusual half: the
      // number is not kept, so the page has to say what is — and has to be
      // straight about the number being *sent* in order to be matched.
      phone_hash: /scrambled form of it/,
      phone_last2: /last two digits/,
    };

    // `getTableColumns` rather than `Object.values`, which also hands back
    // drizzle's own helpers — `enableRLS` arrived as a "column" nobody could
    // classify.
    const columns = Object.values(getTableColumns(schema.actors)).map((c) => c.name);
    expect(columns.length, 'read no columns off the schema').toBeGreaterThan(5);

    for (const column of columns) {
      if (BOOKKEEPING.has(column)) continue;
      const pattern = DISCLOSED[column];
      expect(pattern, `${column} is neither bookkeeping nor disclosed`).toBeTruthy();
      expect(PRIVACY, `${column} is not described on the privacy page`).toMatch(pattern!);
    }
  });

  it('accounts for every table that holds something about a person', () => {
    /*
     * The column check above was the right idea one table too narrow. The same
     * drift was sitting in `event_access_request` — a row naming who asked to
     * get into whose event, added by me, never mentioned — and in `block`,
     * `group_member` and `report`, which predate all of it.
     *
     * Classified per table rather than per column, because "does this hold
     * something about a person" is a question about the table and asking it 90
     * times gives 90 chances to answer carelessly. A table missing from this
     * map fails, so the next one added has to be thought about; the schema is
     * the source of the list, so it cannot be quietly kept short.
     */
    const INTERNAL = new Set([
      'code', // spoken phrases, allocated from a pool. About events, not people.
      'rate_limit', // a keyed hash and a counter, deleted within the hour.
      'derivative', // resized copies of a photo already accounted for.
      'groups', // a name and a slug; who is in it is `group_member`.
      'moderation_flag', // a classifier's opinion of a photo.
    ]);

    const DISCLOSED: Record<string, RegExp> = {
      account: /email address, only if you ask for an account/,
      sign_in_code: /[Tt]en minutes/,
      actor: /identifier for your device/i,
      device: /notification token/i,
      photo: /Photos and videos you upload/,
      observation: /[Ff]ive facts/,
      event: /That you made an event/,
      event_participant: /records that you are in that event/,
      event_access_request: /asked to join a private event/,
      group_member: /events and groups you are in/i,
      group_join_request: /asked to join a private event or a group/,
      report: /asked for a photo of you to be taken down/,
      block: /blocked somebody/,
      // Kept because the law requires it, and described at length in its own
      // section rather than in the list of ordinary collection.
      safety_incident: /Child safety scanning/,
      moderation_action: /Child safety scanning/,
      friend_request: /asked somebody to be your friend, what they said/,
      friendship: /who is on your list/,
      event_invite: /somebody invited you into an event/,
      group_invite: /invited you into an event, or\s+into a group/,
      event_message: /anything you post in it/,
      message_reaction: /reactions you leave on other people/,
      group_message: /what you say in a group is kept with that\s+group/,
      // One time per thread per person, and never shown to anybody else.
      event_thread_read: /the moment you last read it/,
      group_thread_read: /the moment you last read it/,
      hidden_activity: /identifier of that line and nothing/,
    };

    // `isTable` rather than duck-typing on a property: the first attempt
    // guessed at `enableRLS` and matched nothing, which passed the loop and
    // would have reported on an empty list had the count below not caught it.
    const tables = Object.values(schema)
      .filter((v) => isTable(v as never))
      .map((v) => getTableName(v as never));
    expect(tables.length, 'read no tables off the schema').toBeGreaterThan(15);

    for (const table of tables) {
      if (INTERNAL.has(table)) continue;
      const pattern = DISCLOSED[table];
      expect(pattern, `${table} is neither internal nor disclosed`).toBeTruthy();
      expect(PROSE, `${table} is not described on the privacy page`).toMatch(pattern!);
    }
  });

  it('does not claim that opening a link records nothing', () => {
    // It did, and that stopped being true the day `/e/<token>` started
    // recording who came in — which it has to, because `joins_open` cannot
    // mean anything without knowing who was already there. The sentence was
    // written for an earlier design and outlived it by one commit of mine.
    // Pinned to the sentence that was wrong, not to the words in it: the page
    // still says, truthfully, that visiting without opening an event records
    // nothing, and a looser pattern failed on that.
    expect(PRIVACY).not.toMatch(/Browsing an event[^.]*creates no record/);
    expect(PRIVACY).toMatch(/records that you are in that event/);
  });

  it('names every third party that handles data', () => {
    // Not a hand-kept list checked against another hand-kept list: these are
    // the services the deployment is actually wired to, and a subprocessor
    // nobody disclosed is the failure that matters.
    for (const party of ['Cloudflare', 'Neon', 'Vercel', 'Fly.io', 'Resend', 'Expo']) {
      expect(PRIVACY, party).toContain(party);
    }
  });

  it('discloses the window where an unstripped original exists', () => {
    // The uncomfortable one, and the reason the App Store nutrition-label
    // question about precise location is genuinely open. A policy that
    // omitted it would be describing the design rather than the deployment.
    expect(PRIVACY).toMatch(/untouched original is in storage/);
  });
});

describe('App Store Guideline 1.2', () => {
  it('states zero tolerance for both the content and the users', () => {
    // The literal thing review looks for in a UGC app's EULA. "Objectionable
    // content" alone is half of it; abusive *users* is the other half.
    expect(TERMS).toMatch(/zero tolerance/i);
    expect(TERMS).toMatch(/objectionable content/i);
    expect(TERMS).toMatch(/abusive\s+users/i);
  });

  it('names the four mechanisms that back it up', () => {
    // Filtering, reporting with a timely response, blocking, and published
    // contact. All four are built; the terms are where they are promised.
    expect(TERMS).toMatch(/24 hours/);
    expect(TERMS).toMatch(/[Bb]lock/);
    expect(TERMS).toMatch(/report/i);
    expect(TERMS).toContain('/safety');
  });

  it('sets a minimum age', () => {
    // A user-generated-content app does not get to claim 4+, and COPPA is
    // why the floor is 13 rather than nothing.
    expect(TERMS).toMatch(/at least 13/);
  });

  it('warns that a download outlives a deletion', () => {
    // The one promise the product cannot keep, said out loud rather than
    // discovered. Bulk download at full quality is the entire point, so this
    // is a property of the design and not a caveat.
    expect(TERMS).toMatch(/cannot reach into a download/);
  });
});

describe('the pages are reachable', () => {
  it('is indexable, unlike everything behind a link', () => {
    // The inverse of noindex.test.ts. Review has to find these without a
    // link, and so does anyone deciding whether to upload.
    for (const page of [PRIVACY, TERMS]) {
      expect(page).not.toMatch(/robots:\s*\{\s*index:\s*false/);
    }
  });

  it('links each to the other and to safety', () => {
    // The links moved into the shared footer, so the property is now two
    // halves: each page renders the footer, and the footer carries the links.
    // Checked as two halves rather than relaxed to one, because "the page
    // mentions SiteFooter" on its own would pass a footer that had quietly
    // lost the reporting link.
    for (const page of [PRIVACY, TERMS]) expect(page).toContain('<SiteFooter />');
    for (const path of ['/safety', '/privacy', '/terms']) {
      expect(FOOTER).toContain(path);
    }
  });

  it('puts the footer on every page a person can reach', () => {
    // Guideline 1.2 wants contact details published, and the only version of
    // that which works is "on whichever page they are on when they need it".
    for (const path of [
      '../app/page.tsx',
      '../app/privacy/page.tsx',
      '../app/terms/page.tsx',
      '../app/components/EventView.tsx',
      '../app/components/GroupView.tsx',
      '../app/components/AccountView.tsx',
      '../app/components/LoginScreen.tsx',
    ]) {
      expect(read(path), `${path} has no footer`).toContain('<SiteFooter />');
    }
  });
});

describe('who is making the promise', () => {
  it('is a deployment fact, not a literal', () => {
    // A published legal document confidently wrong about who wrote it is
    // worse than one that is visibly unfinished, so the fallback is a
    // placeholder and the health check reports it missing.
    const required = describeConfig().filter((c) => c.requiredInProduction).map((c) => c.name);
    expect(required).toContain('LEGAL_ENTITY');
    expect(required).toContain('LEGAL_JURISDICTION');
  });

  it('is not hard-coded into either page', () => {
    for (const page of [PRIVACY, TERMS]) {
      expect(page).toContain('LEGAL_ENTITY');
      expect(page).not.toMatch(/Ltd|LLC|Inc\./);
    }
  });
});

describe('what showing a name beside a photograph discloses', () => {
  /*
   * The contributor filter is the first thing in the product that puts names
   * next to photographs for everybody holding an event's link. Before it, the
   * event page said "214 photos from 6 people" and named none of them, and the
   * privacy page's account of where a name is shown was a single audience: a
   * host deciding whether to let somebody into a private event.
   *
   * That sentence did not become false on its own. It became false because a
   * feature was built, which is exactly how the notification list and the
   * account-contents list went wrong twice before — the page was accurate when
   * it was written and nothing tied it to the thing it described.
   *
   * So this ties the two together in the only direction that matters: while
   * the client draws contributors, the page must say that it does.
   */
  const EVENT_VIEW = read(
    fileURLToPath(new URL('../app/components/EventView.tsx', import.meta.url)),
  );

  it('says so, for as long as the event page names contributors', () => {
    const namesThem = /people\.map\(|feed\.people/.test(EVENT_VIEW);
    expect(namesThem, 'the event page no longer names contributors').toBe(true);

    expect(PROSE, 'the page does not say who can see your name').toMatch(
      /everyone who can see that event can see that they are yours/,
    );
  });

  it('keeps the distinction between looking and adding', () => {
    // Looking at an event must not put somebody in the list, and the page has
    // to keep saying which of the two does — "who was there" and "who added
    // photographs" are different sets, and only one of them is published.
    expect(PROSE).toMatch(/Looking at an event does not put you in that list/);
  });
});
