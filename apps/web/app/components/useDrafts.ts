'use client';

/**
 * Your drafts in this roll — see `src/drafts.ts` on the server.
 *
 * A draft the queue in this tab is still working on is left out: it already
 * has a tile, drawn from the file in hand, and two tiles for one photograph
 * would be one too many. What is left is what this tab cannot see for itself —
 * an upload from another device, one from before a reload, one swept a day
 * after it stopped.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

export type DraftState = 'sending' | 'processing' | 'failed' | 'needs_file';

export type Draft = {
  id: string;
  state: DraftState;
  mime: string;
  size: number;
  addedAt: string;
  capturedAt: string | null;
  reason: string | null;
};

export type DraftsView = {
  drafts: Draft[];
  /** Ask again — after a run, a retry or a removal. */
  reload(): void;
  /** Try again from what the server holds. False when the photo has to be chosen again. */
  retry(id: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  busy: string | null;
};

export function useDrafts(eventId: string, localPhotoIds: ReadonlySet<string>, settledKey: unknown): DraftsView {
  const [all, setAll] = useState<Draft[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    fetch(`/api/events/${eventId}/drafts`)
      .then((res) => (res.ok ? res.json() : { drafts: [] }))
      .then((body: { drafts?: Draft[] }) => {
        if (!cancelled) setAll(body.drafts ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [eventId, tick, settledKey]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const retry = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        const res = await fetch(`/api/photos/${id}/draft`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        });
        if (res.status === 409) return false;
        return true;
      } catch {
        return true;
      } finally {
        setBusy(null);
        reload();
      }
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      setBusy(id);
      setAll((list) => list.filter((d) => d.id !== id));
      await fetch(`/api/photos/${id}/draft`, { method: 'DELETE' }).catch(() => {});
      setBusy(null);
      reload();
    },
    [reload],
  );

  const drafts = useMemo(() => all.filter((d) => !localPhotoIds.has(d.id)), [all, localPhotoIds]);
  return { drafts, reload, retry, remove, busy };
}
