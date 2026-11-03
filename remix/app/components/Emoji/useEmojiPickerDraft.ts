import React from 'react';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { useDataPlane } from '~/hooks/useDataPlane';
import { reactionPickerScope } from './reactionPickerState';

// Keep unsubmitted input above lazy popover content without showing another
// account, database or target's draft during a context switch.
export const useEmojiPickerDraft = (targetId: string) => {
  const user = useCurrentUser();
  const dataPlane = useDataPlane();
  const scope = JSON.stringify([
    reactionPickerScope(typeof window === 'undefined' ? '' : window.location.origin, dataPlane, user?.id ?? null),
    targetId
  ]);
  const [draft, setDraft] = React.useState({ scope, query: '' });
  const setQuery = (query: string) => setDraft({ scope, query });
  return { query: draft.scope === scope ? draft.query : '', setQuery };
};
