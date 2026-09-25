/**
 * Running a parser on bytes a stranger chose.
 *
 * Two binaries in this service are handed attacker-controlled input:
 * `exiftool`, which reads and rewrites metadata, and `heif-convert`, which
 * decodes HEVC HEIC because sharp's bundled libvips cannot. Both are C or Perl
 * parsers doing the hardest thing a program can do safely, and both were being
 * started with `execFile` defaults — which means the full environment of the
 * parent.
 *
 * The parent is the deriver. Its environment holds `R2_ACCESS_KEY_ID`,
 * `R2_SECRET_ACCESS_KEY`, `DATABASE_URL`, `QSTASH_TOKEN` and the child-safety
 * scanner's key. So a memory-corruption bug in an image parser did not merely
 * get code execution in a short-lived process — it got the credentials to the
 * photo store and the database, handed over at `spawn` time for no reason
 * anybody had chosen.
 *
 * ## This is not hypothetical for libheif
 *
 * Debian's security tracker lists CVE-2026-84444, CVE-2026-84446,
 * CVE-2026-84447 and CVE-2026-84448 as **vulnerable** in trixie's
 * `1.19.8-1+deb13u1`, including a heap buffer overflow. Upstream fixed them in
 * 1.23.2; trixie has no backport, and forky's 1.23.3 cannot be mixed into a
 * trixie base without dragging its toolchain along. sharp 0.35.4 carries a
 * patched libheif of its own, but that is the one libvips will not use for
 * HEVC — which is the entire reason `heif-convert` is installed.
 *
 * So the decoder stays vulnerable until Debian moves, and what can be changed
 * today is what a successful exploit is worth. An empty-handed parser is worth
 * a crash and a failed photograph.
 *
 * ## What is kept, and why each
 *
 * `PATH` because the binary has to be found, and a path is not a secret.
 * `HOME` because exiftool looks for `~/.ExifTool_config` and libheif's plugin
 * loader reads a search path; neither is sensitive, and omitting them trades a
 * real chance of breakage for nothing. `LANG` pinned to `C.UTF-8` so filename
 * and message handling does not vary with whatever the host happens to be set
 * to — the tests shell out to the same binaries, and a locale difference
 * between a laptop and the container is exactly the kind of thing that passes
 * here and fails there.
 *
 * Everything else goes, by construction rather than by list: this builds the
 * environment up from nothing instead of deleting names from the parent's. A
 * deny-list would need editing every time a variable is added, and the one
 * nobody remembers to add is the one worth stealing.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * How long a parser may run before it is killed.
 *
 * Generous against real work and short against a hang. The boot probe measured
 * a 289-megapixel image through the full pipeline in about a second; two
 * minutes is two orders of magnitude of headroom, and still far inside the
 * fifteen-minute deadline QStash allows a delivery — so a wedged parser fails
 * one photograph rather than holding the machine until the queue gives up on
 * it.
 *
 * `execFile` sends SIGTERM at the deadline, which for both of these binaries
 * is a clean exit; the pipeline sees a rejected promise and fails the photo.
 */
const TIMEOUT_MS = 120_000;

/** Enough to run. Nothing worth stealing. */
function parserEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    LANG: 'C.UTF-8',
  };
}

export type RunResult = { stdout: string; stderr: string };

/**
 * Run one of the image tools, contained.
 *
 * A drop-in for the `promisify(execFile)` both call sites used, differing only
 * in the two options that are not negotiable. `maxBuffer` stays a parameter
 * because the two callers genuinely differ — exiftool's JSON for a large file
 * against a PNG that never travels through a pipe.
 *
 * Deliberately no `shell` option and no string form: arguments are an array,
 * so a filename cannot become a command however it is spelled. That was
 * already true and is worth keeping true.
 */
export async function runParser(
  file: string,
  args: string[],
  options: { maxBuffer?: number } = {},
): Promise<RunResult> {
  return execFileAsync(file, args, {
    env: parserEnv(),
    timeout: TIMEOUT_MS,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
  });
}
