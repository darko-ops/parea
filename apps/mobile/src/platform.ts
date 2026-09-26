/**
 * Everything that only works on a device — docs/design.md §7.5.
 *
 * Kept in one file so `queue.ts` stays pure and testable, and so the parts
 * that behave differently per platform are visible together rather than
 * scattered.
 */

import { File, Paths, UploadTask, UploadType } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as MediaLibrary from 'expo-media-library';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { Offline, SourceGone, type QueueItem, type QueueState } from '@parea/upload';

import { inOutbox, sandboxCopy } from './library';

const ACTOR_KEY = 'parea.actorToken';
const EVENTS_KEY = 'parea.events';
const SEARCHES_KEY = 'parea.searches';
const QUEUE_FILE = 'upload-queue.json';
const COVERS_FILE = 'owed-covers.json';
const PUSH_ASKED_KEY = 'parea.pushAsked';
const LIBRARY_ASKED_KEY = 'parea.libraryAsked';

export type SavedEvent = {
  id: string;
  name: string;
  linkToken: string;
  /** ISO 8601, from the host. Null is normal — the client falls back. */
  startsAt?: string | null;
  endsAt?: string | null;
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

/**
 * Signing out: hand back everything this phone is holding.
 *
 * Three stores, and only the first is identity. The second is the reason this
 * is not one line: every remembered event carries its `linkToken`, and a link
 * token *is* the credential — it is what the join endpoint exchanges for
 * access. Clearing the keychain and leaving the list behind would sign
 * somebody out and leave the next person holding the app able to walk into
 * every event this one had opened. It is the same rule the web follows for
 * capability cookies, and it bites harder here because the token is the secret
 * itself rather than a claim about one.
 *
 * The queue goes too, and that one costs something: photos waiting to upload
 * are dropped. Keeping them is worse — they were queued by somebody who has
 * left, and the next identity on this phone would finish sending them. The
 * screen says how many before asking, and the photographs are still in the
 * camera roll.
 *
 * And the covers still owed, for the same reason and more sharply: an owed
 * cover is an instruction to change the face of somebody else's album, held
 * against a link token that is being handed back on the line above.
 */
export async function signOutDevice(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTOR_KEY);
  await SecureStore.deleteItemAsync(EVENTS_KEY);
  // What the last person looked for is theirs, and this phone is being handed
  // back. It is not a credential like the two above, which is the only reason
  // it is last rather than first.
  await SecureStore.deleteItemAsync(SEARCHES_KEY);
  await saveQueue({ items: [] });
  await saveOwedCovers([]);
}

// --- what was typed into the search box -------------------------------------

/**
 * The last few searches, on their own phone.
 *
 * Ten, and nowhere else. A search term is a sentence about who somebody was
 * looking for and this product keeps none of them: no table, no request, no
 * field. This is a list of what was done with the box, held by the device that
 * did it, and it is handed back with everything else on sign-out.
 *
 * The same store the joined events use, and for a plainer reason than theirs:
 * it is the store this app has. There is no keychain argument here — a search
 * term is not a credential — but a second mechanism for one small list is a
 * second thing to remember to clear.
 *
 * ## Two kinds of entry, because there were two kinds of search
 *
 * A search that ended on a person is kept as **that person**: "wr" is what
 * somebody had got as far as typing, and Wren Halliday is who they were
 * looking for. Pressing it opens the profile rather than putting a prefix back
 * in the box and making them find the row again.
 *
 * Anything else — a group opened, a term that found nothing worth opening — is
 * kept as **the term**, because that is all it was, and pressing it runs it
 * again.
 *
 * A person is a handle and a name and nothing else. Not the picture: every
 * avatar in this product is presigned for an hour, so one kept here would be a
 * broken image by tomorrow. The letter on their lens is what the rest of the
 * app falls back to, and it never expires.
 */
export const RECENT_SEARCHES = 10;

export type RecentSearch =
  | { kind: 'person'; handle: string; name: string }
  | { kind: 'term'; term: string };

/** What two entries have to differ in to both be kept. */
const searchId = (entry: RecentSearch) =>
  entry.kind === 'person' ? `p:${entry.handle.toLowerCase()}` : `t:${entry.term.toLowerCase()}`;

/**
 * Read, tolerating every shape the key could be in.
 *
 * A bare string is what the first version of this wrote and it is read as the
 * term it was, rather than dropped: somebody's list should not empty itself
 * because the app learned to remember people.
 */
export async function loadSearches(): Promise<RecentSearch[]> {
  const raw = await SecureStore.getItemAsync(SEARCHES_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const kept: RecentSearch[] = [];
    for (const item of parsed) {
      if (typeof item === 'string' && item.trim()) {
        kept.push({ kind: 'term', term: item });
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (row.kind === 'person' && typeof row.handle === 'string' && row.handle) {
        kept.push({
          kind: 'person',
          handle: row.handle,
          name: typeof row.name === 'string' && row.name ? row.name : row.handle,
        });
      } else if (row.kind === 'term' && typeof row.term === 'string' && row.term.trim()) {
        kept.push({ kind: 'term', term: row.term });
      }
    }
    return kept.slice(0, RECENT_SEARCHES);
  } catch {
    return [];
  }
}

/**
 * Most recent first, without repeating it.
 *
 * Case-folded for the comparison and kept as it was written: "Wren" and "wren"
 * are the same search, and the one worth keeping is the one last written. A
 * handle is unique by case-insensitive index, so the same rule gives one row
 * per person.
 */
export async function rememberSearch(entry: RecentSearch): Promise<RecentSearch[]> {
  if (entry.kind === 'term' && !entry.term.trim()) return loadSearches();
  if (entry.kind === 'person' && !entry.handle) return loadSearches();
  const id = searchId(entry);
  const had = await loadSearches();
  const next = [entry, ...had.filter((e) => searchId(e) !== id)].slice(0, RECENT_SEARCHES);
  await SecureStore.setItemAsync(SEARCHES_KEY, JSON.stringify(next));
  return next;
}

export async function forgetSearches(): Promise<void> {
  await SecureStore.deleteItemAsync(SEARCHES_KEY);
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

// --- covers still owed -------------------------------------------------------

/**
 * A cover somebody framed, waiting for the photograph it is cut from.
 *
 * The first cover of an album cannot be sent when it is chosen. It is cut from
 * the derivative rather than from the camera's own file — an iPhone writes
 * HEIC and the cover endpoint cannot read one — and the derivative lands some
 * twenty to thirty seconds after the upload does. Between those two moments the
 * intention exists and nothing on the server records it.
 *
 * It used to live in a ref on the album screen, which is to say it lived for
 * exactly as long as somebody stood watching the album fill. Backing out to the
 * home screen in those thirty seconds — which is the ordinary thing to do, the
 * album is empty and there is nothing to look at — unmounted the screen and
 * threw the framing away. No cover, no request, and nothing anywhere saying one
 * had been asked for.
 *
 * So it is written down next to the upload queue, for the same reasons that one
 * is: the work outlives the screen that started it, and it must survive the app
 * being killed mid-way.
 */
export type OwedCover = {
  eventId: string;
  /**
   * The queue item this cover is cut from, before the server has named it.
   *
   * The framing is chosen on the phone's own asset, which has no photo id yet —
   * that arrives with the presign. `photoId` below is filled in from the queue
   * the moment it does, and is what every later pass looks for.
   */
  localId: string;
  photoId?: string;
  framing: { x: number; y: number; zoom: number };
  /**
   * How many times this has been looked for and not found.
   *
   * A count rather than a deadline, because the clock that matters is time
   * spent looking and not time elapsed: a phone in a pocket overnight has not
   * used up any of its chances, and a photograph whose derivative is never
   * coming uses them at the rate this app is actually open. It persists, so the
   * count carries across a restart the way the intention does.
   */
  looks: number;
};

function coversFile(): File {
  return new File(Paths.document, COVERS_FILE);
}

export async function loadOwedCovers(): Promise<OwedCover[]> {
  try {
    const file = coversFile();
    if (!file.exists) return [];
    const parsed = JSON.parse(file.textSync()) as OwedCover[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // The same reasoning as the queue: a corrupt file must not brick the app on
    // launch, and what is lost is one framing that can be chosen again.
    return [];
  }
}

export async function saveOwedCovers(covers: OwedCover[]): Promise<void> {
  const file = coversFile();
  if (!file.exists) file.create({ intermediates: true });
  file.write(JSON.stringify(covers));
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

  /*
   * A file this app owns, that exists right now.
   *
   * Two conditions, and getting it down to one crashed the app. The queue is
   * persisted, so an item may carry the asset's own path from before the copy
   * existed — `/var/mobile/Media/DCIM/…`, which a background session can never
   * open. But a copy this function made can also be *gone*: it is deleted after
   * a successful upload, and `Paths.cache` is a directory iOS empties whenever
   * it likes. Checking only "is it ours" sent `UploadTask` at a path that had
   * been deleted, and the native side does not return an error for that — it
   * raises, and an uncaught ObjC exception takes the whole app down:
   *
   *   *** Terminating app due to uncaught exception 'NSInvalidArgumentException',
   *   reason: 'Cannot read file at file:///…/Caches/outbox/…'
   *
   * Which is the worst shape a bug can take here: the queue runs on launch, so
   * a single unreadable item made the app unusable rather than making one
   * photograph fail.
   */
  let source = item.source;
  if (!inOutbox(source) || !new File(source).exists) {
    try {
      source = (await sandboxCopy(item.id)).uri;
    } catch (err) {
      /*
       * The asset itself is unreadable — deleted from the library, or in
       * iCloud with no way to fetch it. No retry will find it, which is
       * exactly what `SourceGone` means: the item goes stale rather than
       * burning three attempts, and nothing crashes.
       */
      throw new SourceGone(err instanceof Error ? err.message : String(err));
    }
  }

  /*
   * Checked once more before handing it over.
   *
   * `copy()` can report success and still leave nothing readable if the cache
   * was reclaimed in between. This is the last point at which that can be a
   * thrown error rather than a crash.
   */
  const file = new File(source);
  if (!file.exists) {
    throw new SourceGone(`copy missing after preparing it: ${source}`);
  }

  const task = new UploadTask(file, item.uploadUrl, {
    httpMethod: 'PUT',
    headers: item.headers ?? {},
    mimeType: item.mime,
    sessionType: 'background',
  });

  let result;
  try {
    result = await task.uploadAsync();
  } catch (err) {
    /*
     * A transfer that never got an answer. At a venue this is no signal, and
     * the queue must not spend a retry on it — see `Offline`. Erring towards
     * that reading: a stalled queue someone restarts beats a batch of photos
     * marked permanently failed while they were standing in a basement.
     *
     * But the message travels with it, and the queue keeps it as `cause`. This
     * reading is a guess, and for a while it was an unfalsifiable one: every
     * failure here — an unreadable file as much as a dead network — came out of
     * the app as "waiting for a connection", which is advice to do nothing
     * about a problem that was never going to fix itself.
     */
    throw new Offline(err instanceof Error ? err.message : String(err));
  }

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`upload failed: ${result.status}`);
  }

  /*
   * The copy has done its job, so it goes.
   *
   * `resolveForUpload` copies each chosen photograph into the cache because a
   * background session cannot read one out of the Photos container. That leaves
   * a second copy of somebody's evening on their phone, and the moment it stops
   * being needed is this one — after a 2xx, never before, because a retry needs
   * the bytes.
   *
   * Only ever our own outbox: the same function uploads covers and anything else
   * a caller points it at, and deleting a file somebody else owns because it
   * happened to be uploaded would be a fine way to eat a camera roll.
   *
   * Swallowed, because a copy that outlives its upload is litter in a directory
   * iOS empties under pressure, and failing an upload that has already
   * succeeded over it would be the worse outcome by far.
   */
  if (inOutbox(source)) {
    try {
      new File(source).delete();
    } catch {}
  }
}

/**
 * POST an event cover, straight from the camera roll.
 *
 * The same `UploadTask` the photographs use, pointed at this product's own
 * endpoint rather than at storage — which is the difference between a cover
 * and a photograph on this side too: a photograph is presigned and goes to the
 * bucket, a cover goes to the server, which re-encodes it and keeps one wide
 * JPEG. See `/api/events/[id]/cover`.
 *
 * Not awaited by the screen that starts it. `sessionType: 'background'` means
 * iOS carries it on after the sheet has been dismissed and after the app has
 * been left, and there is nothing for anybody to wait in front of: the event
 * exists, and a cover that does not arrive leaves it looking exactly as it
 * would have looked without one.
 */
/**
 * A photograph already in the album, brought down so it can go back up as a cover.
 *
 * Two round trips for bytes that are already on the server, which looks
 * wasteful and is the only thing available. `apps/web/src/storage/index.ts`
 * opens with the reason in capitals: the interface handed to the app tier has
 * no method that returns bytes, deliberately, so that no photograph can ever be
 * routed through the Next.js origin. A "make the cover out of photo X" endpoint
 * would be exactly that route, and the invariant is worth more than the
 * megabyte.
 *
 * The download is client ↔ storage, which is the movement the invariant is
 * built to preserve — a presigned URL, straight to R2, nothing in between.
 *
 * `full` rather than the original: 2560 pixels on the long edge against a
 * stored cover of 1200, so there is nothing to gain from the camera's own file
 * and several megabytes to lose on somebody's data plan.
 *
 * Into the cache rather than documents, and deleted by the caller once it has
 * been sent: this file exists for the length of one upload.
 */
export async function fetchForCover(url: string, id: string): Promise<File> {
  const target = new File(Paths.cache, `parea-cover-${id}.jpg`);
  if (target.exists) target.delete();
  await File.downloadFileAsync(url, target);
  return target;
}

export async function uploadCover(
  url: string,
  headers: Record<string, string>,
  uri: string,
): Promise<void> {
  /*
   * Checked before it is handed over, for the reason `uploadItem` explains at
   * length: the native side raises rather than returning an error for a file it
   * cannot read, and an uncaught ObjC exception takes the app down with it. The
   * cover is sent without anybody waiting on it, so a crash here would be a
   * crash nobody could connect to anything they had done.
   */
  const file = new File(uri);
  if (!file.exists) throw new Error(`cover source is not readable: ${uri}`);

  const task = new UploadTask(file, url, {
    httpMethod: 'POST',
    // The file as the request body and nothing else. It is the default, and
    // it is written down because the endpoint reads `arrayBuffer()` — a
    // multipart body would arrive as a form with a JPEG somewhere inside it,
    // which sharp answers "not an image" to, and the event would quietly have
    // no cover.
    uploadType: UploadType.BINARY_CONTENT,
    headers,
    mimeType: headers['content-type'] ?? 'image/jpeg',
    sessionType: 'background',
  });
  const result = await task.uploadAsync();
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`cover failed: ${result?.status ?? 'no response'}`);
  }
}

export const BACKGROUND_UPLOAD_SUPPORTED = Platform.OS === 'ios';

// --- push --------------------------------------------------------------------

/**
 * The Android channel everything is delivered on.
 *
 * The id has to be the one `@parea/push` puts on the message — it is
 * `NOTIFICATION_CHANNEL` there, and a string here because this app does not
 * take that package as a dependency. `config.test` checks the two agree,
 * because a `channelId` naming a channel that does not exist does not fail: it
 * quietly falls back to Expo's own, which is the behaviour this exists to
 * replace.
 */
export const NOTIFICATION_CHANNEL = 'default';

/**
 * How a notification behaves while the app is open.
 *
 * Shown rather than suppressed. Suppressing is the clever choice and the
 * surprising one — a person who saw their phone light up and then finds
 * nothing has been told something went wrong. §12 permits so few of these
 * that none of them is noise.
 *
 * Silent, though. A sound is for a phone in a pocket; making one about
 * something already on the screen is the product reacting to itself. The
 * message asks for one — see `toMessage` — and this is where that is dropped
 * for the case where it would be noise.
 *
 * The badge is allowed now, where it was refused. That is not by itself what
 * draws one — nothing sends a per-recipient count on the payload, and asking
 * the server for one would be a query per person at send time — the number
 * comes from `setAppBadge` below, off the same count the tray uses. What
 * `false` did was make even that impossible on iOS, where the badge is a
 * permission this handler is part of asking for.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

/**
 * The channel, created as early as the module is loaded.
 *
 * Android will not drop a notification down over what somebody is looking at
 * unless its channel says it may, and that is `importance`, not anything on
 * the message. At `DEFAULT` — which is what this was — a notification makes a
 * sound and joins the shade and never interrupts, which for a product allowed
 * one reminder per event is the whole feature spent on a line in a list.
 *
 * Created here rather than inside `registerForPush`, which is the only place
 * it used to happen: that function runs once ever, behind a flag in
 * `SecureStore`, so a channel lost to a failed call or to an Android version
 * that cleared it would never be made again and every later notification would
 * arrive on nothing. Creating a channel that already exists is a no-op, so
 * doing it on every launch is the cheap way to be sure there is one.
 *
 * A note for the day this needs to change: Android fixes importance at
 * creation and will not let an app raise it afterwards. Raising it means a new
 * channel id, in both this file and `@parea/push`.
 */
if (Platform.OS === 'android') {
  void Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL, {
    // What somebody sees in Android's own settings, where they will go to turn
    // this off. "Events" is what these are about; "Default" is what the
    // scaffolding was called.
    name: 'Events',
    importance: Notifications.AndroidImportance.HIGH,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    // The dot the launcher puts on the app's own icon. Said rather than left
    // to the platform's default, because it is half of what somebody who
    // missed the banner has to find their way back by.
    showBadge: true,
    enableVibrate: true,
  }).catch(() => {
    // Nothing in the product depends on this having worked, and a phone that
    // refuses the channel is not something a person can be asked to fix.
  });
}

/** The payload of the notification that launched the app, if one did. */
export async function launchNotification(): Promise<Record<string, unknown> | null> {
  const response = await Notifications.getLastNotificationResponseAsync();
  return (response?.notification.request.content.data as Record<string, unknown>) ?? null;
}

/** Taps while the app is running. Returns an unsubscribe. */
export function onNotificationTapped(
  handler: (data: Record<string, unknown>) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    handler((response.notification.request.content.data as Record<string, unknown>) ?? {});
  });
  return () => subscription.remove();
}

/**
 * Arrivals, tapped or not. Returns an unsubscribe.
 *
 * The other half of `onNotificationTapped`, and the half that was missing. A
 * notification that arrives while the app is open draws its banner and is then
 * swiped away or ignored, and until this existed the app underneath learned
 * nothing from it: the tray in the corner went on saying there was nothing
 * there, because the only thing that ever moved that number was the app being
 * launched or Lately being closed.
 *
 * So this is what makes the mark appear at the moment the notification does.
 * It carries no payload to the caller on purpose — what arrived is already a
 * row in the feed, and the app's job here is to go and ask.
 */
export function onNotificationReceived(handler: () => void): () => void {
  const subscription = Notifications.addNotificationReceivedListener(() => handler());
  return () => subscription.remove();
}

/**
 * The number on the app's own icon.
 *
 * The one mark that outlives a banner: somebody who was not looking at their
 * phone when it arrived, and who does not scroll back through the shade, has
 * this and nothing else. Kept in step with the tray inside the app, from the
 * same count — see `refreshWaiting` — so the icon and the corner never
 * disagree about whether there is anything to come back for.
 *
 * Silent on failure. Badges are a permission of their own on iOS and somebody
 * may simply have said no, which is an answer rather than an error.
 */
export async function setAppBadge(count: number): Promise<void> {
  await Notifications.setBadgeCountAsync(Math.max(0, count)).catch(() => {});
}

/**
 * Ask for notifications, once, and only when there is something worth being
 * told about — design §12.
 *
 * Called after a first contribution, not on first launch. All three
 * notifications are about something you took part in, so before you have
 * contributed there is nothing to be told about and the prompt is spent on
 * nothing. A declined prompt is not re-askable in practice.
 *
 * Returns null when declined or unavailable, which every caller treats as
 * ordinary rather than as an error.
 */
export async function pushAlreadyAsked(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PUSH_ASKED_KEY)) === 'yes';
}

/**
 * Whether the photo library has been asked for in our own words yet.
 *
 * The same flag the push prompt keeps, for the same reason and with one
 * difference worth stating.
 *
 * The system's own answer covers two of the three outcomes: granted and
 * denied both stop `libraryAccess()` returning `undetermined`, so neither can
 * be asked twice. What it does not cover is *Not now* — somebody who closed
 * our card without reaching the system prompt at all. Without this that person
 * is asked again every time they add photos to an album, which is the one
 * shape of nagging the OS cannot protect anybody from, because from its side
 * nothing happened.
 *
 * Set on both answers, which is the point: it records that we asked, not what
 * they said.
 */
export async function libraryAlreadyAsked(): Promise<boolean> {
  return (await SecureStore.getItemAsync(LIBRARY_ASKED_KEY)) === 'yes';
}

export async function markLibraryAsked(): Promise<void> {
  await SecureStore.setItemAsync(LIBRARY_ASKED_KEY, 'yes').catch(() => {
    // A device that will not keep the flag asks again next time, which is a
    // worse experience and not a broken one. Nothing here is worth an error.
  });
}

export async function registerForPush(): Promise<string | null> {
  // Recorded before the prompt, not after: asking twice is worse than never
  // learning the answer, and a crash mid-prompt should not re-ask.
  await SecureStore.setItemAsync(PUSH_ASKED_KEY, 'yes');
  try {
    const existing = await Notifications.getPermissionsAsync();
    const granted =
      existing.granted ||
      (existing.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
    if (!granted) return null;

    const token = await Notifications.getExpoPushTokenAsync();
    return token.data ?? null;
  } catch {
    return null;
  }
}

// --- saving to the camera roll -----------------------------------------------

/**
 * A file extension the photo library will understand.
 *
 * A second copy of a mapping `@parea/zip` also makes for archive entry names,
 * and deliberately so: the fallbacks differ. An archive entry it cannot name
 * becomes `.bin`, which is honest in a folder someone unzips; a camera-roll
 * temp file it cannot name is better off claiming to be a JPEG than being
 * rejected outright. Pulling a zip writer into the app to share eight lines
 * would cost more than the duplication does.
 */
function extensionFor(mime: string): string {
  switch (mime) {
    case 'image/heic':
    case 'image/heif':
      return '.heic';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/avif':
      return '.avif';
    case 'video/mp4':
      return '.mp4';
    case 'video/quicktime':
      return '.mov';
    default:
      return '.jpg';
  }
}

/**
 * "Save all" — the native terminal action, in place of a zip.
 *
 * Downloads each photo and adds it to the camera roll, which is where people
 * actually want them. Sequential on purpose: a parallel version competes with
 * itself for bandwidth and makes progress meaningless.
 */
export async function saveToCameraRoll(
  urls: { id: string; url: string; mime: string }[],
  onProgress: (done: number, total: number) => void,
): Promise<{ saved: number; failed: number }> {
  /*
   * Write-only, which is all this does.
   *
   * It asked for the whole library — `writeOnly: false` — to put one file
   * into it, and that was wrong twice over. It contradicted the deliberate
   * shape of `library.ts`, where read access is an upgrade offered only after
   * somebody has contributed once and the app works without it; and on iOS the
   * two are separate authorisations, so anybody who had declined that upgrade
   * could never save a photograph again. The request came back `granted:
   * false` and the alert said "Try again in a moment" for as long as they were
   * willing to.
   *
   * `true` maps to `PHAccessLevel.addOnly`, which iOS tracks apart from
   * read-write and will prompt for on its own. Somebody who has already
   * granted the full library is covered by it and sees nothing.
   *
   * Safe for `Asset.create`, which is the thing that runs under it: the native
   * side performs a change request and takes the id off
   * `placeholderForCreatedAsset`. It never fetches the asset back, which is
   * the operation add-only would refuse.
   */
  const permission = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
  if (!permission.granted) throw new Error('Permission to save photos was declined.');

  let saved = 0;
  let failed = 0;
  for (const [index, entry] of urls.entries()) {
    try {
      // With an extension, because the photo library reads one. An
      // extensionless file is the sort of thing that works for JPEG on one OS
      // version and silently fails for HEIC on another, and HEIC is what an
      // iPhone original actually is.
      const target = new File(Paths.cache, `parea-${entry.id}${extensionFor(entry.mime)}`);
      if (target.exists) target.delete();
      await File.downloadFileAsync(entry.url, target);
      /*
       * `Asset.create`, not `createAssetAsync`.
       *
       * The old name is still exported from the package root in
       * expo-media-library 57 and is a stub whose entire body throws —
       * "@deprecated … This method will throw in runtime". So every save
       * failed, for everybody, at the last step: the file downloaded, the
       * permission was granted, and the alert said "Try again in a moment"
       * about something no amount of trying would fix.
       *
       * Worth knowing how it hid. The call is inside a `try` that turns any
       * throw into a failed *file* rather than a failed feature, which is
       * right for the bulk save — one unreachable photograph out of two
       * hundred should not end the download — and it meant a dead API read
       * exactly like a network problem.
       */
      await MediaLibrary.Asset.create(target.uri);
      target.delete();
      saved++;
    } catch {
      failed++;
    }
    onProgress(index + 1, urls.length);
  }
  return { saved, failed };
}
