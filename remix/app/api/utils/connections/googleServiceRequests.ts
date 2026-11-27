import { googleServiceAccess, type GoogleServiceOperation } from '../../../connections/googleServiceActions';
import { fail } from './shared';

// No caller-controlled host, URL, query shape, HTTP method or headers.
const urls: Record<GoogleServiceOperation, (id: string) => string> = {
  'drive.list-files': () => 'https://www.googleapis.com/drive/v3/files?pageSize=20&fields=*',
  'gmail.list-messages': () => 'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20',
  'calendar.list-calendars': () => 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=20',
  'docs.get-document': id => `https://docs.googleapis.com/v1/documents/${id}?includeTabsContent=true`,
  'sheets.get-spreadsheet': id => `https://sheets.googleapis.com/v4/spreadsheets/${id}?includeGridData=true`,
  'contacts.list-contacts': () => 'https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,phoneNumbers,addresses,biographies,birthdays,organizations,urls,metadata&pageSize=100'
};
export function googleServiceRequest(operation: GoogleServiceOperation, input: { resourceId?: unknown; pageToken?: unknown }) {
  const spec = googleServiceAccess[operation];
  if (input.resourceId !== undefined && (typeof input.resourceId !== 'string' || !spec.resource))
    return fail(400, 'This operation does not accept a resource ID.');
  const id = typeof input.resourceId === 'string' ? input.resourceId : '';
  if (spec.resource && !/^[A-Za-z0-9_-]+$/.test(id)) return fail(400, `Enter a valid ${spec.resource.toLowerCase()}.`);
  if (input.pageToken !== undefined && (typeof input.pageToken !== 'string' || !spec.paginated))
    return fail(400, 'This operation does not accept that page token.');
  const url = new URL(urls[operation](id));
  // Opaque provider data is encoded once; never interpreted as a URL or trimmed.
  if (input.pageToken) url.searchParams.set('pageToken', input.pageToken as string);
  return { ok: true as const, url: url.href };
}

const CREDENTIAL_FIELD = /^(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|(?:access|refresh|id)[-_]?token|client[-_]?secret|api[-_]?key|private[-_]?key)$/i;
/** Preserve complete provider data and continuation tokens, while removing
 * credential fields and exact known secrets, including echoed property names. */
export function redactServiceResult(data: unknown, credentials: (string | undefined)[]) {
  const secrets = [...new Set(credentials.filter(Boolean) as string[])].sort((a, b) => b.length - a.length);
  const pattern = secrets.length ? new RegExp(secrets.map(secret => secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null;
  const text = (value: string) => pattern ? value.replace(pattern, '[redacted]') : value;
  let encoded = JSON.stringify(data, (key, value) => CREDENTIAL_FIELD.test(key) ? '[redacted]' : typeof value === 'string' ? text(value) : value);
  if (encoded === undefined) throw new Error('Invalid provider JSON.');
  encoded = encoded.replace(/"(?:[^"\\]|\\.)*"/g, (quoted, offset, source: string) =>
    source[offset + quoted.length] === ':' ? JSON.stringify(text(JSON.parse(quoted))) : quoted);
  return JSON.parse(encoded);
}
