import { THING_ACTIONS, type ThingActionId } from '~/schemas/thingActions';
import type { ThingContextAction, ThingContextMenuModel, ThingContextSection } from './contextMenuModel';

// Persisted entity schemas inherit base verbs. Adapters contribute capability
// hints and extension sections, never alternative renderers or base commands.
// An absent handler is not a capability; the server remains authoritative.
export function buildThingEntityMenu(
  capabilities: Partial<Record<ThingActionId, boolean | Partial<ThingContextAction>>>,
  extensions: ThingContextSection[] = []
): ThingContextMenuModel {
  const action = (id: ThingActionId): ThingContextAction[] => capabilities[id]
    ? [{ ...THING_ACTIONS[id], ...(typeof capabilities[id] === 'object' ? capabilities[id] : {}), id, command: id }]
    : [];
  return { sections: [
    { id: 'thing', actions: [...action('open'), ...action('inspect'), ...action('copy-link'), ...action('edit'), ...action('share')] },
    { id: 'lopu', actions: action('send-to-lopu') },
    ...extensions,
    { id: 'danger', actions: action('delete') }
  ].filter(section => section.actions.length) };
}
