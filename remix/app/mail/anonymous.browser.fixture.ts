// Synthetic reader data only. Bundled by the opt-in browser test runner, never
// imported by the application. Account settings are created through the real UI.
import { readMailLocal, writeMailLocal } from './localStore';
import type { MailMessage } from './model';

const scope = { kind: 'anonymous' } as const;
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
export const subject = 'A saved message with a long reference ' + 'reference'.repeat(12);
export const body = "These are synthetic saved messages, not provider mail.\n\n" +
 '<img src="https://mail-fixture.invalid/tracker" onerror="alert(1)">\n' +
 'Long reference: ' + 'abcdef0123456789'.repeat(16) + '\n\nEnd of the saved message.';

export async function seedReader() {
 const local = await readMailLocal(scope, lease);
 if (local.state.accounts.length !== 1 || Object.keys(local.settingsWrites).length || local.connectorToken)
  throw Error('Expected one anonymous device account and no connection.');
 const account = local.state.accounts[0];
 if (account.sync.cloud || account.sync.local) throw Error('The synthetic account must have sync paused.');
 const folder = { id: 'fixture-folder-inbox', accountId: account.id, protocol: 'imap' as const, path: 'INBOX', name: 'Saved fixture inbox', inbox: true };
 const messages: MailMessage[] = Array.from({ length: 52 }, (_, i) => ({
  id: `fixture-message-${String(i).padStart(3, '0')}`, accountId: account.id, folderId: folder.id, remoteId: String(i),
  subject: i === 0 ? subject : `Saved fixture message ${i}`, from: i === 0 ? '' : 'sender@example.invalid', to: '',
  date: i === 0 ? null : new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(), text: i === 0 ? body : `Saved message ${i}`,
  unread: true, attachmentCount: i === 0 ? 2 : 0, truncated: i === 0
 }));
 await writeMailLocal(scope, { ...local, state: { ...local.state, folders: [folder], messages } }, lease);
 return { subject, body, count: messages.length };
}

export async function proof() {
 const local = await readMailLocal(scope, lease);
 return {
  accounts: local.state.accounts.map(({ name, sync }) => ({ name, sync })),
  inboxes: local.state.inboxes.map(({ name, folderIds }) => ({ name, folderIds })),
  messages: local.state.messages.length, queuedWrites: Object.keys(local.settingsWrites).length,
  hasCredential: Object.values(local.credentials).some(servers => Object.values(servers).some(server => Boolean(server.password))),
 };
}
