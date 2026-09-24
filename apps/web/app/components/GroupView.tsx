'use client';

/**
 * A group — the running archive its docstring always claimed it was.
 *
 * What it actually was: a create form, then four bare blue links with a raw
 * ISO date beside each, then a Leave button loose in the footer. Three things
 * wrong with that, and they compound.
 *
 * The form was **first**, so a room whose whole premise is that something has
 * already happened here opened by asking you to type. It is a header button
 * now, and the form it opens is the same one field it always was.
 *
 * The archive was a list of words in a product whose subject is photographs.
 * Each event is a row with its picture, who is in it, how much of it there is
 * and when — under month headings, because an archive is read by when.
 *
 * And the people were a number. `11 members` on the screen whose entire
 * premise is that the same people keep turning up. They are faces now, with
 * the premise said once beside them.
 *
 * ## The non-member door
 *
 * Unchanged in substance and deliberately so. Somebody who is not in the group
 * learns its name and its size and nothing else — no faces, no event count, no
 * covers — because that is what `findable` means. The copy is verbatim.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';

import type { GroupEvent, GroupPerson, JoinRequest } from '@/groups';

import { Face } from './Faces';
import { GroupChat } from './GroupChat';
import { MemberPicker, nameOf, type Person } from './MemberPicker';
import { RailIcon, type RailGlyph } from './RailIcon';
import { Menu } from './Menu';
import { SiteFooter } from './SiteFooter';
import { useImageFailure } from './useImageFailure';

type GroupData = {
  id: string;
  name: string;
  memberCount: number;
  member: boolean;
  role: 'member' | 'admin' | null;
  canJoinDirectly: boolean;
  /** Empty for a non-member — the door is handed nothing from inside. */
  events: GroupEvent[];
  people: GroupPerson[];
  /** The tile's colour, decided on the server so both screens agree. */
  lens: { fill: string; ink: string };
  /** "Fri 14 Mar" per event id, formatted on the server for the same reason. */
  dates: Record<string, string>;
  /**
   * "Mar 2026" — when the room started, worded on the server.
   *
   * A month and a year rather than a date: a group is not an event and does
   * not have a day. Null for a non-member, who is told a name and a size and
   * nothing else; the door does not draw this line.
   */
  since: string | null;
  /**
   * Who is waiting to be let in. Empty for anybody who is not an admin — and
   * empty because the page never fetched them, not because this hides them.
   */
  requests: JoinRequest[];
};

/**
 * Which pane is showing, and it is the URL rather than state.
 *
 * `?tab=` for the reason an album's three tabs use one: a link to the room's
 * people is a link somebody can send, and Back is the way out of it.
 */
export type GroupTab = 'albums' | 'chat' | 'people';

/*
 * The three, with the app's own drawings beside them.
 *
 * Glyph *and* word, where the app's segmented control is glyph-only: a phone
 * has three tabs across 393 points and a browser has a row with room in it,
 * and a word that fits is a word worth keeping. What matters is that the
 * picture is the same picture — `bubbles` for a room where people are talking
 * to each other, against the single `bubble` an album's comments carry.
 */
const TABS: [GroupTab, string, RailGlyph][] = [
  ['albums', 'Albums', 'photos'],
  ['chat', 'Chat', 'bubbles'],
  ['people', 'People', 'groups'],
];

export function GroupView({ group, tab }: { group: GroupData; tab: GroupTab }) {
  const [busy, setBusy] = useState(false);
  /**
   * The queue, as the screen currently has it.
   *
   * Local, because an answered request has to leave the list the moment it is
   * answered — the alternative is a row somebody has already approved sitting
   * there with its buttons live until a reload, which invites the second press
   * that the server then refuses.
   *
   * Seeded from the server and never refetched here. `router.refresh` at the
   * end of a decision is what brings the new member into the strip below, and
   * it re-renders this component with a queue that no longer holds the row —
   * so the two agree rather than one of them having to be reconciled.
   */
  const [queue, setQueue] = useState<JoinRequest[]>(group.requests);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [requested, setRequested] = useState(false);
  /** The create form, which is a panel under the header rather than the page. */
  const [creating, setCreating] = useState(false);
  /** The invite panel, and who is picked in it. Admins only — see the route. */
  const [inviting, setInviting] = useState(false);
  const [picked, setPicked] = useState<Person[]>([]);
  const [asked, setAsked] = useState<number | null>(null);

  /**
   * Sending the guest list.
   *
   * One call for the whole selection rather than one per person, matching the
   * event path — and the answer is a count rather than a per-person result,
   * because a per-person answer would report whether each one has blocked you.
   *
   * The panel stays open and says how many went. It does not optimistically
   * add anybody to the strip above: nobody is in the group yet, and drawing
   * them there would be the screen asserting a membership the server has
   * deliberately not written.
   */
  const invite = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${group.id}/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actorIds: picked.map((person) => person.actorId) }),
      });
      if (!res.ok) throw new Error('Could not ask them.');
      const { invited } = (await res.json()) as { invited: number };
      setAsked(invited);
      setPicked([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [group.id, picked]);

  /**
   * Answering one of them.
   *
   * The row goes as soon as the server has said so, and not before: an
   * optimistic removal would take somebody off the screen and leave them
   * waiting if the call failed, which is the one outcome an admin would never
   * find out about. So it is removed after, and the error stays on the page
   * with the row still in it if anything goes wrong.
   *
   * `router.refresh()` rather than a reload, and only on approve: approving
   * writes a membership, so the faces below and the count beside them are now
   * wrong, and a full reload would throw away the tab, the scroll and the
   * create form if it happened to be open. Declining changes nothing anybody
   * can see except this row.
   */
  const answer = useCallback(
    async (requestId: string, action: 'approve' | 'decline') => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/groups/${group.id}/requests`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ requestId, action }),
        });
        if (!res.ok) throw new Error('Could not answer that. Try again.');
        setQueue((waiting) => waiting.filter((request) => request.id !== requestId));
        if (action === 'approve') router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [group.id, router],
  );

  const join = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/groups/${group.id}/members`, { method: 'POST' });
      if (res.ok) {
        window.location.reload();
        return;
      }
      // Not someone who has been to one of its events: they have to ask.
      const asked = await fetch(`/api/groups/${group.id}/requests`, { method: 'POST' });
      if (!asked.ok) throw new Error('Could not ask to join.');
      setRequested(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [group.id]);

  const createEvent = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      try {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: newName, groupId: group.id }),
        });
        if (!res.ok) throw new Error('Could not create it.');
        const created = (await res.json()) as { url: string };
        window.location.href = created.url;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      }
    },
    [group.id, newName],
  );

  if (!group.member) {
    /*
     * The door. A card with the name and the size on it, and nothing from
     * inside — no faces, no events, no covers. That is not a styling
     * restriction, it is what `findable` promises: a findable group discloses
     * that it exists and how big it is so somebody can ask to come in.
     */
    return (
      <main className="group-page">
        <div className="door">
          <span
            className="group-tile door-tile"
            style={{ background: group.lens.fill, color: group.lens.ink }}
            aria-hidden="true"
          >
            {group.name.trim().slice(0, 1).toUpperCase()}
          </span>
          <h1>{group.name}</h1>
          <p className="door-size">
            {group.memberCount} {group.memberCount === 1 ? 'member' : 'members'}
          </p>
          {requested ? (
            <p className="door-said">
              Asked to join. Someone who runs this group will decide.
            </p>
          ) : (
            <>
              <p className="door-said">
                You can see that this group exists. You cannot see its photos
                until you are in it.
              </p>
              <button className="door-go" onClick={join} disabled={busy}>
                {group.canJoinDirectly ? 'Join' : 'Ask to join'}
              </button>
            </>
          )}
          {error && <p className="door-said">{error}</p>}
        </div>
        <SiteFooter />
      </main>
    );
  }

  /** Where a tab points. Albums is the bare path, like an album's photographs. */
  const hrefFor = (id: GroupTab) =>
    id === 'albums' ? `/group/${group.id}` : `/group/${group.id}?tab=${id}`;

  return (
    <main className="group-page">
      {/* The list page is new, so the way back to it is drawn rather than
          assumed — this screen used to be reachable only from a link. Named
          for what that page now is: a crumb reading `Groups` over a rail row
          reading `Groupchats` is two names for one destination. */}
      <nav className="crumbs" aria-label="Where you are">
        <a href="/groups">Groupchats</a>
        <span aria-hidden="true">{'›'}</span>
        <span className="crumbs-here">{group.name}</span>
      </nav>

      <header className="group-head">
        <span
          className="group-tile group-head-tile"
          style={{ background: group.lens.fill, color: group.lens.ink }}
          aria-hidden="true"
        >
          {group.name.trim().slice(0, 1).toUpperCase()}
        </span>
        <div className="group-head-text">
          <h1>{group.name}</h1>
          {/*
            How much is in here, and how long it has been going — the app's
            own line, and the two halves of it are a decision each.

            The member count used to be the first half and is not, because the
            People tab says it better: eleven faces with names under them is
            what "11 people" was standing in for, one tab away. What a count
            cannot say is *since March 2024*, and a group's age is most of
            what makes it read as a room rather than as a list.

            `· you run this` went with it. An admin is told they are one by
            the things only an admin is shown — the Invite slot beside the
            faces — rather than by a clause on a line about how big the room
            is, which is what the app does and what this file had invented.
          */}
          {group.member && (
            <p className="group-head-meta">
              {group.events.length} {group.events.length === 1 ? 'album' : 'albums'}
              {group.since && ` · since ${group.since}`}
            </p>
          )}
        </div>
        <div className="group-actions">
          {/*
            One item, and no "Manage group" beside it.

            The handoff asks for one for an admin, and there is no such screen:
            `/group/<id>` is the only group route this product has. A menu item
            leading to a 404 is worse than a menu with one thing in it, and
            building the screen is a separate ticket — group membership is
            opt-in by design, so "manage" would have to answer who may remove
            somebody and whether that is the same power as approving a join.
          */}
          <Menu label="More about this group" glyph="···" tone="round">
            {(close) => (
              <>
                {/*
                  Leaving is in the menu rather than loose in the page, which
                  is where it was. A destructive action sitting in the open at
                  the foot of a screen is one somebody presses while reaching
                  for something else — and the note under the archive is what
                  makes it safe to hide, because it says what leaving costs.
                */}
                <button
                  className="menu-danger"
                  onClick={async () => {
                    close();
                    await fetch(`/api/groups/${group.id}/members`, { method: 'DELETE' });
                    window.location.href = '/groups';
                  }}
                >
                  Leave this group
                </button>
              </>
            )}
          </Menu>
        </div>
      </header>

      {/*
        Three tabs, and the same three an album has.

        A room and an evening are the same kind of object to somebody reading
        — a thing with pictures in it, a conversation about them, and the
        people it belongs to — and drawing them two ways makes a reader learn
        the product twice. The app reached this first; this is the same screen.
      */}
      <div className="group-tabrow">
        <nav className="event-tabs" aria-label="This group">
          {TABS.map(([id, label, glyph]) => (
            <a
              key={id}
              href={hrefFor(id)}
              className={`event-tab${tab === id ? ' event-tab-on' : ''}`}
              aria-current={tab === id ? 'page' : undefined}
            >
              <RailIcon glyph={glyph} weight={tab === id ? 2.5 : 2} />
              {label}
              {/*
                The same pip an album's Comments tab carries, about the same
                kind of fact: something on this tab is waiting on you. Without
                it an admin has to open People to find out there is nothing
                there, which is the state it is in almost every day.
              */}
              {id === 'people' && queue.length > 0 && (
                <span className="event-tab-count">{queue.length}</span>
              )}
            </a>
          ))}
        </nav>

        {/*
          The one thing this room does that is not looking at it, at the end
          of the tab row — which is the app's own answer and the album
          screen's.

          It was `New album here`, a worded button up in the head beside the
          name. Two problems with it there: the head is the room's identity
          and a control in it competes with the name for the line, and the
          word was the only piece of type on the screen making a claim about
          what pressing it does when the `+` everywhere else in the product
          says the same thing in a glyph. The label survives as the accessible
          name, which is the trade the tab bar makes for all four of its tabs.

          Pinned above the pane rather than at the foot of the albums: the
          control for adding was at the bottom of the one list somebody
          scrolls to the end of.
        */}
        {group.member && (
          <button
            type="button"
            className="round group-new"
            aria-expanded={creating}
            aria-label="New album in this group"
            onClick={() => setCreating((was) => !was)}
          >
            <RailIcon glyph="plus" />
          </button>
        )}
      </div>

      {/* Under any tab, because the button that opens it is in the header
          rather than in the albums. Making one from the People tab and being
          shown nothing is a button that appears broken. */}
      {creating && (
        <form className="group-create" onSubmit={createEvent}>
          <label htmlFor="ev" className="visually-hidden">
            What is it called?
          </label>
          <input
            id="ev"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Sunday roast"
            maxLength={120}
            required
            autoFocus
          />
          <button type="submit" disabled={busy || !newName.trim()}>
            Create it here
          </button>
          <p className="group-create-note">
            Everyone in the group can add photos without being invited.
          </p>
        </form>
      )}

      {error && <p className="group-error">{error}</p>}

      {/*
        The premise, said once, where the count used to be. A group exists
        because the same people keep turning up; this is the only line on the
        screen that says so, and it earns its place by standing in for a
        heading over the faces.

        On its own tab now rather than above the archive. It is the pane about
        people, which is where the people belong — and the invite that opens
        under it is the one thing an admin comes here to do.
      */}
      {tab === 'people' && (
      <>
      {/*
        Who is waiting to be let in, above who is already here.

        On this pane rather than above the albums, which is where the app had
        it first and moved it from: this is the pane about people, and an admin
        meeting a queue on the way to the photographs is being asked a question
        about somebody while looking at something else.

        Admins only, and the page hands a member nothing to draw — that a
        particular stranger is trying to get into this room is the admin's to
        know. `queue` rather than `group.requests` so an answered row leaves at
        the moment it is answered.
      */}
      {queue.length > 0 && (
        <section className="join-queue" aria-label="Waiting to join">
          <h2 className="join-queue-head">
            {queue.length} waiting to join
          </h2>
          <ul>
            {queue.map((request) => (
              <li key={request.id}>
                {/*
                  A name if they gave one, and never a link. A request to join
                  is answered on what the group already knows about the person
                  asking; a link to a stranger's page turns answering into
                  looking somebody up, which is a different decision made with
                  different information.
                */}
                <span className="join-who">{request.name}</span>
                <button
                  type="button"
                  className="join-yes"
                  disabled={busy}
                  onClick={() => answer(request.id, 'approve')}
                >
                  Approve
                </button>
                {/*
                  Not styled as a danger. Declining is not destructive — the
                  row says so itself: a declined request can be made again, and
                  nobody is told it was refused.
                */}
                <button
                  type="button"
                  className="join-no"
                  disabled={busy}
                  onClick={() => answer(request.id, 'decline')}
                >
                  Decline
                </button>
              </li>
            ))}
          </ul>
          <p className="join-queue-note">
            Approving puts them in the room: they see every album in it, and the
            next one reaches them. Declining tells them nothing — they can ask
            again.
          </p>
        </section>
      )}

      <section className="people-strip">
        <span className="people-strip-label">The same people, every time</span>
        <div className="people-strip-row">
          {group.people.map((person) => (
            <span className="strip-person" key={person.actorId}>
              <Face
                src={person.avatarUrl}
                size={42}
                className="strip-face"
                fallback={
                  <span aria-hidden="true">
                    {person.name.replace(/^@/, '').slice(0, 1).toUpperCase()}
                  </span>
                }
              />
              <span className="strip-name">{person.firstName}</span>
            </span>
          ))}
          {/*
            Only for an admin, because only an admin may ask.

            That is the same power `group_join_request` gives them, pointed the
            other way: a stranger asking to come in, or the person who would
            answer that asking first. If any member could invite, the approval
            could be routed around by asking a friend on the inside — so the
            slot is simply absent for everybody else rather than present and
            refused.
          */}
          {group.role === 'admin' && (
            <button
              type="button"
              className="strip-person strip-add"
              aria-expanded={inviting}
              onClick={() => setInviting((was) => !was)}
            >
              <span className="strip-invite" aria-hidden="true">
                {'＋'}
              </span>
              <span className="strip-name">Invite</span>
            </button>
          )}
        </div>
      </section>

      {inviting && group.role === 'admin' && (
        <div className="group-invite">
          <MemberPicker picked={picked} onChange={setPicked} />
          <div className="group-invite-go">
            <span className="group-invite-note">
              {/*
                What being invited actually does, said where the decision is
                made. An admin pressing this is skipping the approval step —
                because they are the person who would have done the approving —
                and that is worth stating rather than leaving them to infer.
              */}
              They are asked, not added. Accepting is what puts somebody in.
            </span>
            <button type="button" onClick={invite} disabled={busy || picked.length === 0}>
              {busy
                ? 'Asking…'
                : picked.length === 0
                  ? 'Ask them'
                  : `Ask ${picked.length === 1 ? nameOf(picked[0]!) : `${picked.length} people`}`}
            </button>
          </div>
          {asked !== null && (
            <p className="group-invite-said">
              {asked === 0
                ? 'Nobody new to ask — they are already in, or already asked.'
                : `Asked ${asked} ${asked === 1 ? 'person' : 'people'}. They decide.`}
            </p>
          )}
        </div>
      )}
      </>
      )}

      {tab === 'chat' && <GroupChat groupId={group.id} />}

      {tab === 'albums' &&
        (group.events.length === 0 ? (
          /*
            The app's sentence, and no button under it.

            There was one — on the argument that with no shelf, making one
            *is* the page, so the action should come forward rather than stay
            behind a header control. That was right while the control was up
            in the head; the `+` is now pinned in the tab row directly above
            this card, so a second one here is two buttons for one action
            eighteen pixels apart.

            What the sentence does instead is answer the question an empty
            room actually raises — whether anything is meant to happen here —
            by saying what will, and that everyone finds out when it does.
          */
          <div className="group-empty">
            <p>
              Nothing yet. The next album anybody makes in this group shows up
              here, and everyone gets told.
            </p>
          </div>
        ) : (
          /*
            The shelf, two across.

            It was an archive: a row per album — cover, name, date, faces,
            counts — under month headings, on the argument that an archive is
            read by when. What that produced was a third way of drawing the
            same object, next to the cards on the home page and the list on a
            profile. Two columns of cover, name and date is the shelf the app
            draws for a group and for a person, and the month headings went
            with it: every tile carries its own date, which is what those
            headings were saying.
          */
          <div className="group-shelf">
            {group.events.map((event) => (
              <a className="shelf-album" href={`/event/${event.id}`} key={event.id}>
                <span className="shelf-cover">
                  {event.cover ? (
                    <EventCover src={event.cover} />
                  ) : (
                    /* An album with nothing in it yet still belongs here — it
                       is one of the things this room has, and leaving it out
                       would make the shelf disagree with the count above. */
                    <span className="shelf-none" aria-hidden="true" />
                  )}
                  {/* What has moved since you last looked, which is the one
                      thing a room knows that a person's shelf does not. */}
                  {event.fresh > 0 && <span className="shelf-pip" aria-hidden="true" />}
                </span>
                <span className="shelf-name">{event.name}</span>
                <span className="shelf-meta">
                  {event.photoCount === 0
                    ? 'Nothing in it yet'
                    : `${group.dates[event.id]} · ${event.photoCount}`}
                </span>
              </a>
            ))}
          </div>
        ))}

      {/*
        The sentence that makes `Leave this group` safe to hide in a menu.
        Without it, leaving reads as though it might take the photographs with
        it — and somebody who believes that will never press it, or will press
        it and be frightened.

        At the foot of the albums, which is where somebody arrives having
        scrolled them — exactly when "what happens to all this if I go" occurs
        to them. Under the other two panes it would be a sentence about
        photographs attached to a conversation.
      */}
      {tab === 'albums' && (
      <p className="group-note">
        Photos live in the albums, not in the group. Leaving stops the next one
        reaching you — it takes nothing away from the albums you were in.
      </p>
      )}

      <SiteFooter />
    </main>
  );
}

/**
 * An event's picture, which is presigned and therefore expires.
 *
 * A tab left open outlives the signature, and the browser's answer to that is
 * the broken-image glyph on a tile whose whole job is to be recognisable. The
 * box keeps its size and falls back to the warm bed instead — which is what
 * the tile's own background already is, so the span only has to be empty.
 */
function EventCover({ src }: { src: string }) {
  const { ref, failed, onError } = useImageFailure(src);
  if (failed) return <span className="shelf-failed" aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={src} alt="" onError={onError} />;
}
