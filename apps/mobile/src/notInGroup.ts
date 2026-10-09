import { Alert } from 'react-native';

import { ApiError } from './api';

/**
 * Somebody outside a roll's group, being added to the roll.
 *
 * A roll in a group is shared with exactly the group, so the server refuses
 * to let them in by name and answers with who they are and which group. This
 * puts the question that answer asks — add them to the group, and the roll
 * comes with it, or take the roll out of the group so it can have people of
 * its own. Adding to a group is its admins' alone, so a roll's creator who is
 * not one is offered the second only, and told why. The web's twin is
 * `NotInGroupChoice`.
 */
export type NotInGroupAnswer = {
  outsiders: { actorId: string; name: string }[];
  group: { id: string; name: string };
  canAddToGroup: boolean;
};

/** The refusal, if that is what this error is. */
export function notInGroupOf(err: unknown): NotInGroupAnswer | null {
  if (!(err instanceof ApiError) || err.status !== 409 || err.code !== 'not_in_group') return null;
  return err.body as unknown as NotInGroupAnswer;
}

function names(people: { name: string }[]): string {
  const [first, second] = people;
  if (people.length === 1) return first!.name;
  if (people.length === 2) return `${first!.name} and ${second!.name}`;
  return `${first!.name}, ${second!.name} and ${people.length - 2} ${people.length === 3 ? 'other' : 'others'}`;
}

export function askNotInGroup(
  answer: NotInGroupAnswer,
  { onAddToGroup, onTakeOut }: { onAddToGroup: () => void; onTakeOut: () => void },
) {
  const who = names(answer.outsiders);
  const one = answer.outsiders.length === 1;
  const group = answer.group.name;
  Alert.alert(
    `${who} ${one ? 'isn’t' : 'aren’t'} in ${group}`,
    `This roll is shared with everyone in ${group}. To include ${one ? who : 'them'}, add them to the group, or remove the roll from the group so it can have its own people.${
      answer.canAddToGroup ? '' : ` Only ${group}’s admins can add people to the group.`
    }`,
    [
      ...(answer.canAddToGroup
        ? [{ text: `Add ${one ? who : 'them'} to ${group}`, onPress: onAddToGroup }]
        : []),
      { text: 'Remove roll from group', onPress: onTakeOut },
      { text: 'Cancel', style: 'cancel' as const },
    ],
  );
}
