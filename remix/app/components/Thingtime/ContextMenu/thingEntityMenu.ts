import { THING_ACTIONS, type ThingActionId } from '~/schemas/thingActions';
import type { ThingContextAction, ThingContextMenuModel, ThingContextSection } from './contextMenuModel';

// Persisted entity schemas inherit base verbs. Adapters contribute capability
// hints and extension sections, never alternative renderers or base commands.
// An absent handler is not a capability; the server remains authoritative.
export function buildThingEntityMenu(
  capabilities: Partial<Record<ThingActionId, boolean | Partial<ThingContextAction>>>,
  extensions: ThingContextSection[] = [],
  subjectId?: string
): ThingContextMenuModel {
  const action = (id: ThingActionId): ThingContextAction[] => capabilities[id]
    ? [{ ...THING_ACTIONS[id], ...(typeof capabilities[id] === 'object' ? capabilities[id] : {}), id, command: id }]
    : [];
  const organiseActions = [...action('pin'), ...action('unpin'), ...action('reorder-pins'), ...action('archive'), ...action('restore')];
  const sections = extensions.map(section => section.id === 'organise'
    ? { ...section, actions: [...section.actions, ...organiseActions] } : section);
  if (organiseActions.length && !sections.some(section => section.id === 'organise'))
    sections.push({ id: 'organise', label: 'Organise', actions: organiseActions });
  return { subjectId, sections: [
    { id: 'thing', actions: [...action('open'), ...action('inspect'), ...action('storage-placement'), ...action('history'), ...action('copy-link'), ...action('share-preview'), ...action('rename'), ...action('edit'), ...action('share')] },
    { id: 'lopu', actions: action('send-to-lopu') },
    ...sections,
    { id: 'danger', actions: action('delete') }
  ].filter(section => section.actions.length) };
}

export function thingArchiveMenu(model: ThingContextMenuModel, command: 'archive' | 'restore', disabled = false): ThingContextMenuModel {
  const action = { ...THING_ACTIONS[command], disabled,
    ...(model.subjectScope === 'containing-thing' ? {
      label: command === 'archive' ? 'Archive containing Thing' : 'Restore containing Thing',
      hint: 'Applies to the saved root Thing'
    } : {})
  };
  const hasOrganise = model.sections.some(section => section.id === 'organise');
  const sections = model.sections.map(section => section.id === 'organise'
    ? { ...section, actions: [...section.actions, action] } : section);
  if (!hasOrganise) {
    const danger = sections.findIndex(section => section.id === 'danger');
    sections.splice(danger < 0 ? sections.length : danger, 0, { id: 'organise', label: 'Organise', actions: [action] });
  }
  return { ...model, sections };
}
