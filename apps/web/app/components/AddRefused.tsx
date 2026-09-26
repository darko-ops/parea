'use client';

/**
 * Pressing `+` on an album you may not add to.
 *
 * The `+` used to be missing here, and a header with the control simply gone
 * is the page looking broken: the reader can see the album, can talk in it,
 * and cannot work out where the button went. A sentence beside the grid was
 * half the answer, and it is the half nobody reads — somebody arriving to add
 * photographs goes for the `+` in the corner, not for a line of prose above a
 * hundred pictures.
 *
 * So the control is drawn for anybody the server knows by name, and pressing it
 * answers the question it was pressed for: you cannot add to this one, here is
 * why, and here is the one thing to do about it. A refusal that names the rule
 * is a rule; a refusal with no next step is a wall.
 *
 * Signing in is the step in front of all of it and has its own panel in the
 * body of the page — this dialog is about who may add, which is not a question
 * anybody can answer about a reader the server has no name for.
 *
 * ## Two buttons, and what decides whether both are drawn
 *
 * `canAsk` is the server's answer — see `hostingFor` — and not a reading of
 * `contributePolicy`, so an album set to "Only me" says its piece and offers
 * nothing. That is correct rather than a gap: there is no set to join, and a
 * button to ask would make "Only me" something its owner has to keep
 * defending.
 *
 * A declined ask also draws one button. Declined stays declined — a repeat ask
 * comes back declined rather than reopening — and the line reads as the
 * album's rule rather than as a verdict, because telling somebody they were
 * turned down is the host's to do and not the page's. Same reasoning a friend
 * request follows.
 *
 * The one reader who gets a different second button is the one who owns the
 * setting doing the refusing: they are sent to it rather than told to ask
 * themselves for permission. See `canAdminister` below.
 *
 * The dialog itself is `ShareEvent`'s shape, down to the portal: the control
 * that opens it sits in `.album-head`, which has `backdrop-filter` on it and
 * is therefore the containing block for `position: fixed` children — a scrim
 * rendered inside it covers the header and nothing else.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type AskStatus = 'open' | 'approved' | 'declined' | null;

export function AddRefused({
  eventId,
  canAsk,
  canAdminister,
  asked,
  asking = false,
  onAsk,
  onClose,
}: {
  eventId: string;
  /** Whether asking to be a host is a thing that exists on this album. */
  canAsk: boolean;
  /**
   * Whether this reader owns the setting that is refusing them.
   *
   * Which happens: `nobody` is a legacy contribute policy that shut the album
   * to everybody including the person who made it, and the engine still
   * understands it because a value one deployed client knows and the engine
   * does not fails closed on the wrong side of a rollback. Telling that reader
   * that "whoever made the album" decides, when they are whoever made the
   * album, is the page not knowing who it is talking to — so they are sent to
   * the switch instead.
   */
  canAdminister: boolean;
  /** What this reader's last ask left standing. */
  asked: AskStatus;
  /** An ask in flight, so the button says so rather than looking ignored. */
  asking?: boolean;
  onAsk: () => void | Promise<void>;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  /*
   * Focus once the portal exists, not before — the first render returns null,
   * so on the run where this would otherwise have fired `card.current` was
   * still null and the dialog opened without taking focus. That leaves a
   * keyboard user on whatever is behind it, with Escape working by accident.
   */
  useEffect(() => {
    if (mounted) card.current?.focus();
  }, [mounted]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!mounted) return null;

  const pending = asked === 'open';
  /*
   * Already a host, which happens on the press: somebody the host had promoted
   * while this tab sat open asks, and the server answers `approved` rather than
   * queueing it. Said out loud, because the alternative is the dialog falling
   * through to "not open to you" a beat after it became open.
   */
  const allowed = asked === 'approved';
  /** Whether there is anything left to press. See the note at the top. */
  const mayAsk = canAsk && !pending && !allowed && asked !== 'declined';

  return createPortal(
    <div
      className="dialog-scrim"
      // Only a press that both starts and ends on the scrim is a dismissal, so
      // a drag that begins on the card and releases outside does not close it.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label={allowed ? 'You can add to this album' : 'You cannot add photos to this album'}
        tabIndex={-1}
        ref={card}
      >
        <h2>{allowed ? 'You can add to this album' : 'You cannot add photos to this album'}</h2>

        <p className="muted">
          {allowed
            ? 'You are one of this album’s hosts already. Close this and the button works.'
            : pending
              ? 'You have asked, and whoever made the album has not answered yet. You can add photos once they have.'
              : mayAsk
                ? 'Hosts add the photographs here. You can ask to be one — whoever made the album decides, and nothing changes until they do.'
                : canAdminister
                  ? 'This album is set so that nobody adds photographs to it, including you. Who can add is a setting, and it is yours.'
                  : 'Adding is not open to you on this one. Whoever made the album decides who puts photographs in it, and they are the person to ask.'}
        </p>

        {pending && (
          /*
            Not "it is under Invites": that page's asked list is built from
            access requests, and this is a host request — a different table it
            does not read. Pointing somebody at a list their ask is not on is
            worse than saying nothing, so this says where the answer lands
            instead, which is this album.
          */
          <p className="field-help">
            Nothing arrives by email — this button starts working the moment
            they say yes.
          </p>
        )}

        <div className="row">
          {!mayAsk && !pending && !allowed && canAdminister && (
            // The switch itself, rather than a sentence about where it is.
            <a className="button-like primary" href={`/event/${eventId}/manage`}>
              Change who can add
            </a>
          )}
          {mayAsk && (
            <button disabled={asking} onClick={() => void onAsk()}>
              {asking ? 'Asking…' : 'Request access'}
            </button>
          )}
          <button className="secondary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
