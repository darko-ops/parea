'use client';

/**
 * A cluster of people, and the group it could become — one card, two states.
 *
 * ## Why this is a recognition and not a suggestion
 *
 * `/groups` used to refuse to offer a create action at all, and the reasoning
 * was sound: a bare `New group` on an empty page produces a named room with
 * nobody in it, which is a distribution problem with no photographs in it. What
 * makes creation safe here is what sits beside the button — the people the
 * actor keeps ending up in the same events as. The page is not proposing
 * anything it knows better than they do; it is showing them something they
 * already did, and offering to name it.
 *
 * That is why the copy never says you *have* groups, never counts clusters as
 * if they were groups, and never uses a second word ("roll up") for something
 * people already understand as making a group with these people.
 *
 * ## Nothing is written until Create
 *
 * Pressing `Make a group` swaps this card for the form and that is all it does:
 * no row, no notification, no request. Taking somebody out of the list tells
 * them nothing. Navigating away loses nothing, because there was nothing.
 *
 * This is the property that makes suggesting a cluster acceptable rather than
 * presumptuous, so it is worth stating plainly: **the only call this component
 * makes is the one behind `Create group`.**
 *
 * ## The consent line goes above the button
 *
 * Creating from people writes memberships outright rather than invitations —
 * everyone listed already has the photographs from the events the cluster came
 * from. That is a real thing to do to somebody, so the sentence saying it is in
 * the instruction above the chips, where it is read before the decision, and
 * not in a confirmation afterwards.
 */

import { useCallback, useMemo, useState } from 'react';

import { Face } from './Faces';

export type ClusterPerson = { actorId: string; name: string; avatarUrl: string | null };

export type ClusterCard = {
  key: string;
  personIds: string[];
  faces: { name: string; avatarUrl: string | null }[];
  moreFaces: number;
  names: string;
  sharedEventCount: number;
  suggestedName: string | null;
};

/** Chips shown before the rest collapse behind `+N more`. */
const CHIPS_SHOWN = 6;

function firstNameOf(name: string): string {
  return name.replace(/^@/, '').split(/\s+/)[0] || name;
}

/**
 * The card in its resting state, and the form it becomes.
 *
 * `people` is every member of the cluster with a name and a face, which the
 * form needs for its chips; the resting card only draws the first few. `also`
 * is the add row — people the actor shares exactly one event with.
 *
 * `primary` is one per page: the first card gets a filled button and the rest
 * are outlined. Passed in rather than worked out here, because "first" is a
 * fact about the list and this component only knows about itself.
 */
export function CreateGroupCard({
  cluster,
  people,
  also,
  primary = false,
  small = false,
  startOpen = false,
  onCancel,
}: {
  cluster: ClusterCard | null;
  people: ClusterPerson[];
  also: ClusterPerson[];
  primary?: boolean;
  small?: boolean;
  /** Opens straight into the form — the "make a group from anyone" path. */
  startOpen?: boolean;
  /** Only for a card that has no resting state to go back to. */
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState(cluster?.suggestedName ?? '');
  const [picked, setPicked] = useState<ClusterPerson[]>(people);
  const [extra, setExtra] = useState<ClusterPerson[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(() => [...picked, ...extra], [picked, extra]);
  const offered = useMemo(
    () => also.filter((person) => !chosen.some((p) => p.actorId === person.actorId)),
    [also, chosen],
  );

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: trimmed,
          memberIds: chosen.map((person) => person.actorId),
        }),
      });
      if (!res.ok) throw new Error('That did not go through. Try again in a moment.');
      const group = (await res.json()) as { id: string };
      // The room, not back to the list: the next thing anybody wants is to put
      // an event in it, and that button is on the group's own page.
      window.location.href = `/group/${group.id}`;
    } catch (err) {
      // The form keeps everything it had. Somebody who just chose eleven people
      // is not being asked to choose them again.
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }, [name, chosen]);

  if (!open && cluster) {
    return (
      <div className={`cluster${small ? ' cluster-small' : ''}`}>
        <span className="cluster-faces" aria-hidden="true">
          {cluster.faces.map((person, i) => (
            <Face
              key={i}
              src={person.avatarUrl}
              size={small ? 30 : 36}
              className="cluster-face"
              fallback={<span>{person.name.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>}
            />
          ))}
          {cluster.moreFaces > 0 && (
            <span className="cluster-face cluster-face-more">+{cluster.moreFaces}</span>
          )}
        </span>

        <span className="cluster-what">
          <span className="cluster-names">{cluster.names}</span>
          {/*
            The count and nothing else. The moment this line names an event it
            starts to look like a suggestion derived from that one event rather
            than from the people, which is the opposite of what the card says.
          */}
          <span className="cluster-meta">
            Together in {cluster.sharedEventCount}{' '}
            {cluster.sharedEventCount === 1 ? 'event' : 'events'}
          </span>
        </span>

        <button
          type="button"
          className={`cluster-make${primary ? ' cluster-make-primary' : ''}`}
          onClick={() => setOpen(true)}
        >
          Make a group
        </button>
      </div>
    );
  }

  const shown = expanded ? chosen : chosen.slice(0, CHIPS_SHOWN);
  const hidden = chosen.length - shown.length;

  return (
    <div className="cluster cluster-form">
      <label className="cluster-label" htmlFor={`group-name-${cluster?.key ?? 'anyone'}`}>
        Name
      </label>
      <input
        id={`group-name-${cluster?.key ?? 'anyone'}`}
        className="cluster-name"
        type="text"
        value={name}
        maxLength={80}
        placeholder="Name the group"
        // Selected rather than merely filled, so the first keystroke replaces
        // the suggestion instead of appending to it.
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setName(e.target.value)}
      />
      {cluster?.suggestedName && (
        <p className="cluster-hint">
          Suggested from the event you were all at — change it to anything.
        </p>
      )}

      <div className="cluster-who">
        <div className="cluster-label-row">
          <span className="cluster-label">Who is in it</span>
          {picked.length > 0 && (
            <span className="cluster-count">— {picked.length} preselected</span>
          )}
        </div>
        <p className="cluster-hint">
          Tap to take somebody out. They are told when the group is made, and can
          add photos without being invited again.
        </p>

        <div className="cluster-chips">
          {shown.map((person) => (
            <button
              key={person.actorId}
              type="button"
              className="cluster-chip cluster-chip-on"
              aria-pressed={true}
              onClick={() => {
                setPicked((list) => list.filter((p) => p.actorId !== person.actorId));
                setExtra((list) => list.filter((p) => p.actorId !== person.actorId));
              }}
            >
              <Face
                src={person.avatarUrl}
                size={26}
                className="cluster-chip-face"
                fallback={<span>{person.name.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>}
              />
              {firstNameOf(person.name)}
              <span aria-hidden="true" className="cluster-chip-x">
                ×
              </span>
              <span className="visually-hidden">, take out</span>
            </button>
          ))}
          {hidden > 0 && (
            /*
              Eleven chips at full size push the button below the fold, which
              is the one place it must not be — the count and the consent line
              are above it.
            */
            <button
              type="button"
              className="cluster-chip cluster-chip-more"
              onClick={() => setExpanded(true)}
            >
              +{hidden} more
            </button>
          )}
        </div>

        {offered.length > 0 && (
          <>
            <p className="cluster-hint cluster-add-lead">
              Add somebody who was not at those events
            </p>
            <div className="cluster-chips">
              {offered.map((person) => (
                <button
                  key={person.actorId}
                  type="button"
                  className="cluster-chip"
                  aria-pressed={false}
                  onClick={() => setExtra((list) => [...list, person])}
                >
                  <Face
                    src={person.avatarUrl}
                    size={26}
                    className="cluster-chip-face"
                    fallback={
                      <span>{person.name.replace(/^@/, '').slice(0, 1).toUpperCase()}</span>
                    }
                  />
                  {firstNameOf(person.name)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="cluster-actions">
        {error && <p className="cluster-error">{error}</p>}
        <button
          type="button"
          className="cluster-create"
          disabled={busy || name.trim().length === 0}
          onClick={create}
        >
          {busy ? 'Making…' : 'Create group'}
        </button>
        <button
          type="button"
          className="cluster-cancel"
          onClick={() => {
            // Back to exactly the card it grew from. Nothing was persisted, so
            // there is nothing to undo — only state to put back.
            setName(cluster?.suggestedName ?? '');
            setPicked(people);
            setExtra([]);
            setExpanded(false);
            setError(null);
            if (cluster) setOpen(false);
            onCancel?.();
          }}
        >
          Cancel
        </button>
        <span className="cluster-live">
          {chosen.length + 1} {chosen.length + 1 === 1 ? 'person' : 'people'}
        </span>
      </div>
    </div>
  );
}

/**
 * The quiet way in: the same form, with nobody preselected.
 *
 * A text link rather than a second button, and deliberately below the cards.
 * There is one primary path on this page — confirming a set of people who
 * already exist — and a create-from-nothing control given equal weight would
 * turn a one-tap recognition back into a form somebody has to fill in.
 *
 * It exists at all because the page must not be a dead end now that creation
 * is possible: somebody with a person in mind who is not in either cluster
 * would otherwise have nowhere to go.
 */
export function MakeFromAnyone({
  also,
  compact = false,
}: {
  also: ClusterPerson[];
  /** The header's `New group` on a page that already has a list. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <CreateGroupCard
        cluster={null}
        people={[]}
        also={also}
        startOpen
        onCancel={() => setOpen(false)}
      />
    );
  }

  if (compact) {
    return (
      <button type="button" className="groups-new" onClick={() => setOpen(true)}>
        New group
      </button>
    );
  }

  return (
    <p className="cluster-anyone">
      Somebody else in mind?{' '}
      <button type="button" className="link-like" onClick={() => setOpen(true)}>
        Make a group from anyone
      </button>{' '}
      — same form, nobody preselected.
    </p>
  );
}
