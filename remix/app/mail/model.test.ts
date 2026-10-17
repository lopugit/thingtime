import test from 'node:test';
import assert from 'node:assert/strict';
import {
	validateMailAccount,
	localSyncAccount,
	validateMailInbox,
	publicMailAccount,
	selectMailMessages,
	mergeMailRows,
	emptyMailState,
	type MailMessage
} from './model';
const account = () => ({
	id: 'account_one',
	name: 'Personal',
	address: 'person@example.com',
	revision: 0,
	sync: { cloud: true, local: true },
	servers: { imap: { host: 'imap.example.com', port: 993, security: 'tls', username: 'person@example.com', password: 'fixture-secret' } }
});
test('account projection never exposes passwords, and flags remain independent', () => {
	for (const cloud of [true, false])
		for (const local of [true, false]) {
			const input = account();
			input.sync = { cloud, local };
			const value = validateMailAccount(input);
			assert.deepEqual(value.sync, input.sync);
			assert.equal(JSON.stringify(publicMailAccount(value)).includes('fixture-secret'), false);
			assert.equal(value.servers.imap?.password, 'fixture-secret');
		}
});
test('mail configurations reject injection, cleartext, IP destinations and invalid ports', () => {
	for (const patch of [
		{ host: '127.0.0.1' },
		{ host: 'localhost' },
		{ host: 'https://imap.example.com' },
		{ username: 'user\r\nDELE 1' },
		{ password: 'pass\r\nDELE 1' },
		{ security: 'none' },
		{ port: 25 }
	]) {
		const input = account();
		Object.assign(input.servers.imap, patch);
		assert.throws(() => validateMailAccount(input));
	}
});
test('proxy views merge source folders across accounts without mutating or duplicating rows', () => {
	const state = emptyMailState();
	state.folders = [
		{ id: 'folder_one', accountId: 'account_one', protocol: 'imap', path: 'INBOX', name: 'Inbox', inbox: true },
		{ id: 'folder_two', accountId: 'account_two', protocol: 'imap', path: 'Friends', name: 'Friends', inbox: false },
		{ id: 'folder_three', accountId: 'account_three', protocol: 'pop3', path: 'INBOX', name: 'Inbox', inbox: true }
	];
	state.messages = state.folders.map(
		(folder, index) =>
			({ id: `message_${index}`, folderId: folder.id, accountId: folder.accountId, date: `2026-10-${15 + index}T00:00:00.000Z` } as MailMessage)
	);
	state.inboxes = [validateMailInbox({ id: 'proxy_one', name: 'Together', folderIds: ['folder_one', 'folder_two', 'folder_one'], revision: 0 })];
	const before = structuredClone(state);
	assert.deepEqual(
		selectMailMessages(state, 'proxy_one').map((row) => row.id),
		['message_1', 'message_0']
	);
	assert.deepEqual(
		selectMailMessages(state, 'all').map((row) => row.id),
		['message_2', 'message_0']
	);
	assert.deepEqual(
		selectMailMessages(state, 'account_two').map((row) => row.id),
		['message_1']
	);
	assert.deepEqual(state, before);
	assert.equal(mergeMailRows(state.messages, state.messages).length, 3);
});

test('a changed remote destination cannot reuse a device password', () => {
	const saved = validateMailAccount(account());
	const remote = publicMailAccount(saved);
	assert.equal(localSyncAccount(remote, saved.servers).servers.imap?.password, 'fixture-secret');
	remote.servers.imap!.host = 'new.example.com';
	assert.throws(() => localSyncAccount(remote, saved.servers), /Re-enter/);
});

test('transport choices round trip without silently migrating legacy connector accounts', () => {
	assert.equal(validateMailAccount(account()).sync.transport, undefined);
	for (const transport of ['connector', 'native', 'relay']) {
		const input = { ...account(), sync: { cloud: false, local: true, transport } };
		assert.equal(publicMailAccount(validateMailAccount(input)).sync.transport, transport);
	}
	assert.throws(() => validateMailAccount({ ...account(), sync: { cloud: false, local: true, transport: 'auto' } }));
});
