/** Fixed, read-only service operations. Consent and operation admission remain separate. */
export const googleServiceAccess = {
  'drive.list-files': { provider: 'google-drive', label: 'List Drive files', scope: 'https://www.googleapis.com/auth/drive.metadata.readonly', resource: null, paginated: true },
  'gmail.list-messages': { provider: 'google-gmail', label: 'List Gmail messages', scope: 'https://www.googleapis.com/auth/gmail.readonly', resource: null, paginated: true },
  'calendar.list-calendars': { provider: 'google-calendar', label: 'List calendars', scope: 'https://www.googleapis.com/auth/calendar.readonly', resource: null, paginated: true },
  'docs.get-document': { provider: 'google-docs', label: 'Read a Google Doc', scope: 'https://www.googleapis.com/auth/documents.readonly', resource: 'Document ID', paginated: false },
  'sheets.get-spreadsheet': { provider: 'google-sheets', label: 'Read a Google Sheet', scope: 'https://www.googleapis.com/auth/spreadsheets.readonly', resource: 'Spreadsheet ID', paginated: false },
  'contacts.list-contacts': { provider: 'google-contacts', label: 'List contacts', scope: 'https://www.googleapis.com/auth/contacts.readonly', resource: null, paginated: true }
} as const;
export type GoogleServiceOperation = keyof typeof googleServiceAccess;
export type NamedOperationArguments = { resourceId?: string; pageToken?: string };
export type NamedOperationResult = Record<string, unknown>;
export const googleServiceOperation = (operation: string): GoogleServiceOperation | null =>
  Object.prototype.hasOwnProperty.call(googleServiceAccess, operation) ? operation as GoogleServiceOperation : null;
