import { resolveConnectionCredential } from './connections';
import { authedJson } from './providers';
import { fail } from './shared';

// API payloads may contain ordinary key/value fields and continuation tokens.
// The broader, bounded log redactor is deliberately not used for these data.
const CREDENTIAL_FIELD = /^(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|password|passwd|(?:access|refresh|id)[-_]?token|token|client[-_]?secret|secret|api[-_]?key|private[-_]?key|credentials?)$/i;

// A fixed operation registry, not a credential-bearing arbitrary URL proxy.
const operations: Record<string, { provider: string; scope: string; url: (id: string) => string; needsId?: boolean; paginated?: boolean }> = {
  'drive.list-files': {
    provider: 'google-drive',
    scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
    paginated: true,
    url: () => 'https://www.googleapis.com/drive/v3/files?pageSize=20&fields=nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime)'
  },
  'gmail.list-messages': {
    provider: 'google-gmail',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    paginated: true,
    url: () => 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20'
  },
  'calendar.list-calendars': {
    provider: 'google-calendar',
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    paginated: true,
    url: () => 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=20'
  },
  'docs.get-document': {
    provider: 'google-docs',
    scope: 'https://www.googleapis.com/auth/documents.readonly',
    needsId: true,
    url: (id) => `https://docs.googleapis.com/v1/documents/${id}`
  },
  'sheets.get-spreadsheet': {
    provider: 'google-sheets',
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    needsId: true,
    url: (id) => `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=false`
  },
  'contacts.list-contacts': {
    provider: 'google-contacts',
    scope: 'https://www.googleapis.com/auth/contacts.readonly',
    paginated: true,
    url: () => 'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses&pageSize=20'
  }
};
export const connectionOperations = (providerId: string, oauth: boolean) => [
  ...(oauth ? ['account.profile'] : []),
  ...Object.entries(operations)
    .filter(([, op]) => op.provider === providerId)
    .map(([id]) => id)
];

export const runConnectionRequest = async (
  user: { id: string; username: string },
  input: { connectionId?: unknown; operation?: unknown; resourceId?: unknown; pageToken?: unknown },
  signal?: AbortSignal
) => {
  if (typeof input.connectionId !== 'string' || !/^ext-link-[a-f0-9]{48}$/.test(input.connectionId)) return fail(400, 'Choose a saved connection.');
  const operation = typeof input.operation === 'string' ? input.operation : '';
  const op = Object.prototype.hasOwnProperty.call(operations, operation) ? operations[operation] : null;
  if (operation !== 'account.profile' && !op) return fail(400, 'Choose a supported connection operation.');
  const resourceId = typeof input.resourceId === 'string' ? input.resourceId : '';
  if (op?.needsId && !/^[A-Za-z0-9_-]+$/.test(resourceId)) return fail(400, 'A valid document or spreadsheet ID is required.');
  const pageToken = input.pageToken;
  if (pageToken != null && typeof pageToken !== 'string') return fail(400, 'A page token must be a string returned by this provider.');
  if (pageToken && !op?.paginated) return fail(400, 'This operation does not support pagination.');
  const saved = await resolveConnectionCredential(user, input.connectionId);
  if (saved.ok === false) return saved;
  const { provider, tokens } = saved;
  let data: unknown;
  if (operation === 'account.profile') {
    if (!provider.oauth) return fail(400, 'This provider does not support profile verification.');
    const resolved = await provider.oauth.resolveAccountFromTokens(tokens);
    if (resolved.ok === false) return resolved;
    // Never return provider config or a raw token-bearing profile response.
    data = { displayName: resolved.account.displayName, handle: resolved.account.handle };
  } else {
    if (!op || op.provider !== provider.id) return fail(400, 'This operation does not belong to the selected connection.');
    if (!tokens.scopes?.includes(op.scope)) return fail(403, 'Reconnect this service and grant the required permission.');
    const url = new URL(op.url(resourceId));
    if (typeof pageToken === 'string' && pageToken) url.searchParams.set('pageToken', pageToken);
    const result = await authedJson(url.href, { token: tokens.accessToken, completeResponse: true, signal });
    if (result.ok === false) return result;
    data = result.data;
  }
  // Log summaries intentionally truncate. API results must retain every
  // record, property and string. A continuation token is provider data,
  // not an authentication credential; known credentials are still scrubbed
  // below even if a provider echoes one under an unexpected field name.
  const secrets = [...new Set([tokens.accessToken, tokens.refreshToken, tokens.idToken].filter(Boolean) as string[])];
  const secretPattern = secrets.length
    ? new RegExp(secrets.sort((a, b) => b.length - a.length).map((secret) => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
    : null;
  const redactText = (value: string) => secretPattern ? value.replace(secretPattern, '[redacted]') : value;
  let encoded = JSON.stringify(data, (key, value) =>
    CREDENTIAL_FIELD.test(key) ? '[redacted]' : typeof value === 'string' ? redactText(value) : value
  );
  if (encoded === undefined) return fail(502, 'The provider returned an invalid result.');
  // Values are redacted structurally above, so opaque tokens cannot rewrite
  // JSON punctuation, numbers or booleans. Scrub property names too, changing
  // only complete quoted keys and re-escaping them before parsing. One literal
  // match pass prefers whole longer tokens and never rewrites its own marker.
  encoded = encoded.replace(/"(?:[^"\\]|\\.)*"/g, (quoted, offset, source: string) =>
    source[offset + quoted.length] === ':' ? JSON.stringify(redactText(JSON.parse(quoted))) : quoted
  );
  return { ok: true as const, connectionId: input.connectionId, provider: provider.id, operation, data: JSON.parse(encoded) };
};
