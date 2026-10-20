/**
 * The link card, drawn once and committed as `apps/web/public/og.png`.
 *
 *   npx tsx --tsconfig apps/web/tsconfig.json scripts/build-og.mts
 *
 * The drawing stays in `apps/web/app/api/og/route.tsx`, where `brand.test.ts`
 * checks it against the icon. This runs that route's GET outside the server and
 * keeps the bytes.
 *
 * Why not render per request, as the route was built to: `next/og` rasterises
 * through sharp whenever sharp is installed, and `@parea/upload`'s
 * `restrictDecoders` blocks sharp's SVG loader for the whole process — on
 * purpose, for uploads. So the card drew on a fresh instance and failed with
 * "Input buffer contains unsupported image format" on any instance that had
 * already handled a photo. iMessage got the 500 and fell back to the touch
 * icon. A file has nothing to fail, and its name ends in `.png`, so the
 * sign-in proxy lets it through.
 *
 * Rerun after changing the route or the icon.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GET } from '../apps/web/app/api/og/route.tsx';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'og.png');

const png = Buffer.from(await GET().arrayBuffer());
await writeFile(OUT, png);
console.log(`apps/web/public/og.png  ${png.length} bytes`);
