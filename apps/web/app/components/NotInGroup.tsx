'use client';

/**
 * Somebody outside a roll's group, being added to the roll.
 *
 * A roll in a group is shared with exactly the group, so the server refuses to
 * let them in by name and answers with who they are and which group — see
 * `notInGroup`. This puts the question that answer asks: add them to the group,
 * and the roll comes with it, or take the roll out of the group so it can have
 * people of its own. Adding them to a group is its admins' alone, so a roll's
 * creator who is not one is offered the second answer only, and told why.
 *
 * The same question from three places — the roll's Members, its co-hosts, and
 * the two lists a request to join is answered from — so it is drawn once.
 */

export type NotInGroupAnswer = {
  error: 'not_in_group';
  outsiders: { actorId: string; name: string }[];
  group: { id: string; name: string };
  canAddToGroup: boolean;
};

/** The refusal, if that is what this response is. */
export async function readNotInGroup(res: Response): Promise<NotInGroupAnswer | null> {
  if (res.status !== 409) return null;
  const body = (await res.clone().json().catch(() => null)) as NotInGroupAnswer | null;
  return body?.error === 'not_in_group' ? body : null;
}

/** The roll out of its group, everybody in the group kept. See the route. */
export async function takeRollOutOfGroup(eventId: string): Promise<void> {
  const res = await fetch(`/api/events/${eventId}/group`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Could not remove the roll from the group. Try again.');
}

/** "Sam", "Sam and Ava", "Sam, Ava and 2 others". */
function names(people: { name: string }[]): string {
  const [first, second] = people;
  if (people.length === 1) return first!.name;
  if (people.length === 2) return `${first!.name} and ${second!.name}`;
  return `${first!.name}, ${second!.name} and ${people.length - 2} ${people.length === 3 ? 'other' : 'others'}`;
}

export function NotInGroupChoice({
  answer,
  busy,
  onAddToGroup,
  onTakeOut,
  onCancel,
}: {
  answer: NotInGroupAnswer;
  busy: boolean;
  onAddToGroup: () => void;
  onTakeOut: () => void;
  onCancel: () => void;
}) {
  const who = names(answer.outsiders);
  const one = answer.outsiders.length === 1;
  const group = answer.group.name;

  return (
    <div className="group-choice" role="alertdialog" aria-label={`${who} ${one ? 'isn’t' : 'aren’t'} in ${group}`}>
      <p className="group-choice-head">
        {who} {one ? 'isn’t' : 'aren’t'} in {group}
      </p>
      <p className="group-choice-body">
        This roll is shared with everyone in {group}. To include {one ? who : 'them'}, add them
        to the group, or remove the roll from the group so it can have its own people.
        {!answer.canAddToGroup && ` Only ${group}’s admins can add people to the group.`}
      </p>
      <div className="row">
        {answer.canAddToGroup && (
          <button type="button" className="small" disabled={busy} onClick={onAddToGroup}>
            Add {one ? who : 'them'} to {group}
          </button>
        )}
        <button type="button" className="secondary small" disabled={busy} onClick={onTakeOut}>
          Remove roll from group
        </button>
        <button type="button" className="secondary small" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
