/**
 * Running the deriver on a development machine, with the web app's secrets.
 *
 * The deriver reads its configuration from the environment and says nothing
 * about where that environment comes from, which is right for the thing that
 * will eventually run it — a container with real secrets injected. On a laptop
 * the secrets are in `apps/web/.env.local`, and something has to bridge the
 * two. This is that something, and it is deliberately the only thing it does.
 *
 * ## Why not `set -a; . .env.local`
 *
 * Because it does not work, and it fails in the way that costs an hour: one of
 * the values contains an `&`, which a shell reads as "background this" and then
 * reports as a parse error on a line number in a file nobody thinks of as code.
 * `process.loadEnvFile` is Node's own parser for exactly this format, so the
 * file means what it looks like it means.
 *
 * ## Why not put the secrets in the launchd plist
 *
 * Because then there would be two copies of them, in two formats, and rotating
 * a key would be a thing you could half-do. The plist names this file; this
 * file names `.env.local`; there is one place a secret lives.
 *
 * Usage: `node services/deriver/bin/local.mjs [watch|once|probe]`, which is
 * what `~/Library/LaunchAgents/com.parea.deriver.plist` invokes. See
 * `docs/deriver-local.md`.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DERIVER = fileURLToPath(new URL('..', import.meta.url));
const REPO = fileURLToPath(new URL('../../..', import.meta.url));

const ENV_FILE = `${REPO}apps/web/.env.local`;
const TSX = `${REPO}node_modules/tsx/dist/cli.mjs`;

if (!existsSync(ENV_FILE)) {
  console.error(`no environment file at ${ENV_FILE}`);
  console.error('Copy apps/web/.env.example and fill it in, or run the deriver');
  console.error('with DATABASE_URL and the R2_* variables already exported.');
  process.exit(78); // EX_CONFIG
}

if (!existsSync(TSX)) {
  console.error(`tsx is not installed at ${TSX} — run npm install at ${REPO}`);
  process.exit(78);
}

/*
 * The file wins over anything already exported.
 *
 * `loadEnvFile` does not overwrite a variable that is already set, which is the
 * right default for a shell somebody has configured on purpose — and the wrong
 * one for launchd, whose environment is inherited from whatever `launchctl
 * setenv` has been told over the life of the login session. A stale
 * DATABASE_URL sitting in that environment would silently outrank the file and
 * point this at another database, so the file is read into a copy and applied.
 */
const before = { ...process.env };
process.loadEnvFile(ENV_FILE);
const fromFile = Object.fromEntries(
  Object.entries(process.env).filter(([k, v]) => before[k] !== v),
);

const mode = process.argv[2] ?? 'watch';
if (!['watch', 'once', 'probe'].includes(mode)) {
  console.error(`unknown mode "${mode}" — expected watch, once or probe`);
  process.exit(64); // EX_USAGE
}

console.log(`[deriver] ${mode}, env from ${ENV_FILE}, started ${new Date().toISOString()}`);

const child = spawn(process.execPath, [TSX, `${DERIVER}src/index.ts`, mode], {
  cwd: DERIVER,
  env: { ...process.env, ...fromFile },
  stdio: 'inherit',
});

/*
 * Signals are passed on rather than swallowed.
 *
 * `launchctl kill` and a machine going to sleep both arrive here first, and a
 * wrapper that exits without telling the child leaves a deriver holding claimed
 * jobs with nothing watching it.
 */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  console.log(`[deriver] exited ${signal ?? code} at ${new Date().toISOString()}`);
  // Exit with the child's own status, so `KeepAlive` in the plist sees the
  // difference between "stopped on purpose" and "fell over".
  process.exit(signal ? 1 : (code ?? 0));
});

