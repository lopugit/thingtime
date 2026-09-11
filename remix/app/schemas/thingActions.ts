// Every persisted schema inherits these Thing actions. A presentation may add
// schema-specific controls, but must not redefine the base labels or verbs.
// These are UI hints, never authorization: the Things API checks each write.
export const THING_ACTIONS = {
  open: { id: 'open', command: 'open', label: 'Open Thing', icon: '🔎', lucide: 'external-link' },
  inspect: { id: 'inspect', command: 'inspect', label: 'View Thing data', icon: '💎', lucide: 'braces' },
  'copy-link': { id: 'copy-link', command: 'copy-link', label: 'Copy link', icon: '🔗', lucide: 'link' },
  edit: { id: 'edit', command: 'edit', label: 'Edit', icon: '✏️', lucide: 'pen-line' },
  share: { id: 'share', command: 'share', label: 'Share / permissions', icon: '🌐', lucide: 'share-2' },
  delete: { id: 'delete', command: 'delete', label: 'Delete', icon: '🗑️', lucide: 'trash-2', danger: true },
  'send-to-lopu': { id: 'send-to-lopu', command: 'send-to-lopu', label: 'Send to Lopu', icon: '🦄', lucide: 'send' }
} as const;

export type ThingActionId = keyof typeof THING_ACTIONS;
export const THING_ACTIONS_PATH = '/api/v1/things/actions';
export const THING_ACTIONS_REQUIREMENTS = { 'api.things-actions': '1.0.0' } as const;

export type ThingActionRequest = { id: string; action: 'send-to-lopu' };
export const parseThingActionRequest = (input: unknown): ThingActionRequest => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Choose a Thing action.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== 'id' && key !== 'action') ||
      typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value.id) || value.action !== 'send-to-lopu')
    throw new TypeError('Choose a supported Thing action and exact Thing ID.');
  return { id: value.id, action: value.action };
};
