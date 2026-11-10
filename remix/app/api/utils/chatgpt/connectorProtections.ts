export const CONNECTOR_PROTECTIONS_PATH = '/api/v1/settings/connector-protections';
export const CONNECTOR_PROTECTIONS_FEATURE = 'api.settings-connector-protections';
export const CONNECTOR_PROTECTIONS_VERSION = '1.0.0';

export const CONNECTOR_CONFIRMATION_ACTIONS = [
  'create', 'update', 'delete', 'share', 'comment', 'reaction', 'save', 'disconnect', 'workflow', 'undo'
] as const;

export type ConnectorConfirmationAction = typeof CONNECTOR_CONFIRMATION_ACTIONS[number];
export type ConnectorConfirmations = Record<ConnectorConfirmationAction, boolean>;
export type ConnectorConfirmationPatch = Partial<ConnectorConfirmations>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Only a stored literal false can turn off a protection. Absent/new keys
// default to on for existing accounts and older deployments.
export const effectiveConnectorConfirmations = (stored?: unknown): ConnectorConfirmations =>
  Object.fromEntries(CONNECTOR_CONFIRMATION_ACTIONS.map(key => [key, !isRecord(stored) || !Object.prototype.hasOwnProperty.call(stored, key) || stored[key] !== false])) as ConnectorConfirmations;

export const parseConnectorConfirmationPatch = (raw: unknown): ConnectorConfirmationPatch | null => {
  if (!isRecord(raw)) return null;
  const entries = Object.entries(raw);
  if (!entries.length || entries.some(([key, value]) =>
    !CONNECTOR_CONFIRMATION_ACTIONS.includes(key as ConnectorConfirmationAction) || typeof value !== 'boolean'
  )) return null;
  return Object.fromEntries(entries);
};

export const parseConnectorConfirmations = (raw: unknown): ConnectorConfirmations | null => {
  const patch = parseConnectorConfirmationPatch(raw);
  return patch && Object.keys(patch).length === CONNECTOR_CONFIRMATION_ACTIONS.length ? effectiveConnectorConfirmations(patch) : null;
};

export const connectorConfirmationsForMutation = (
  action: 'create' | 'update' | 'delete',
  payload?: unknown,
  before?: unknown
): ConnectorConfirmationAction[] => {
  const types = new Set<ConnectorConfirmationAction>([action]);
  for (const value of [payload, before]) {
    if (!isRecord(value)) continue;
    const kinds = Array.isArray(value.thingtime) ? value.thingtime : [value.thingtime];
    if (kinds.includes('comment')) types.add('comment');
    if (kinds.includes('share')) types.add('share');
    if (kinds.includes('reaction')) types.add('reaction');
    if (kinds.includes('saved')) types.add('save');
  }
  if (action === 'update' && isRecord(payload) && (Object.prototype.hasOwnProperty.call(payload, 'acl') || Object.prototype.hasOwnProperty.call(payload, 'visibility'))) types.add('share');
  return [...types];
};

export const requiredConnectorConfirmations = (
  confirmations: ConnectorConfirmations,
  actions: Iterable<ConnectorConfirmationAction>
): ConnectorConfirmationAction[] => [...new Set(actions)].filter(action => confirmations[action]);
