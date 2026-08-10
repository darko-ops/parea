/**
 * The API client — docs/design.md §1.
 *
 * "Two clients, one protocol." Every call here has a web counterpart hitting
 * the same endpoint; nothing is native-only. The single difference is how
 * identity travels: the web has a cookie, this sends the same signed value as
 * a bearer token out of the keychain.
 */

import { Offline, type PresignRequest, type PresignResponse } from '@parea/upload';

export type EventSummary = {
  id: string;
  name: string;
  linkToken: string;
  capEpoch: number;
  uploadsOpen: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

export type FeedPhoto = {
  id: string;
  /** Thumbnail, for the grid. */
  src: string;
  /** 2560px rendition, for looking at one. */
  full: string;
  /** The camera's own file. What gets saved to the camera roll. */
  original: string;
  /** Of the original — needed to say how large a save is before starting it. */
  byteSize: number;
  mime: string;
  takenAt: string;
  mine: boolean;
};

export type Feed = {
  event: {
    id: string;
    name: string;
    uploadsOpen: boolean;
    canAdminister: boolean;
    /** The group this event belongs to, if it was rolled into one. */
    groupId: string | null;
    groupName: string | null;
  };
  contributors: number;
  count: number;
  photos: FeedPhoto[];
};

/**
 * An album — an event, in the word the product says out loud.
 *
 * What a card on the home screen needs and nothing more: no photos, because
 * a list of albums is not a place to serve two hundred thumbnails.
 */
export type Album = {
  id: string;
  name: string;
  linkToken: string;
  place: string | null;
  eventDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  groupId: string | null;
  groupName: string | null;
  memberCount: number;
  photoCount: number;
  lastActiveAt: string;
};

/** A group as a stranger sees it: a door, never the room. */
export type GroupDoor = {
  id: string;
  name: string;
  memberCount: number;
  member: false;
  /** True for someone who was in one of its events — they can skip asking. */
  canJoinDirectly: boolean;
};

export type GroupRoom = {
  id: string;
  name: string;
  memberCount: number;
  member: true;
  role: 'member' | 'admin';
  findable: boolean;
  events: {
    id: string;
    name: string;
    linkToken: string;
    eventDate: string | null;
    createdAt: string;
    startsAt: string | null;
    endsAt: string | null;
  }[];
};

export type GroupView = GroupDoor | GroupRoom;

export type JoinRequest = {
  id: string;
  createdAt: string;
  displayName: string | null;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

export class Api {
  constructor(
    private readonly baseUrl: string,
    private token: string | null = null,
    private readonly client: 'ios' | 'android' = 'ios',
  ) {}

  setToken(token: string | null): void {
    this.token = token;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    // Which client this is, for §18's install-conversion split. Advisory by
    // nature: a caller lying about it skews a number and reaches nothing.
    headers['x-parea-client'] = this.client;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    } catch {
      // `fetch` rejects rather than answering, which at a venue means no
      // signal. Distinguished from an HTTP error because the upload queue
      // treats them oppositely: this one costs no retry attempt and stops the
      // run, where a 500 spends one. Errs towards Offline — a stalled queue
      // someone can restart beats photos marked permanently failed.
      throw new Offline();
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(res.status, body.error ?? 'unknown');
    }
    return (await res.json()) as T;
  }

  /**
   * All three doors, one endpoint: a pasted link, a scanned QR (which yields
   * the same token) and a spoken code.
   */
  join(input: { linkToken?: string; code?: string }): Promise<EventSummary> {
    return this.call<EventSummary>('/api/join', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /**
   * Create an event — design §3 screen 1.
   *
   * `startsAt`/`endsAt` are the auto-selection window (§7.3), and this is the
   * first client that sends them: the web form asks only for a date, so the
   * window that is supposed to be "captured at creation" has always been
   * inferred from uploads instead — which helps contributor five and not
   * contributor one.
   */
  createEvent(input: {
    name: string;
    place?: string;
    groupId?: string;
    eventDate?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    createdByName?: string;
  }): Promise<{ id: string; name: string; linkToken: string; url: string; code: string | null }> {
    return this.call('/api/events', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /** Minted on first contribution, never on first launch. */
  async startSession(displayName?: string): Promise<string> {
    const { actorToken } = await this.call<{ actorToken: string }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ displayName }),
    });
    this.token = actorToken;
    return actorToken;
  }

  feed(eventId: string, linkToken: string): Promise<Feed> {
    return this.call<Feed>(
      `/api/events/${eventId}/photos?t=${encodeURIComponent(linkToken)}`,
    );
  }

  async presign(
    eventId: string,
    linkToken: string,
    files: PresignRequest[],
  ): Promise<PresignResponse[]> {
    const { uploads } = await this.call<{ uploads: PresignResponse[] }>(
      `/api/events/${eventId}/uploads`,
      { method: 'POST', body: JSON.stringify({ files, linkToken }) },
    );
    return uploads;
  }

  complete(photoId: string, linkToken: string): Promise<unknown> {
    return this.call(`/api/uploads/${photoId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ linkToken }),
    });
  }

  /**
   * On native the natural terminal action is the camera roll, not a zip — but
   * the endpoint is shared, and the URLs it returns are what get saved.
   */
  download(
    eventId: string,
    linkToken: string,
    format: 'original' | 'jpeg' = 'original',
  ) {
    return this.call<{
      url: string;
      format: 'original' | 'jpeg';
      count: number;
      /** Originals swapped for a JPEG rendition; 0 means the archives match. */
      converted: number;
      totalBytes: number;
    }>(`/api/events/${eventId}/download`, {
      method: 'POST',
      body: JSON.stringify({ linkToken, format }),
    });
  }

  /**
   * Every album this actor can reach — the home and profile tabs.
   *
   * Membership rather than possession: events they took part in, plus every
   * event in a group they are in. An album they opened once from a link a
   * year ago is not somewhere they live.
   */
  async albums(): Promise<Album[]> {
    const { albums } = await this.call<{ albums: Album[] }>('/api/albums');
    return albums;
  }

  /** The name shown beside your uploads. The whole of a profile here. */
  setDisplayName(displayName: string): Promise<unknown> {
    return this.call('/api/session', {
      method: 'POST',
      body: JSON.stringify({ displayName }),
    });
  }

  // --- account ----------------------------------------------------------

  /**
   * Ask for a sign-in code.
   *
   * Answers the same however it went — whether the address has an account,
   * whether it exists, whether the mail was sent. Anything else would make
   * this a way to ask "does this person use Parea?", which is a question
   * about who was at which party.
   */
  requestSignIn(email: string): Promise<unknown> {
    return this.call('/api/account/code', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  /**
   * Present the code. Returns the actor token to keep, which may not be the
   * one this device had: signing in on a second device folds it into the
   * first, and `merged` says so rather than swapping identities silently.
   */
  async completeSignIn(
    email: string,
    code: string,
  ): Promise<{ actorToken: string; email: string; merged: boolean }> {
    const result = await this.call<{
      actorToken: string;
      email: string;
      merged: boolean;
    }>('/api/account/session', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
    this.token = result.actorToken;
    return result;
  }

  async account(): Promise<{ email: string } | null> {
    const { account } = await this.call<{ account: { email: string } | null }>(
      '/api/account/session',
    );
    return account;
  }

  /** Guideline 5.1.1(v): an app that makes accounts has to unmake them. */
  deleteAccount(alsoPhotos: boolean): Promise<{ deleted: boolean; photos: number }> {
    return this.call(`/api/account${alsoPhotos ? '?photos=1' : ''}`, {
      method: 'DELETE',
    });
  }

  // --- groups ----------------------------------------------------------

  /**
   * The groups this actor is in.
   *
   * Empty for someone who has never contributed, which is the common case on
   * first launch and not an error.
   */
  async myGroups(): Promise<{ id: string; name: string; role: 'member' | 'admin' }[]> {
    const { groups } = await this.call<{
      groups: { id: string; name: string; role: 'member' | 'admin' }[];
    }>('/api/groups');
    return groups;
  }

  /**
   * A group, as much of it as this actor is allowed to see.
   *
   * 404 covers three different things on purpose — no such group, a private
   * group, and a group you cannot see — because distinguishing them would
   * make the endpoint a way to confirm a private group exists.
   */
  group(id: string): Promise<GroupView> {
    return this.call<GroupView>(`/api/groups/${id}`);
  }

  /** Name search over findable groups. The backstop for a lost link. */
  async searchGroups(query: string): Promise<{ id: string; name: string; memberCount: number }[]> {
    const { groups } = await this.call<{
      groups: { id: string; name: string; memberCount: number }[];
    }>(`/api/groups/search?q=${encodeURIComponent(query)}`);
    return groups;
  }

  /**
   * Join, or ask to.
   *
   * One call because the client should not have to know which it is: someone
   * who was in one of the group's events is added, anyone else's request goes
   * to an admin, and the response says which happened.
   */
  joinGroup(id: string): Promise<{ member?: boolean; requested?: boolean }> {
    return this.call(`/api/groups/${id}/requests`, { method: 'POST', body: '{}' });
  }

  leaveGroup(id: string): Promise<unknown> {
    return this.call(`/api/groups/${id}/members`, { method: 'DELETE' });
  }

  async joinRequests(id: string): Promise<JoinRequest[]> {
    const { requests } = await this.call<{ requests: JoinRequest[] }>(
      `/api/groups/${id}/requests`,
    );
    return requests;
  }

  resolveRequest(
    groupId: string,
    requestId: string,
    action: 'approve' | 'decline',
  ): Promise<unknown> {
    return this.call(`/api/groups/${groupId}/requests`, {
      method: 'PATCH',
      body: JSON.stringify({ requestId, action }),
    });
  }

  /** Roll an event into a new group — design §3, and only a host can. */
  createGroup(fromEventId: string, name: string, findable: boolean) {
    return this.call<{ id: string; name: string }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ fromEventId, name, findable }),
    });
  }

  // --- instrumentation ---------------------------------------------------

  /**
   * The three §18 observations only a device witnesses — whether a suggestion
   * was shown, how much of it survived, and whether it fell through to the
   * picker. Everything else in §18 is a query over data the server already
   * has, and is not reported from here.
   *
   * Fire and forget in the strongest sense: never awaited for its result,
   * never retried, and a failure is a rounding error in a number. A client
   * retrying metrics is a bug that shows up as traffic.
   */
  observe(input: {
    kind: 'autoselect_shown' | 'autoselect_confirmed' | 'picker_used';
    eventId: string;
    count?: number;
    outOf?: number;
  }): void {
    void this.call('/api/observations', {
      method: 'POST',
      body: JSON.stringify(input),
    }).catch(() => {});
  }

  /** Fire and forget: failing to register must never block anything. */
  registerDevice(pushToken: string, platform: 'ios' | 'android'): Promise<unknown> {
    return this.call('/api/devices', {
      method: 'POST',
      body: JSON.stringify({ pushToken, platform }),
    });
  }

  removalRequest(photoId: string): Promise<unknown> {
    return this.call(`/api/photos/${photoId}/removal-request`, {
      method: 'POST',
      body: '{}',
    });
  }

  report(photoId: string): Promise<unknown> {
    return this.call(`/api/photos/${photoId}/report`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'abuse' }),
    });
  }

  block(photoId: string): Promise<unknown> {
    return this.call('/api/blocks', {
      method: 'POST',
      body: JSON.stringify({ photoId }),
    });
  }

  removeOwn(photoId: string): Promise<unknown> {
    return this.call(`/api/photos/${photoId}`, { method: 'DELETE' });
  }
}

/**
 * Extracts a link token from whatever someone actually pastes or scans — a
 * full URL, a bare token, or a URL with tracking junk on the end.
 */
export function tokenFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withoutQuery = trimmed.split('?')[0]!.replace(/\/+$/, '');
  const last = withoutQuery.split('/').pop() ?? '';
  return /^[A-Za-z0-9]{22}$/.test(last) ? last : null;
}
