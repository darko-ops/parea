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
    /**
     * Who can see it, as it stands: `public` or `private`.
     *
     * Sent to everybody rather than only to whoever can change it, on the same
     * reasoning as the cover below — and because it is not a secret from the
     * people in it. Somebody about to hand the link on is entitled to know
     * whether it will work.
     */
    accessPolicy: 'public' | 'private';
    /** People waiting to be let in. Zero for anyone who cannot answer them. */
    waiting: number;
    /** The group this event belongs to, if it was rolled into one. */
    groupId: string | null;
    groupName: string | null;
    /**
     * The picture the event leads with, presigned for an hour, or null.
     *
     * Only the host can change it, but everybody is sent it: it costs one
     * presign, and the alternative is a field that appears and disappears
     * depending on who is asking, which is a second thing to get wrong.
     */
    coverUrl: string | null;
  };
  contributors: number;
  count: number;
  photos: FeedPhoto[];
};

/**
 * One event as it appears in a list: enough to draw a card, and no more.
 *
 * What a card on the home screen needs and nothing more: no photos, because
 * a list of events is not a place to serve two hundred thumbnails.
 */
/**
 * A group, with enough to recognise it in a list.
 *
 * `eventCount` is every event in the group, not only the ones this actor has
 * opened — which discloses nothing new, because `groupEvents` already lists
 * all of them by name to every member. A group is the room; being in it is
 * what lets you see what is in it. Photos are still only ever reachable
 * through an event, which is the line that actually matters.
 *
 * `lastActiveAt` is null for a group nobody has put an event in yet, which the
 * screen says nothing about rather than rendering "never".
 */
/** Somebody who can be put in a group: an account, with a face. */
export type ClusterPerson = { actorId: string; name: string; avatarUrl: string | null };

/**
 * A set of people the actor keeps ending up in the same events as.
 *
 * Never a group, and the copy must never call it one — it is an observation
 * about events that already happened, and nothing exists until somebody
 * presses Create. See `recurringClusters` on the server for why the set is the
 * exact shared-event set rather than an overlap.
 */
export type Cluster = {
  key: string;
  people: ClusterPerson[];
  personIds: string[];
  faces: { name: string; avatarUrl: string | null }[];
  moreFaces: number;
  /** "Priya, Tomás, Maya + 8 others" — worded by the server. */
  names: string;
  sharedEventCount: number;
  suggestedName: string | null;
};

export type MyGroupDetail = {
  id: string;
  name: string;
  role: 'member' | 'admin';
  memberCount: number;
  eventCount: number;
  lastActiveAt: string | null;
};

export type EventListing = {
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
  /**
   * Signed thumbnail URLs, most recent first, at most four.
   *
   * Signed by the server: this client has no image secret and must not have
   * one. They expire with the event's `cap_epoch`, so rotating a link stops
   * the old thumbnails resolving along with everything else.
   */
  mosaic: string[];
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

/**
 * One thing waiting on an answer from you — the same shape the web page draws.
 *
 * Three kinds, and the client's only job is knowing where each one is
 * answered. Deliberately not flattened into a single "answer this" call on the
 * server: each kind is answered by the route that already decides who may, and
 * one endpoint that answers all three would be a second place for that
 * decision to live.
 */
export type PendingRequest = {
  key: string;
  kind: 'invite' | 'friend' | 'join';
  id: string;
  eventId: string | null;
  title: string;
  detail: string;
  at: string;
};

/**
 * Where you and somebody else stand, as the profile screen draws it.
 *
 * `asked` covers a refusal as well as an unanswered ask, and the server is
 * where that decision lives: telling somebody they were declined is the
 * decliner's to do, so the app is never told either.
 */
export type Standing = 'self' | 'friends' | 'asked' | 'asking' | 'none';

/** One person, as everybody else is allowed to see them. */
export type Person = {
  actorId: string;
  handle: string;
  displayName: string | null;
  /** Presigned for an hour. The storage key never crosses this boundary. */
  avatar: string | null;
  standing: Standing;
  /** Only when they are the one waiting: the id the answer goes to. */
  requestId: string | null;
};

/**
 * An event you are both in.
 *
 * Taken out of the *viewer's* list on the server and filtered down to the
 * ones this person is in — never the other way round. See `people.ts` on the
 * web for why the direction of that sentence is the safety property.
 */
export type SharedEvent = {
  id: string;
  name: string;
  caption: string | null;
  lastActiveAt: string;
  thumb: string | null;
};

/**
 * One album on somebody's page.
 *
 * Two shapes in one type and `locked` says which. Locked means private and
 * this viewer is not in it: no thumbnail and no count, because those are what
 * they are asking for. The only thing to do with a locked one is ask.
 */
export type ProfileAlbum = {
  id: string;
  name: string;
  locked: boolean;
  /** Null when locked. */
  photoCount: number | null;
  eventDate: string | null;
  thumb: string | null;
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    /**
     * Whatever else came with the refusal.
     *
     * Almost every error in this product is a status and a word, and for a
     * long time that was all this carried. `/api/join` is the exception: a
     * link to a private album is refused *with* the album — its id and its
     * name — because the refusal is a door somebody is meant to knock on, and
     * a door has to say what it is the door to. See `Door.tsx`.
     */
    readonly body: Record<string, unknown> = {},
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
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        [key: string]: unknown;
      };
      throw new ApiError(res.status, body.error ?? 'unknown', body);
    }

    /*
     * A success with no body is still a success.
     *
     * Asking for a sign-in code answers 204 on purpose — it answers the same
     * however it went, so that it cannot be used to ask "does this address
     * have an account?". Parsing that as JSON throws, and the throw came back
     * to the person as "Could not ask for a code. Try again in a moment." on
     * the app's only route to an account: the code had been sent, the error
     * was wrong, and tapping again sent a second one and invalidated the
     * first. Nothing in the request or the response was at fault, which is why
     * no test saw it — found by driving the screen against a real server.
     *
     * Checked on the status rather than by catching a parse error, so a
     * genuinely malformed body from a 200 still fails loudly.
     */
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * All three doors, one endpoint: a pasted link, a scanned QR (which yields
   * the same token) and a spoken code.
   *
   * Three answers now rather than two. It resolves, or it is refused as
   * unknown — or it is refused as `approval_required`, which is a real link to
   * a private album whose creator has not let this person in. That one throws
   * an `ApiError` carrying `{ event: { id, name } }`, and the app draws the
   * door instead of the lie it used to tell ("couldn't find that", to somebody
   * holding the right link).
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
    /** Two values and no others. Omitted means public. */
    accessPolicy?: 'public' | 'private';
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
   * Every event this actor can reach — the home and profile tabs.
   *
   * Membership rather than possession: events they took part in, plus every
   * event in a group they are in. One they opened once from a link a
   * year ago is not somewhere they live.
   */
  async myEvents(): Promise<EventListing[]> {
    const { events } = await this.call<{ events: EventListing[] }>('/api/events');
    return events;
  }

  // --- things waiting on you ---------------------------------------------

  /**
   * Invitations, friend requests, and people asking into an event you run.
   *
   * Empty for a device that has never signed in, which is the common case on
   * first launch and not an error — the endpoint answers a list rather than a
   * 403 for exactly that reason.
   */
  async requests(): Promise<PendingRequest[]> {
    const { requests } = await this.call<{ requests: PendingRequest[] }>('/api/requests');
    return requests;
  }

  /**
   * Answer one, wherever it is answered.
   *
   * The three routes disagree about the word for yes — a host *approves*
   * somebody into an event, where an invitation is *accepted* — and that
   * difference belongs here rather than in the screen, which should only know
   * that somebody pressed the left button or the right one.
   */
  answerRequest(request: PendingRequest, yes: boolean): Promise<unknown> {
    switch (request.kind) {
      case 'invite':
        return this.call(`/api/invites/${request.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ action: yes ? 'accept' : 'decline' }),
        });
      case 'friend':
        return this.call('/api/friends', {
          method: 'PATCH',
          body: JSON.stringify({
            requestId: request.id,
            action: yes ? 'accept' : 'decline',
          }),
        });
      case 'join':
        return this.call(`/api/events/${request.eventId}/access-requests`, {
          method: 'PATCH',
          body: JSON.stringify({
            requestId: request.id,
            action: yes ? 'approve' : 'decline',
          }),
        });
    }
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

  /**
   * Where an event's cover is sent, and with what.
   *
   * A target rather than a method, because the bytes do not go through
   * `fetch` here: a cover is a photograph off the camera roll, and the native
   * uploader streams it from disk instead of reading a few megabytes into
   * JavaScript to hand back to the same OS. `platform.uploadCover` does the
   * sending; this owns the one thing it must not get wrong, which is who the
   * request says it is from.
   */
  /** Take the cover off. The object goes with it — see the route. */
  removeCover(eventId: string): Promise<unknown> {
    return this.call(`/api/events/${eventId}/cover`, { method: 'DELETE' });
  }

  coverTarget(eventId: string): { url: string; headers: Record<string, string> } {
    const headers: Record<string, string> = {
      'content-type': 'image/jpeg',
      'x-parea-client': this.client,
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    return { url: `${this.baseUrl}/api/events/${eventId}/cover`, headers };
  }

  // --- people ----------------------------------------------------------

  /**
   * Somebody, by handle.
   *
   * Prefix-only, ten results, a handle and a name and nothing else — the same
   * narrowness the web search has, because it is the same endpoint. Being
   * findable leads to being able to ask and to nothing further.
   */
  async findPeople(
    query: string,
  ): Promise<{ actorId: string; handle: string | null; displayName: string | null }[]> {
    const { people } = await this.call<{
      people: { actorId: string; handle: string | null; displayName: string | null }[];
    }>(`/api/people?q=${encodeURIComponent(query)}`);
    return people;
  }

  /**
   * One person's page.
   *
   * 404 covers every reason there is not to have one — no such handle, a
   * device that never signed in, a merged actor, either side of a block — so
   * this cannot be used to ask whether somebody exists.
   */
  person(
    handle: string,
  ): Promise<{ person: Person; shared: SharedEvent[]; albums: ProfileAlbum[] }> {
    return this.call(`/api/people/${encodeURIComponent(handle)}`);
  }

  /**
   * Who can see it, changed after the fact.
   *
   * The app could ask this once, on the create screen, and never again — which
   * is the wrong way round: the choice is made in the first thirty seconds,
   * before anybody has been sent anything, and what you want is obvious only
   * once they have. Same endpoint the web's manage screen uses.
   *
   * Tightening evicts nobody. `authorize` reads participation before the
   * policy, so switching to private stops new people rather than removing the
   * ones already in — the screen says so, because "private" sounds like it
   * should mean the opposite.
   */
  setAccessPolicy(eventId: string, accessPolicy: 'public' | 'private'): Promise<unknown> {
    return this.call(`/api/events/${encodeURIComponent(eventId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ accessPolicy }),
    });
  }

  /**
   * Asking to be let into a private album.
   *
   * The other way in is somebody adding you. This is the one that works when
   * nobody sent you anything: the album is on its creator's page, and this is
   * the button under it. The answer is the status now standing, so an ask that
   * repeats one already declined comes back `declined` rather than reopening
   * it.
   */
  askToJoin(eventId: string): Promise<{ status?: string }> {
    return this.call(`/api/events/${encodeURIComponent(eventId)}/access-requests`, {
      method: 'POST',
    });
  }

  /**
   * Asking to be friends.
   *
   * The response says what is now true rather than what was done: an ask that
   * crosses with theirs answers their request instead of opening a second one,
   * and comes back `accepted`.
   */
  askFriend(actorId: string): Promise<{ status?: string }> {
    return this.call('/api/friends', {
      method: 'POST',
      body: JSON.stringify({ actorId }),
    });
  }

  /** Answering one, from their page rather than from the bubble on home. */
  answerFriend(requestId: string, yes: boolean): Promise<unknown> {
    return this.call('/api/friends', {
      method: 'PATCH',
      body: JSON.stringify({ requestId, action: yes ? 'accept' : 'decline' }),
    });
  }

  // --- groups ----------------------------------------------------------
  //
  // See `MyGroupDetail` below for the shape the Groups tab reads.

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
   * The same list, with what a group screen needs to tell two rooms apart.
   *
   * A second call rather than making `myGroups` heavier, because that one
   * happens on every launch — before anybody has opened the Groups tab, and
   * possibly before they are in any groups at all. Three aggregates per row is
   * nothing for a screen somebody asked for and is work nobody asked for at
   * startup.
   */
  async myGroupsDetailed(): Promise<MyGroupDetail[]> {
    const { groups } = await this.call<{ groups: MyGroupDetail[] }>(
      '/api/groups?detail=1',
    );
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

  /**
   * The people this actor keeps ending up in the same events as.
   *
   * Never cached on the device. It is derived from other people's presence at
   * events, it changes whenever anybody joins one, and a stale copy would
   * offer to make a group out of a set that has since become two.
   */
  clusters() {
    return this.call<{ clusters: Cluster[]; also: ClusterPerson[] }>('/api/groups/clusters');
  }

  /**
   * A group made from people rather than from an event.
   *
   * Separate from `createGroup` rather than a widened signature: the two do
   * different things to other people. That one moves an event under a new
   * group and leaves its participants to join in their own time; this one adds
   * everybody in `memberIds` outright and tells them. A single function taking
   * both would make the more consequential of the two the easier to reach by
   * accident.
   */
  createGroupFrom(name: string, memberIds: string[]) {
    return this.call<{ id: string; name: string }>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name, memberIds }),
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
