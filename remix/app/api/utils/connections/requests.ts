import { resolveConnectionCredential } from './connections';
import { authedJson } from './providers';
import { fail } from './shared';
import { redactSensitiveValue } from '../admin/integrationCore';

// A fixed operation registry, not a credential-bearing arbitrary URL proxy.
const operations: Record<string, { provider: string; scope: string; url: (id: string) => string; needsId?: boolean }> = {
  'drive.list-files': {
    provider: 'google-drive',
    scope: 'https://www.googleapis.com/auth/drive.metadata.readonly',
    url: () => 'https://www.googleapis.com/drive/v3/files?pageSize=20&fields=files(id,name,mimeType,modifiedTime)'
  },
  'gmail.list-messages': {
    provider: 'google-gmail',
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    url: () => 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20'
  },
  'calendar.list-calendars': {
    provider: 'google-calendar',
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
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
  input: { connectionId?: unknown; operation?: unknown; resourceId?: unknown }
) => {
  if (typeof input.connectionId !== 'string' || !/^ext-link-[a-f0-9]{48}$/.test(input.connectionId)) return fail(400, 'Choose a saved connection.');
  const operation = typeof input.operation === 'string' ? input.operation : '';
  const op = Object.prototype.hasOwnProperty.call(operations, operation) ? operations[operation] : null;
  if (operation !== 'account.profile' && !op) return fail(400, 'Choose a supported connection operation.');
  const resourceId = typeof input.resourceId === 'string' ? input.resourceId : '';
  if (op?.needsId && !/^[A-Za-z0-9_-]{1,200}$/.test(resourceId)) return fail(400, 'A valid document or spreadsheet ID is required.');
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
    const result = await authedJson(op.url(resourceId), { token: tokens.accessToken });
    if (result.ok === false) return result;
    data = result.data;
  }
  let encoded = JSON.stringify(redactSensitiveValue(data));
  if (!encoded || Buffer.byteLength(encoded) > 128 * 1024) return fail(502, 'The provider result exceeds the connection response limit.');
  for (const secret of [tokens.accessToken, tokens.refreshToken, tokens.idToken].filter(Boolean) as string[]) {
    encoded = encoded.split(JSON.stringify(secret).slice(1, -1)).join('[redacted]');
  }
  return { ok: true as const, connectionId: input.connectionId, provider: provider.id, operation, data: JSON.parse(encoded) };
};
