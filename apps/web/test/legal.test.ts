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

import { CODE_TTL_MS } from '../src/accounts';
import { describeConfig } from '../src/env';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const PRIVACY = read('../app/privacy/page.tsx');
const TERMS = read('../app/terms/page.tsx');
const FOOTER = read('../app/components/SiteFooter.tsx');

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
    expect(NOTIFICATION_KINDS).toHaveLength(3);
    expect(PRIVACY).toMatch(/three\s+notifications/);

    // One phrase per kind, each distinguishing it from the other two.
    expect(PRIVACY, 'nudge').toMatch(/have not added anything to/);
    expect(PRIVACY, 'group_event').toMatch(/new event in a group/);
    expect(PRIVACY, 'removal_answered').toMatch(/answer when you have asked/);
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
