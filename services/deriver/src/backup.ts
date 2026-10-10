/**
 * The off-site database copy: once a day, `pg_dump` of production, encrypted
 * on this machine, put in an R2 bucket of its own.
 *
 * Everything else that can bring the database back lives inside Neon — its
 * one day of history and the snapshot branches taken before migrations — so
 * losing the Neon account, or someone with its keys deleting the project,
 * would lose all of it at once. This copy is somewhere Neon does not control.
 *
 * ## What protects it
 *
 * - **Encrypted before it leaves.** The dump goes through `age` to a public
 *   key (`BACKUP_AGE_RECIPIENT`). The private key is on no server; whoever
 *   holds the bucket key, or the bucket, holds ciphertext.
 * - **Its own bucket and its own key.** `BACKUP_R2_*`, scoped to the backup
 *   bucket only, so the photo store's key cannot touch it and this key cannot
 *   touch photos.
 * - **Not deletable for six days.** R2 cannot issue a write-only key, so the
 *   bucket carries a lock rule: nothing in it can be deleted or overwritten
 *   for six days, whoever asks. A stolen key cannot wipe the backups.
 * - **Gone after seven.** A lifecycle rule on the bucket deletes each copy
 *   seven days after it was written, which is what the privacy page promises:
 *   a deleted account or photo record lasts at most a week in a backup.
 *
 * ## When
 *
 * The hourly job calls this every run; it does the work when the last copy
 * that succeeded is more than 23 hours old, so a failed night is tried again
 * the next hour rather than the next day. Recorded in `job_run` as `backup`,
 * which the web app's heartbeat watches: no success for 26 hours alerts.
 *
 * A failure here is recorded and does not fail the hourly run — removal
 * deadlines and purges must not wait on a backup.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { schema } from '@parea/core';
import { eq } from 'drizzle-orm';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BACKUP = 'backup';
/** A copy younger than this means there is nothing to do this hour. */
export const BACKUP_EVERY_MS = 23 * 60 * 60 * 1000;

export type BackupConfig = {
  databaseUrl: string;
  recipient: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

/** The configuration, or the names of what is missing. */
export function backupConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BackupConfig | { missing: string[] } {
  const wanted = {
    databaseUrl: 'DATABASE_URL',
    recipient: 'BACKUP_AGE_RECIPIENT',
    accountId: 'R2_ACCOUNT_ID',
    accessKeyId: 'BACKUP_R2_ACCESS_KEY_ID',
    secretAccessKey: 'BACKUP_R2_SECRET_ACCESS_KEY',
    bucket: 'BACKUP_R2_BUCKET',
  } as const;
  const missing = Object.values(wanted).filter((name) => !env[name]?.trim());
  if (missing.length) return { missing };
  const config = Object.fromEntries(
    Object.entries(wanted).map(([key, name]) => [key, env[name]!.trim()]),
  ) as BackupConfig;
  // An age recipient is a public key; anything else would encrypt to nobody
  // or fail at three in the morning.
  if (!/^age1[0-9a-z]{58}$/.test(config.recipient)) return { missing: ['BACKUP_AGE_RECIPIENT (not an age1… public key)'] };
  return config;
}

export function backupDue(lastSucceededAt: Date | null | undefined, now: Date): boolean {
  return !lastSucceededAt || now.getTime() - lastSucceededAt.getTime() >= BACKUP_EVERY_MS;
}

/** Where a copy goes: one object per run, named by when, sorted by name. */
export function backupKey(now: Date): string {
  return `db/${now.toISOString().slice(0, 16).replace(':', '-')}Z.dump.age`;
}

/**
 * libpq's environment for the database, from its URL — so the password is in
 * the child's environment, not on a command line `ps` would show.
 *
 * Neon's pooled host (`-pooler`) is swapped for the direct one: `pg_dump`
 * holds one transaction for the whole dump, which a transaction-mode pooler
 * does not promise to keep on one connection.
 */
export function pgEnv(databaseUrl: string): Record<string, string> {
  const url = new URL(databaseUrl);
  return {
    PGHOST: url.hostname.replace('-pooler.', '.'),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
    PGSSLMODE: url.searchParams.get('sslmode') ?? 'require',
  };
}

/**
 * `pg_dump | age` into a file, failing if either does. Custom format, which
 * `pg_restore` can restore selectively and which is already compressed.
 */
async function dumpEncrypted(config: BackupConfig, file: string): Promise<void> {
  const dump = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-acl'], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...pgEnv(config.databaseUrl) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const encrypt = spawn('age', ['--encrypt', '--recipient', config.recipient], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  dump.stdout.pipe(encrypt.stdin);
  const out = createWriteStream(file);
  encrypt.stdout.pipe(out);
  const written = new Promise<void>((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
  });

  const finished = (child: ReturnType<typeof spawn>, name: string) =>
    new Promise<void>((resolve, reject) => {
      let stderr = '';
      child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
      child.on('error', (err) => reject(new Error(`${name}: ${err.message}`)));
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error(`${name} exited ${code}: ${stderr.trim().split('\n')[0] ?? ''}`)),
      );
    });
  await Promise.all([finished(dump, 'pg_dump'), finished(encrypt, 'age'), written]);
}

async function upload(config: BackupConfig, key: string, file: string): Promise<number> {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const { size } = await stat(file);
  // An empty file is a dump that produced nothing; refuse to store it as a backup.
  if (size === 0) throw new Error('the encrypted dump is empty');
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: createReadStream(file),
      ContentLength: size,
      ContentType: 'application/octet-stream',
    }),
  );
  return size;
}

/** Dump, encrypt and upload one copy. Returns its key and size in bytes. */
export async function takeBackup(config: BackupConfig, now = new Date()): Promise<{ key: string; bytes: number }> {
  const dir = await mkdtemp(join(tmpdir(), 'parea-backup-'));
  try {
    const file = join(dir, 'dump.age');
    await dumpEncrypted(config, file);
    const key = backupKey(now);
    return { key, bytes: await upload(config, key, file) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * The hourly job's step: take a copy if one is due, and record how it went.
 * Never throws. Returns what to print: the key and size, or why not.
 */
export async function backupIfDue(
  database: any,
  options: {
    now?: Date;
    force?: boolean;
    env?: NodeJS.ProcessEnv;
    take?: (config: BackupConfig, now: Date) => Promise<{ key: string; bytes: number }>;
  } = {},
): Promise<string> {
  const now = options.now ?? new Date();
  const take = options.take ?? takeBackup;
  const [run] = await database.select().from(schema.jobRuns).where(eq(schema.jobRuns.name, BACKUP)).limit(1);
  if (!options.force && !backupDue(run?.lastSucceededAt, now)) return 'not due';

  const record = (set: Record<string, unknown>) =>
    database
      .insert(schema.jobRuns)
      .values({ name: BACKUP, ...set })
      .onConflictDoUpdate({ target: schema.jobRuns.name, set });

  const config = backupConfigFromEnv(options.env);
  if ('missing' in config) {
    // Recorded as a failure, so the heartbeat says so: an unconfigured backup
    // is the gap this exists to close, not a reason to be quiet.
    const error = `not configured: ${config.missing.join(', ')}`;
    await record({ lastFailedAt: now, lastError: error });
    return error;
  }
  try {
    const { key, bytes } = await take(config, now);
    await record({ lastSucceededAt: now });
    return `${key} (${bytes} bytes)`;
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).split('\n')[0]!.slice(0, 300);
    await record({ lastFailedAt: now, lastError: error });
    return `failed: ${error}`;
  }
}
