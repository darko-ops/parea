import { LocalStorage } from './local';
import { R2Storage } from './r2';
import type { Storage } from './index';

let cached: Storage | null = null;

/**
 * R2 when configured, filesystem otherwise.
 *
 * Falling back silently would be dangerous in production — photos would land
 * on an ephemeral container disk and vanish — so production without R2
 * credentials is a startup error rather than a degraded mode.
 */
export function getStorage(): Storage {
  if (cached) return cached;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (accountId && accessKeyId && secretAccessKey && bucket) {
    cached = new R2Storage({ accountId, accessKeyId, secretAccessKey, bucket });
    return cached;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, ' +
        'R2_SECRET_ACCESS_KEY and R2_BUCKET. Refusing to write photos to ' +
        'local disk in production.',
    );
  }

  cached = new LocalStorage(
    process.env.LOCAL_STORAGE_DIR ?? '.storage',
    process.env.SESSION_SECRET ?? 'dev-secret-not-for-production',
    process.env.APP_URL ?? 'http://localhost:3000',
  );
  return cached;
}

/** Tests swap in a fake; nothing else should call this. */
export function __setStorageForTests(storage: Storage | null): void {
  cached = storage;
}
