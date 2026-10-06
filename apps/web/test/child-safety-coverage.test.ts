/**
 * Every kind of image goes past the child-safety check before it is stored,
 * and the pages that describe the check say what is actually running.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { hashMatchingLive } from '../src/legal';

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const ROUTES = {
  moment: read('../app/api/moments/route.ts'),
  group_photo: read('../app/api/groups/[id]/photo/route.ts'),
  avatar: read('../app/api/account/avatar/route.ts'),
  cover: read('../app/api/events/[id]/cover/route.ts'),
};
const SAFETY = read('../src/safety.ts');
const COMPLETE = read('../app/api/uploads/[id]/complete/route.ts');
const PRIVACY = read('../app/privacy/page.tsx');
const TERMS = read('../app/terms/page.tsx');

describe('the images the web app stores itself', () => {
  for (const [kind, source] of Object.entries(ROUTES)) {
    it(`checks a ${kind} before it is decoded or stored`, () => {
      const screened = source.indexOf('await screenUpload(');
      expect(screened, 'calls screenUpload').toBeGreaterThan(-1);
      expect(source.slice(screened, screened + 200)).toContain(`kind: '${kind}'`);
      // After the file is admitted, and before anything is decoded or written.
      expect(screened).toBeGreaterThan(source.indexOf('admit('));
      expect(screened).toBeLessThan(source.indexOf('decode(', source.indexOf('admit(')));
      expect(screened).toBeLessThan(source.indexOf('putSmall('));
      expect(source).toMatch(/if \(refused\) return refused;/);
    });
  }

  it('passes with no provider, refuses on an outage, and keeps a match out of sight', () => {
    expect(SAFETY).toMatch(/const scanner = scannerFromEnv\(\);\s*if \(!scanner\) return null;/);
    expect(SAFETY).toMatch(/err instanceof ScanUnavailable[\s\S]{0,200}status: 503/);
    expect(SAFETY).toMatch(/const storageKey = `preserved\/\$\{subject\.kind\}\/\$\{randomUUID\(\)\}`;/);
    expect(SAFETY).toMatch(/insert\(schema\.safetyIncidents\)/);
    expect(SAFETY).toMatch(/await alertResponder\(/);
  });
});

describe('completing an upload', () => {
  it('only queues a photo that is still pending', () => {
    // A quarantined photo could otherwise be overwritten and sent round again.
    expect(COMPLETE).toMatch(/if \(photo\.status !== 'pending' \|\| photo\.deletedAt \|\| photo\.hiddenAt\)/);
    expect(COMPLETE.indexOf("error: 'not_pending'")).toBeLessThan(COMPLETE.indexOf('publishDerive('));
  });
});

describe('what the privacy page and terms promise', () => {
  it('reads the posture from the same settings the scanner reads', () => {
    expect(hashMatchingLive({})).toBe(false);
    expect(hashMatchingLive({ CSAM_SCANNER_URL: 'https://x.test' })).toBe(false);
    expect(hashMatchingLive({ CSAM_SCANNER_URL: 'https://x.test', CSAM_SCANNER_KEY: 'k' })).toBe(true);
    // PhotoDNA knows its own endpoint, so its key alone turns matching on.
    expect(hashMatchingLive({ CSAM_SCANNER_PROVIDER: 'photodna' })).toBe(false);
    expect(hashMatchingLive({ CSAM_SCANNER_PROVIDER: 'photodna', CSAM_SCANNER_KEY: 'k' })).toBe(true);
  });

  it('only says every image is checked when it is', () => {
    expect(PRIVACY).toMatch(/\{hashMatchingLive\(\) \? \(/);
    expect(PRIVACY).toMatch(/Automatic matching against known child sexual abuse material is\s+not running yet/);
    expect(TERMS).toMatch(/hashMatchingLive\(\)\s*\? 'Every image is checked/);
  });
});
