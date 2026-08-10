/**
 * Everything that only works on a device — docs/design.md §7.5.
 *
 * Kept in one file so `queue.ts` stays pure and testable, and so the parts
 * that behave differently per platform are visible together rather than
 * scattered.
 */

import { File, Paths, UploadTask } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { QueueItem, QueueState } from './queue';

const ACTOR_KEY = 'parea.actorToken';
const EVENTS_KEY = 'parea.events';
const QUEUE_FILE = 'upload-queue.json';

export type SavedEvent = {
  id: string;
  name: string;
  linkToken: string;
};

// --- identity ---------------------------------------------------------------

/**
 * The keychain, not AsyncStorage: this is the only thing standing between a
 * person and their ability to delete their own uploads.
 *
 * On iOS keychain items can outlive an uninstall, which would silently restore
 * an identity the user thought they had discarded. Not depended on either way.
 */
export async function loadActorToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACTOR_KEY);
}

export async function saveActorToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(ACTOR_KEY, token);
}

export async function forgetActor(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTOR_KEY);
}

// --- events you have joined --------------------------------------------------

export async function loadEvents(): Promise<SavedEvent[]> {
  const raw = await SecureStore.getItemAsync(EVENTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as SavedEvent[];
  } catch {
    return [];
  }
}

export async function rememberEvent(event: SavedEvent): Promise<SavedEvent[]> {
  const events = await loadEvents();
  const next = [event, ...events.filter((e) => e.id !== event.id)].slice(0, 50);
  await SecureStore.setItemAsync(EVENTS_KEY, JSON.stringify(next));
  return next;
}

// --- the durable queue -------------------------------------------------------

/**
 * A plain JSON file in the app's document directory.
 *
 * The queue holds asset URIs and a few fields per file, not image data, so it
 * stays small even for a 200-photo batch. SQLite would buy indexed queries
 * nothing here needs.
 */
function queueFile(): File {
  return new File(Paths.document, QUEUE_FILE);
}

export async function loadQueue(): Promise<QueueState> {
  try {
    const file = queueFile();
    if (!file.exists) return { items: [] };
    return JSON.parse(file.textSync()) as QueueState;
  } catch {
    // A corrupt queue must not brick the app on launch. Losing a pending batch
    // is recoverable — the photos are still in the camera roll.
    return { items: [] };
  }
}

export async function saveQueue(state: QueueState): Promise<void> {
  const file = queueFile();
  if (!file.exists) file.create({ intermediates: true });
  file.write(JSON.stringify(state));
}

// --- uploading ---------------------------------------------------------------

/**
 * PUT one file straight to storage.
 *
 * `sessionType: 'background'` hands the transfer to URLSession, which
 * continues after the app is backgrounded and even after it is terminated —
 * the thing the web client fundamentally cannot do. It is the SDK default on
 * iOS; stated explicitly here because the whole "close the app, it keeps
 * going" promise rests on it.
 *
 * Android has no equivalent. Uploads there survive backgrounding for a while
 * and die when the OS reclaims the process, so the UI must not promise
 * otherwise (see design §7.5).
 */
export async function uploadItem(item: QueueItem): Promise<void> {
  if (!item.uploadUrl) throw new Error('no upload url');

  const task = new UploadTask(new File(item.uri), item.uploadUrl, {
    httpMethod: 'PUT',
    headers: item.headers ?? {},
    mimeType: item.mime,
    sessionType: 'background',
  });

  const result = await task.uploadAsync();
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`upload failed: ${result.status}`);
  }
}

export const BACKGROUND_UPLOAD_SUPPORTED = Platform.OS === 'ios';

// --- saving to the camera roll -----------------------------------------------

/**
 * "Save all" — the native terminal action, in place of a zip.
 *
 * Downloads each photo and adds it to the camera roll, which is where people
 * actually want them. Sequential on purpose: a parallel version competes with
 * itself for bandwidth and makes progress meaningless.
 */
export async function saveToCameraRoll(
  urls: { id: string; url: string }[],
  onProgress: (done: number, total: number) => void,
): Promise<{ saved: number; failed: number }> {
  const permission = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
  if (!permission.granted) throw new Error('Permission to save photos was declined.');

  let saved = 0;
  let failed = 0;
  for (const [index, entry] of urls.entries()) {
    try {
      const target = new File(Paths.cache, `parea-${entry.id}`);
      if (target.exists) target.delete();
      await File.downloadFileAsync(entry.url, target);
      await MediaLibrary.createAssetAsync(target.uri);
      target.delete();
      saved++;
    } catch {
      failed++;
    }
    onProgress(index + 1, urls.length);
  }
  return { saved, failed };
}
