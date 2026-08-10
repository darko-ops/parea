/**
 * The API client — docs/design.md §1.
 *
 * "Two clients, one protocol." Every call here has a web counterpart hitting
 * the same endpoint; nothing is native-only. The single difference is how
 * identity travels: the web has a cookie, this sends the same signed value as
 * a bearer token out of the keychain.
 */

import type { PresignRequest, PresignResponse } from './queue';

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
  src: string;
  full: string;
  takenAt: string;
  mine: boolean;
};

export type Feed = {
  event: { id: string; name: string; uploadsOpen: boolean; canAdminister: boolean };
  contributors: number;
  count: number;
  photos: FeedPhoto[];
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

    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
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
  download(eventId: string, linkToken: string) {
    return this.call<{ url: string; count: number; totalBytes: number }>(
      `/api/events/${eventId}/download`,
      { method: 'POST', body: JSON.stringify({ linkToken }) },
    );
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
