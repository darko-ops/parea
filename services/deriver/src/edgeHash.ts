/**
 * PhotoDNA Edge Hashes, made here — what is sent to Microsoft instead of the
 * photograph. See `PhotoDnaHashScanner` in @parea/core and
 * docs/csam-runbook.md ("PhotoDNA: Edge Hashes, not images").
 *
 * The hashing is Microsoft's: `photoDnaEdgeHashS.js`, the WebAssembly build
 * from the PhotoDNA Edge Hash SDK, loaded from the folder
 * `PHOTODNA_EDGEHASHGENERATOR` names. It is not in git — the SDK's licence and
 * its notice on AI agents keep the library out of the repository and out of
 * any agent's reach — so the file is copied into `vendor/photodna/` by hand
 * before a deploy, and the Dockerfile carries it into the image. Unset, there
 * is no hasher, and PhotoDNA is asked with the image as before.
 *
 * Loaded the way Microsoft's Node sample loads it: run in this context with
 * the one browser global it reads stubbed, then waited for until its
 * `pdnaHash` export exists, which is when the WebAssembly has initialised.
 *
 * What it hashes is the scan rendition the pipeline already makes — a JPEG
 * within PhotoDNA's limits, the same bytes `/Match` was sent — decoded to RGB,
 * three bytes a pixel, which is the layout the library takes. Of the hashes it
 * returns, the last: the one with any border removed, as the sample does.
 */

import type { EdgeHasher, ScanInput } from '@parea/core';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';

export const EDGE_HASH_SCRIPT = 'photoDnaEdgeHashS.js';
/** The library's "Image is flat": no features to fingerprint. See `EdgeHasher` in @parea/core. */
export const FLAT_IMAGE = -7009;
/** How long the WebAssembly may take to initialise before the hasher gives up. */
const READY_TIMEOUT_MS = 10_000;

/**
 * The library's entry point, as its Node sample calls it. It answers with a
 * promise — the sample only gets away with not saying so because it calls it
 * inside a `.then` — so it is always awaited here.
 */
export type GenerateEdgeHashes = (
  pixels: Buffer,
  width: number,
  height: number,
  layout: 'RGB' | 'RGBA',
) => unknown;

/**
 * One load per script per process. The script declares its names at the top
 * level, so running it a second time in the same context throws
 * ("Identifier 'pdnaMaxHashes' has already been declared") — which is what
 * the first production scan met, the boot probe having loaded it already
 * through a hasher of its own. Every hasher shares the one load.
 */
const loads = new Map<string, Promise<GenerateEdgeHashes>>();

/** Runs Microsoft's script once and resolves with its hashing function once it is ready. */
export function loadEdgeHashScript(scriptPath: string): Promise<GenerateEdgeHashes> {
  let load = loads.get(scriptPath);
  if (!load) {
    load = runEdgeHashScript(scriptPath);
    // A failed load is not kept, so the next scan tries again.
    load.catch(() => loads.delete(scriptPath));
    loads.set(scriptPath, load);
  }
  return load;
}

function runEdgeHashScript(scriptPath: string): Promise<GenerateEdgeHashes> {
  const g = globalThis as Record<string, unknown>;
  g.document ??= { currentScript: { src: scriptPath } };
  try {
    vm.runInThisContext(readFileSync(scriptPath, 'utf8'), { filename: scriptPath });
  } catch (err) {
    return Promise.reject(err);
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const generate = g.PhotoDnaEdgeHashV2FromImageData;
      if (typeof g.pdnaHash === 'function' && typeof generate === 'function') {
        resolve(generate as GenerateEdgeHashes);
      } else if (Date.now() - started > READY_TIMEOUT_MS) {
        reject(new Error(`${EDGE_HASH_SCRIPT} did not initialise within ${READY_TIMEOUT_MS}ms`));
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

/**
 * Whatever the library threw, as words. It does not always throw an `Error`:
 * a refusal can arrive as a number, a string, an object or nothing at all, and
 * `err.message` on those printed "undefined", which said nothing.
 */
export function describe(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (err === undefined) return 'the library rejected with no reason';
  if (typeof err === 'object' && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** The base64 Edge Hash out of what the library returned, or why there is none. */
export function lastEdgeHash(result: unknown): string {
  const r = result as { count?: unknown; data?: unknown } | null;
  const count = typeof r?.count === 'number' ? r.count : 0;
  const data = Array.isArray(r?.data) ? r.data : [];
  if (count < 1 || data.length < count) throw new Error(`no edge hash (count ${String(r?.count)})`);
  const hash = (data[count - 1] as { PhotoDna?: unknown } | undefined)?.PhotoDna;
  if (typeof hash !== 'string' || hash === '') throw new Error('edge hash entry had no PhotoDna value');
  return hash;
}

export class SdkEdgeHasher implements EdgeHasher {
  private generate: Promise<GenerateEdgeHashes> | null = null;

  constructor(private readonly load: () => Promise<GenerateEdgeHashes>) {}

  /** Loads the library on first use, and again after a failed load rather than never. */
  private ready(): Promise<GenerateEdgeHashes> {
    this.generate ??= this.load().catch((err) => {
      this.generate = null;
      throw err;
    });
    return this.generate;
  }

  async hash(input: ScanInput): Promise<string | null> {
    const generate = await this.ready();
    const { data, info } = await sharp(input.bytes, { failOn: 'error' })
      .toColorspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error(`expected RGB, decoded ${info.channels} channels`);
    let result: unknown;
    try {
      result = await generate(data, info.width, info.height, 'RGB');
    } catch (err) {
      // Only this code, matched exactly: any other refusal is a failure.
      if ((err as { result?: unknown } | null)?.result === FLAT_IMAGE) return null;
      throw new Error(`PhotoDNA could not hash this image: ${describe(err)}`);
    }
    return lastEdgeHash(result);
  }
}

/**
 * The hasher, when `PHOTODNA_EDGEHASHGENERATOR` names a folder holding the
 * library; null when it is unset. Set but missing the file is an error rather
 * than a quiet fall-back to sending images: somebody meant to switch.
 */
export function edgeHasherFromEnv(env: NodeJS.ProcessEnv = process.env): EdgeHasher | null {
  const dir = env.PHOTODNA_EDGEHASHGENERATOR?.trim();
  if (!dir) return null;
  const script = join(dir, EDGE_HASH_SCRIPT);
  if (!existsSync(script)) {
    throw new Error(`PHOTODNA_EDGEHASHGENERATOR is ${dir}, which has no ${EDGE_HASH_SCRIPT}`);
  }
  return new SdkEdgeHasher(() => loadEdgeHashScript(script));
}
