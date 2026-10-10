#!/usr/bin/env tsx
/**
 * Checks the PhotoDNA Edge Hash path end to end, by hand, before it is
 * switched on — see docs/csam-runbook.md ("PhotoDNA: Edge Hashes, not images").
 *
 * Run by a person, never by an agent: it loads Microsoft's library, which the
 * SDK's notice on AI agents keeps out of an agent's reach.
 *
 *   PHOTODNA_EDGEHASHGENERATOR=<folder with photoDnaEdgeHashS.js> \
 *   PHOTODNA_KEY="$(pbpaste)" \
 *   npx tsx services/deriver/scripts/edgehash-check.ts <image or .base64> …
 *
 * For each image: the hash's length and how long it took. With PHOTODNA_KEY,
 * also each hash sent to /MatchHash, the service's raw answer, and how
 * `PhotoDnaHashScanner` reads it. Microsoft's sample images are in its "Test"
 * list, so they should come back as matches. With `--test-hash`, the approval
 * letter's quick-start hash is sent too, which needs no library at all.
 */

import { PhotoDnaHashScanner, PHOTODNA_HASH_ENDPOINT } from '@parea/core';
import { readFileSync } from 'node:fs';

import { edgeHasherFromEnv } from '../src/edgeHash';

const TEST_HASH =
  'UEROQQABAgAIT58oAAAAAAAAAADgAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAw4AAAAAAAAAAAAAxv8F/3Gc/1j2zEqsPFD/JND/VcwjHf8jT8wGs88EjrgcfYYRDP8HSYUrtrj/OLwhVoYjOz6ty/9m8f//MsaXsjnFI/+SK+JEB/8DTtQiGrJXOvEMXNEdI6go/wg/X1arzlw6cPAOYP8B/54D8iYAhCc4jvJiRnEeJ4YjLKoWuJZ0///UlGlfY+6Hwf8IiEUL7rQR2ZO5KmH2XP+GywqczXp+LhT0zyz/Y+2+UUo+761nf7X1xdAo0eD6+U3k9n3LD3Hzw/zxDOt+JFAz/vNhlSz3Ru8Bv8w2zgo6/+4ifLHipIWjk82qg4z48qv+68vrUzyWM/ufh40q+sb1vCPSy5ZYYvshtwG/+S9ZCRTmC5sl/f7zCoxb6hbVAaDgS01ASP8+gnbV4PpYAyXnX7b9iv6HKNwD5zGQ+irlGHX2evgHNW/6/ufmIEfWYmCTSP832BMO/Z1vnCPs0psZHft7LxZb7njklCrqO+Yi9tEFJPyT+v7aT+XrdJQVUvu1ILOD9vQarQvxuWlNaPtLpfPD+ApA+ErxzNdvae8LW2Ak9qLMU+nbrVCt+fNziGN540wXtjXahAZJxKBlFYDX+s+4pIvnuzrrSe+RHVxj7APBDK776bhXH+cisbj2+BOw2ZfDD1o8wfRHHXih/2MOyYraBNfgGfl9osJy+67EtejZnvbwMP+EAkW27bpWddLpS1uWmfed0V3e+ynR/C/pUsrAlPEGcs2v8mDBsiTkGku1PP3+zMyJ8qgRFrHrp/DJRPwzDF7T+uDoz7Tn8ftiTfpkFfwmva6Rd/r/QWWMCPowEcR27NruceT2wl4fzPJhgZ9M4iLEoOL102+jDfm0712f6eTEFA7p2sPEIv3JUxm78i1TR9vO5BRjiv+B2mkTxbfB9xnngvKSCP+qBqpa6IDzP57+Oj3s6//WI6Cb9FAHvvT8b4eMW/XJ0BCX7Ax+ZE7jZgjywuwJOrqs9oH6nJv1uBnkxvsbOtYH+gr8nkzwFf8Odvsbj6zy984VzLnq4iyhHP1OeUll8F6mWxbsY9MVUOuZIYug0eyR1pqG5dsbqN1KDpdx7x2ac/H0MeBDavJpSoM18SkWB7TlFWm+Sutwf1+C5Y4cQarleEWGqf8qzqxS7uRNKn73GWHi1P5zfvT4';

const args = process.argv.slice(2);
const key = process.env.PHOTODNA_KEY?.trim();
const images = args.filter((a) => !a.startsWith('--'));

async function ask(label: string, hash: string): Promise<void> {
  if (!key) return;
  // Raw first, so the answer's real shape is on record; then as the scanner reads it.
  const raw = await fetch(PHOTODNA_HASH_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Ocp-Apim-Subscription-Key': key },
    body: JSON.stringify([{ DataRepresentation: 'PreHashV2', Value: hash }]),
  });
  console.log(`${label}: HTTP ${raw.status} ${await raw.text()}`);
  const verdict = await new PhotoDnaHashScanner(key, { hash: async () => hash }).matchHash(hash).catch((e: Error) => `ScanUnavailable: ${e.message}`);
  console.log(`${label}: read as ${JSON.stringify(verdict)}`);
}

async function main(): Promise<void> {
  if (args.includes('--test-hash')) await ask('test hash', TEST_HASH);
  if (images.length === 0) return;
  const hasher = edgeHasherFromEnv();
  if (!hasher) throw new Error('set PHOTODNA_EDGEHASHGENERATOR to the folder holding photoDnaEdgeHashS.js');
  for (const path of images) {
    const file = readFileSync(path);
    const bytes = path.endsWith('.base64') ? Buffer.from(file.toString('utf8').trim(), 'base64') : file;
    const started = Date.now();
    const hash = await hasher.hash({ bytes, contentHash: Buffer.alloc(32), mime: 'image/jpeg' });
    console.log(`${path}: ${hash.length}-character hash in ${Date.now() - started}ms`);
    await ask(path, hash);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
