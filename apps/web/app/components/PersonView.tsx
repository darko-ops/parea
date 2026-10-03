'use client';

/**
 * A person, laid out the way your own profile is.
 *
 * Deliberately the same page with two things taken out and one put in: no
 * Edit, because it is not yours to edit, and the events are the ones you can
 * both see rather than everything they have. Where Edit sits, the one thing
 * you can do about somebody sits instead — ask to be friends, or answer their
 * asking.
 *
 * Same shape on purpose. Somebody arriving here from a search result has seen
 * their own profile already, and a second layout for the same kind of object
 * means reading the screen before reading the person.
 *
 * ## Their albums, and the door on the locked ones
 *
 * Under the shared events, everything this person has made. A public one is a
 * card that opens; a private one the viewer is not in is a name, a date and
 * "Ask to join" — no cover, because a cover is a photograph out of the album
 * and usually the best one.
 *
 * This is the profile's part of what private means. The other way in is a link
 * somebody sent you; this is the way that works when nobody sent you anything,
 * and it is why the album has to be listed at all. What it does *not* do is
 * say how big it is, who is in it, or when anybody last added to it.
 *
 * ## The events, and the two ways of having none
 *
 * The list is the viewer's own, filtered to the ones this person is also in —
 * see `eventsWithBoth`, where the direction of that sentence is the whole
 * safety property. So an empty list means two quite different things, and it
 * says which:
 *
 *   - **a friend with nothing shared** gets "No albums to show yet", which
 *     is about the two of you and is likely to change;
 *   - **anybody else** gets "Account Private", which is the honest answer to
 *     "why can I not see anything": not that they have nothing, but that what
 *     somebody has made is theirs to send you a link to.
 *
 * Neither says how much is behind the door. "Account Private" over four
 * hundred events and over none reads identically, which is the point.
 *
 * ## Why "Asked" is what a refusal says too
 *
 * `/api/friends` answers a repeat ask with the status it already holds, and a
 * declined one stays declined — "no" is said once rather than becoming
 * something to press past. This screen shows that as "Asked", the same as an
 * open one. Telling somebody they were refused is the refuser's to do; a
 * button that read "Declined" would make the product do it for them, over and
 * over, every time they visited the page.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import type { CardEvent } from '@/cards';
import type { MomentsResponse } from '@/moments';
import type { Standing } from '@/people';

import { Avatar } from './Avatar';
import { CoverImage } from './CoverImage';
import { EventCard } from './EventCard';
import { FrostedGlass } from './FrostedGlass';
import { Menu } from './Menu';
import { MomentStrip } from './MomentStrip';
import { blockAsk, blockName, blockPerson, blockSaid, reportContent, reportSaid } from './report';
import { LinkIcon } from './LinkIcon';

export type ProfileAlbumCard = {
  id: string;
  name: string;
  /** Private, and this viewer is not in it. */
  locked: boolean;
  cover: string | null;
  /** Null on a locked album. */
  photoCount: number | null;
  date: string | null;
  /** The viewer's own ask on a locked one: `open`, `approved`, `declined`, or null. */
  asked: string | null;
};

/**
 * A locked album's cover, which is also how you ask to be let in.
 *
 * Two clicks. The first turns the padlock into "Ask to join" — the roundel
 * runs out into a pill in the same frosted glass, so it reads as the lock
 * answering rather than a label arriving — and the second sends it. One click
 * used to take you off to a separate door page, and a button under every
 * locked album to ask from here was a wall of buttons; this keeps the shelf a
 * shelf, with a date under each album like any other.
 *
 * It POSTs to the route the door page uses, which is where the decision lives:
 * a blocked asker gets that route's 404 and is told nothing more here. What
 * comes back is shown as it came back, for the reason `AskToJoin` gives — a
 * declined ask stays "Requested" rather than offering itself again.
 */
function LockedCover({
  eventId,
  name,
  initial,
  armed,
  onArm,
}: {
  eventId: string;
  name: string;
  initial: string | null;
  /** Whether this one's padlock is showing "Ask to join". One at a time. */
  armed: boolean;
  onArm: (eventId: string | null) => void;
}) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const press = useCallback(async () => {
    if (!armed) {
      setFailed(false);
      onArm(eventId);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/events/${eventId}/access-requests`, { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { status?: string };
      setStatus(body.status ?? 'open');
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
      onArm(null);
    }
  }, [armed, eventId, onArm]);

  /*
   * "Requested" holds until the host answers — the server sends the viewer's
   * own ask back with the album, so it survives a reload too. An approval
   * makes them a participant, and the next load draws the album open; a
   * decline says so, as the door page does, rather than reading "Requested"
   * over an answer that has already come.
   */
  const note =
    status === 'approved'
      ? 'Let in'
      : status === 'declined'
        ? 'Declined'
        : status
          ? 'Requested'
          : armed
            ? 'Ask to join'
            : null;
  // The last words shown, so they stay in the pill while it folds back up.
  const [shown, setShown] = useState(note);
  if (note && note !== shown) setShown(note);

  return (
    <button
      type="button"
      className="album-shut"
      data-album-door={eventId}
      onClick={press}
      disabled={busy || status !== null}
      aria-label={
        status
          ? `${name}, private, ${note!.toLowerCase()}`
          : armed
            ? `Ask to join ${name}`
            : `${name}, private`
      }
      title={failed ? 'Could not ask just now. Try again.' : undefined}
    >
      <FrostedGlass seed={eventId} />
      <span className={note ? 'album-lock is-open' : 'album-lock'} aria-hidden="true">
        <svg
          className="album-lock-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
          <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        </svg>
        <span className="album-lock-note">{shown}</span>
      </span>
    </button>
  );
}

type Person = {
  actorId: string;
  handle: string;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  /** The one link on their profile, with its scheme — see `Profile.link`. */
  link: string | null;
  standing: Standing;
  requestId: string | null;
  /** Their own three totals — see `ProfileCounts`. */
  counts: { albums: number; photos: number; friends: number };
};

export function PersonView({
  person,
  events,
  albums,
  moments,
}: {
  person: Person;
  /** Their moments this viewer may see, newest first. Empty for a stranger. */
  moments: MomentsResponse;
  /** Events the viewer can see that this person is also in. */
  events: CardEvent[];
  /** Everything this person made, minus the ones already drawn above. */
  albums: ProfileAlbumCard[];
}) {
  const [standing, setStanding] = useState<Standing>(person.standing);
  const [busy, setBusy] = useState(false);
  /** The locked album showing "Ask to join", if any. See `LockedCover`. */
  const [armed, setArmed] = useState<string | null>(null);
  /*
   * Anywhere else puts the padlock back. The first click is only a question —
   * "ask to join?" — and a press anywhere but on that same cover is the answer
   * no, so it should not sit there armed waiting for a stray second click.
   * `pointerdown` rather than `click` so it is back before the press lands on
   * whatever else was pressed; Escape for a keyboard.
   */
  useEffect(() => {
    if (!armed) return;
    const away = (event: PointerEvent) => {
      const door = (event.target as Element | null)?.closest?.('[data-album-door]');
      if (door?.getAttribute('data-album-door') !== armed) setArmed(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setArmed(null);
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [armed]);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const router = useRouter();
  /** The `···`'s Block item has been pressed once and is asking. */
  const [sure, setSure] = useState(false);
  /** Blocked from here, and the page is now only the note saying so. */
  const [gone, setGone] = useState(false);

  /*
   * Their name, or their handle standing in for one.
   *
   * Bare either way. The `@` is not decoration on a person — it marks a string
   * as the thing you can type at a search box, which is what it is doing in a
   * list, in a sentence, and on the line directly under this one. In the name
   * slot it is punctuation at the front of somebody's name. The app says the
   * same thing in `nameOf`.
   */
  const name = person.displayName?.trim() || person.handle;

  const ask = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorId: person.actorId }),
      });
      if (!res.ok) throw new Error('Could not send that.');
      const body = (await res.json().catch(() => ({}))) as { status?: string };
      // Accepted happens when they had already asked you and this crossed with
      // it — the endpoint answers the open request rather than opening a second
      // one, and the page should say what is now true.
      setStanding(body.status === 'accepted' ? 'friends' : 'asked');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [person.actorId]);

  /**
   * Taking the ask back.
   *
   * The same button that reports the state, because that is the only reading
   * of a pressable control that reports one — and because withdrawing is the
   * one thing left in the viewer's gift once they have asked. `DELETE` clears
   * the friendship and both open requests between the two actors, so nothing
   * is left behind for the next ask to collide with.
   */
  const unask = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/friends?actorId=${encodeURIComponent(person.actorId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error('Could not take that back.');
      setStanding('none');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [person.actorId]);

  /**
   * Say something to them, from here.
   *
   * The page had one verb on it and it was about a relationship. Wanting to
   * say something to somebody you have just looked up is the more ordinary
   * errand of the two, and until now it sent people to Chats to search for a
   * person they already had open.
   *
   * The same call the Chats tab makes — `POST /api/groups` with one member and
   * no name — because it should be the same room. A second way to start a
   * conversation is how you end up with two kinds of conversation.
   *
   * No confirmation, and nothing to fill in. What it does is open a room where
   * only the two of you can see what is written; nobody is told anything until
   * there is something to tell. Pressing it again lands in the same place —
   * the route hands back the room the two of you already have rather than
   * making another.
   *
   * Into `/group/<id>/chat` rather than the room's page. A room made to talk
   * in opens on the talking — its page is the roster, the albums and the
   * settings, which are things somebody looks up later. This is the same
   * destination the Chats list uses and the same one the app lands on after
   * making a room.
   *
   * `location.href` rather than a router push: the page being left is a server
   * component and the one being opened is somebody else's, and a soft
   * navigation between them buys nothing a chat is waiting on.
   */
  const chat = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memberIds: [person.actorId] }),
      });
      if (!res.ok) throw new Error('Could not start that chat.');
      const group = (await res.json()) as { id: string };
      window.location.href = `/group/${group.id}/chat`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      // Only on the way out. The success path is a navigation, and a button
      // that comes back to life under a page that is leaving is a flicker
      // inviting a second press.
      setBusy(false);
    }
  }, [person.actorId]);

  const answer = useCallback(
    async (action: 'accept' | 'decline') => {
      if (!person.requestId) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/friends', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId: person.requestId, action }),
        });
        if (!res.ok) throw new Error('Could not answer that.');
        setStanding(action === 'accept' ? 'friends' : 'none');
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [person.requestId],
  );

  /**
   * Blocking them, from their own page.
   *
   * Two presses inside the `···`, as leaving a group is: the first says what
   * it costs, the second does it. Afterwards the page is not refreshed in
   * place — across a block this profile is a 404, so a refresh would replace
   * the one sentence saying what just happened with a page saying nobody is
   * here. What is left is that sentence and the way home; the next page is
   * fetched fresh and already without them.
   */
  const block = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSaid(null);
    const result = await blockPerson({ actorId: person.actorId });
    setBusy(false);
    setSure(false);
    if (result.ok) {
      setGone(true);
      return;
    }
    setError(blockSaid(result));
  }, [person.actorId]);

  if (gone) {
    return (
      <section className="person-blocked">
        <p className="photo-said">{blockSaid({ ok: true })}</p>
        <p>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              // Replace, so Back does not land on a profile that is now a 404.
              router.replace('/');
              router.refresh();
            }}
          >
            Back to Home
          </a>
        </p>
      </section>
    );
  }

  return (
    <>
      <header className="you-head">
        {/*
          The picture, hanging from the bar on a phone and standing beside the
          name on a laptop — the same ribbon your own profile has, because it
          is the same page about a different person. See `.you-ribbon`, and
          `AccountView` for what the shape is borrowed from.
        */}
        <div className="you-ribbon">
          {/* A letter until there is a picture, and again if one will not load.
              Never a silhouette: a generic avatar is a photograph of nobody. */}
          <Avatar
            url={person.avatar}
            initial={name.slice(0, 1).toUpperCase()}
          />
        </div>

        <div className="you-id">
          <h1 className="you-name">{name}</h1>
          {/* Always, and not only when there is a display name above it: the
              handle is the durable one and the thing this page is reached by. */}
          <p className="muted you-handle">@{person.handle}</p>
          {person.bio && <p className="you-bio">{person.bio}</p>}
          {/*
            The three their own profile prints, in the same order and the same
            words — counted once by `profileFor` so the app's version of this
            screen cannot disagree with it.

            It used to be one number, counting the *viewer's* shelf, on the
            argument that their own totals would make search a way to measure
            strangers. The albums below undid that argument: every one they
            made is already listed by name, locked included, so the count says
            nothing the page has not.
          */}
          <p className="you-counts">
            <span>
              {person.counts.albums} {person.counts.albums === 1 ? 'roll' : 'rolls'}
            </span>
            <span>
              {person.counts.photos} {person.counts.photos === 1 ? 'photo' : 'photos'}
            </span>
            {/* Their friends, a tap away, as yours are on your own profile.
                Not a link at zero: there is nobody behind it to show. */}
            {person.counts.friends > 0 && person.handle ? (
              <a
                className="you-friends"
                href={`/u/${encodeURIComponent(person.handle)}/friends`}
              >
                {person.counts.friends} {person.counts.friends === 1 ? 'friend' : 'friends'}
              </a>
            ) : (
              <span>
                {person.counts.friends} {person.counts.friends === 1 ? 'friend' : 'friends'}
              </span>
            )}
          </p>
          {/*
            The one link they put on their profile, under the counts.

            With the facts rather than under the bio, which is where the app
            puts it and for the same reason: the line above is what this person
            has, and an address is the same kind of thing. Under the bio it
            would read as a footnote to their sentence.

            Shown without its scheme — `https://` in front of a domain is four
            characters of protocol on a page about a person — while the `href`
            keeps it, because a scheme-less href is a path on this site.

            `nofollow ugc` because somebody else wrote it and this page is not
            an endorsement; `noopener noreferrer` and a new tab because their
            profile should still be behind you when you come back. The value is
            safe to put here without a second check: `PATCH /api/account`
            refuses anything that is not http or https, and stores what it
            parsed.
          */}
          {person.link && (
            <p className="you-link">
              <LinkIcon />
              <a href={person.link} target="_blank" rel="nofollow ugc noopener noreferrer">
                {person.link.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            </p>
          )}
        </div>

        {/*
          Where Edit and Share sit on your own: two controls, the same size and
          the same weight as each other.

          There were three, and the first was Share. It went, and the argument
          it used to carry is the argument against it: a browser has this
          page's address in the bar above, so a button that copies it is the
          page offering to do something the reader can already see how to do —
          and it was taking a third of a row whose other two are the things
          that only this page can do. The app never had it here either. Your
          own profile keeps it, where it is how you hand out a link to a page
          nobody can look up.

          What is left is uniform on purpose. Chat and the friend control are
          the same bordered pill at the same size, because they are the two
          halves of one question — what do you want to do about this person —
          and a filled button beside an outlined one answers it for the reader.
        */}
        <div className="you-act">
          {/*
            Chat first, the friend decision second.

            Last is where the decision goes: the friend control is the one that
            changes what the two of you are to each other, and it should stay
            the thing the row reads towards. Chat changes nothing; it just
            opens a room.

            Offered whatever standing says. You do not have to be somebody's
            friend to say something to them — the page is reachable, which
            already means neither of you has blocked the other — and a Chat
            button that appeared only after an accepted request would make
            asking to be friends the way to send a message.
          */}
          <button type="button" className="secondary small" disabled={busy} onClick={chat}>
            Chat
          </button>
          {/*
            Friends, worn as a label and shaped like the button beside it.

            It was a `pip` — a small rounded chip, 12.5px, next to a 13px
            pill with a border — so a friend's profile showed two controls
            that had nothing in common but their row. There is still nothing
            to press here, and that is said by it not pressing rather than by
            it being a different kind of object.
          */}
          {standing === 'friends' && <span className="you-state">Friends</span>}
          {/*
            "Requested", and pressing it withdraws.

            It was a flat `pip` reading "Asked" — a state worn rather than
            offered — which left the one thing the viewer could still do about
            an open request with nowhere to be done from: the only way out was
            for the other person to answer. The word went with it. "Asked" is
            the past tense of what you did; "Requested" is the state it left
            you in, which is what a control standing for a state should say.

            A declined ask still reads the same as an open one, and still
            should: `/api/friends` answers a repeat with the status it holds,
            and telling somebody they were refused is the refuser's to do.
            Pressing this on a declined one clears the row, which is the same
            thing withdrawing does and no more than the page already implies.
          */}
          {standing === 'asked' && (
            <button
              type="button"
              className="secondary small"
              disabled={busy}
              onClick={unask}
              aria-label="Requested. Press to take your request back"
            >
              Requested
            </button>
          )}
          {/* The same pill as Chat. It was the one filled control on the row,
              which made the other two read as its alternatives rather than as
              two things you can do. */}
          {standing === 'none' && (
            <button type="button" className="secondary small" disabled={busy} onClick={ask}>
              Add friend
            </button>
          )}
          {standing === 'asking' && (
            <div className="row">
              <button
                type="button"
                className="small"
                disabled={busy}
                onClick={() => answer('accept')}
              >
                Accept
              </button>
              <button
                type="button"
                className="secondary small"
                disabled={busy}
                onClick={() => answer('decline')}
              >
                Decline
              </button>
            </div>
          )}
          {/*
            Report, behind a `···` after the two that matter — the photograph's
            idiom: reachable in one press, not a third pill on the row. What it
            covers is what this page shows of them: the name, the picture, the
            bio and the link. Never on yourself, which this page never is.

            Block under it, asking first — see `block`.
          */}
          {standing !== 'self' && (
            <Menu label="More about this person" glyph="···" tone="quiet" align="right">
              {(close) => (
                <>
                  <button
                    role="menuitem"
                    onClick={async () => {
                      close();
                      setSure(false);
                      setSaid(reportSaid(await reportContent('profile', person.actorId)));
                    }}
                  >
                    Report
                  </button>
                  {sure && <p className="menu-note">{blockAsk(blockName(name))}</p>}
                  <button
                    role="menuitem"
                    className="menu-danger"
                    disabled={busy}
                    onClick={() => {
                      if (!sure) {
                        setSure(true);
                        return;
                      }
                      close();
                      void block();
                    }}
                  >
                    {sure ? `Yes, block ${blockName(name)}` : `Block ${blockName(name)}`}
                  </button>
                </>
              )}
            </Menu>
          )}
        </div>
      </header>

      {(error ?? said) && <p className="panel-note">{error ?? said}</p>}

      {/* Theirs, newest first — the same tiles as Home's stream, and pressing
          one steps through only this person's. */}
      <MomentStrip
        moments={moments.moments}
        at={moments.at}
        by={person.handle}
        label={`Moments from ${name}`}
      />

      {events.length > 0 && (
        <section className="you-events">
          <div className="you-events-head">
            <h2>Rolls</h2>
          </div>
          <div className="cards">
            {events.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      )}

      {albums.length > 0 && (
        <section className="you-events">
          <div className="you-events-head">
            <h2>{events.length > 0 ? 'Their other rolls' : 'Rolls'}</h2>
          </div>
          {/*
            What the padlocks are for, said once above them rather than per
            card. A wall of shut doors is a page that reads as a refusal; the
            sentence is what turns it into a queue. Only while there is
            something shut and a way to open it — a friend reading this would
            be told to do a thing they have already done.
          */}
          {standing !== 'friends' && albums.some((album) => album.locked) && (
            <p className="muted person-locked-note">
              Become friends to see what&rsquo;s inside.
            </p>
          )}
          {/*
            The grid the rest of the product draws albums in.

            These were rows: a 52px thumbnail, a name, a line, in a bordered
            panel. The argument for that was the locked ones — half of a
            stranger's shelf is albums with no photograph to show, and a card
            with nothing in it looks like a picture that failed to load.

            The phone answered that a while ago and this page did not follow.
            A locked album there is not an empty tile, it is a *shut* one:
            hatched, with the padlock an album's own header wears. So the
            reason for rows was never the shape, it was the missing state —
            and the missing state has a drawing.

            What is left is a profile that laid its albums out one way while
            your own laid the same objects out another, on a desk where the
            difference is four across against a column of rows. `.cards` is
            the same grid your own profile and the home page use, so the shelf
            is the same shelf wherever somebody meets it.
          */}
          <ul className="cards album-shelf">
            {albums.map((album) => {
              // A locked album is not a link — see the note below.
              const Card = album.locked ? 'div' : 'a';
              return (
                <li key={album.id}>
                  {/*
                    An open album is a link to itself. A locked one is not a link
                    at all: its one action is the button under it, and a picture
                    that also asked — or went somewhere else to ask — was two
                    ways of doing one thing, one of them by accident.
                  */}
                  <Card
                    className="card"
                    {...(album.locked ? {} : { href: `/event/${album.id}` })}
                  >
                    <div className="card-cover">
                      {/*
                        `CoverImage` rather than a bare `<img>`, for the reason
                        the cards above use it: a cover is presigned for an hour,
                        so a tab left open long enough is holding a URL that has
                        expired, and the browser's answer to that is the
                        broken-image glyph in the middle of every card. It
                        removes itself instead and leaves the cover's own flat
                        rectangle.

                        One source and no `sources`: a cover object is a JPEG,
                        and there is nothing for a browser to choose between.
                      */}
                      {album.cover && <CoverImage src={album.cover} sources={[]} />}
                      {/*
                        A shut album is not an empty one.

                        Colour behind frosted glass, seeded by the album, with
                        the padlock an album's own header wears — the same pane
                        the phone draws — so a card with no photograph in it
                        reads as something lit that you cannot see into rather
                        than as a photograph that failed to arrive. An unlocked
                        album with no cover yet keeps the flat rectangle: nothing
                        is being withheld there.
                      */}
                      {album.locked && (
                        <LockedCover
                          eventId={album.id}
                          name={album.name}
                          initial={album.asked}
                          armed={armed === album.id}
                          onArm={setArmed}
                        />
                      )}
                    </div>
                    {/*
                      The two lines an event card carries, in the same place and
                      at the same size — the name, and one line of fact under it.
                      No faces row: who is in somebody's album is that album's to
                      disclose, and on the locked ones there is nothing to
                      disclose it from.
                    */}
                    <div className="card-under">
                      <div className="card-name">{album.name}</div>
                      <div className="card-meta">
                        {/*
                          A date on a locked one too, like every album beside
                          it — it is safe, and the ask lives on the cover now.
                        */}
                        {album.locked
                          ? album.date
                          : [
                              album.date,
                              album.photoCount === null
                                ? null
                                : `${album.photoCount} ${album.photoCount === 1 ? 'photo' : 'photos'}`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {events.length === 0 && albums.length === 0 && (
        /*
          One empty state now, where there were two.

          "Account Private" was the honest answer when a profile listed nothing
          a stranger was not already in: not that they have nothing, but that
          what somebody has made is theirs to send you a link to. Albums are
          listed now, so that sentence would be a lie — the page has just shown
          you everything they made, and there was none of it.
        */
        <section className="you-events">
          <p className="muted person-empty">
            {standing === 'friends' ? 'No rolls to show yet' : 'Nothing here yet'}
          </p>
        </section>
      )}
    </>
  );
}
