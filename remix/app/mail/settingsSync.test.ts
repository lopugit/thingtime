import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readMailLocal, writeMailLocal, updateMailLocal, mailStorageKey, emptyLocalMail } from './localStore';
import {
	editMailAccount,
	editMailInbox,
	deleteMailSettings,
	mergeMailSettings,
	mailRemoteRevision,
	synchronizeMailSettings,
	adoptRemoteMailSettings,
	mailSettingsKey
} from './settingsSync';
import { publicMailAccount, type MailAccount } from './model';
import type { MailWorkspace } from './workspace.client';
const signal = () => new AbortController().signal;
const workspace = (anonymous = false) => {
	let current = true,
		connected = true;
	const listeners = new Set<() => void>();
	const scope = anonymous
		? { kind: 'anonymous' as const }
		: { kind: 'account' as const, origin: 'https://mail-queue.example', ownerId: crypto.randomUUID() };
	const value: MailWorkspace = {
		scope,
		key: mailStorageKey(scope),
		canSync: () => connected,
		lease: {
			assertCurrent() {
				if (!current) throw new Error('Workspace retired');
			},
			onInvalidate(fn) {
				listeners.add(fn);
				return () => {
					listeners.delete(fn);
				};
			}
		}
	};
	return {
		value,
		offline() {
			connected = false;
		},
		online() {
			connected = true;
		},
		retire() {
			current = false;
			listeners.forEach((fn) => fn());
		}
	};
};
const account = (id = crypto.randomUUID()): MailAccount => ({
	id,
	name: 'Mail fixture',
	address: 'fixture@example.test',
	revision: 0,
	servers: { imap: { host: 'imap.example.test', username: 'fixture', port: 993, security: 'tls', password: 'synthetic-password-only' } },
	sync: { cloud: true, local: false, transport: 'connector' }
});
const read = (w: MailWorkspace) => readMailLocal(w.scope, w.lease);
const edit = (w: MailWorkspace, a: MailAccount) => updateMailLocal(w.scope, w.lease, (local) => editMailAccount(local, w.scope, a));
const run = (w: MailWorkspace, transport: Parameters<typeof synchronizeMailSettings>[1], now = () => 1_000_000) =>
	synchronizeMailSettings(w, transport, signal(), () => {}, now);
const latch = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};
const response = (body: Record<string, any>) =>
	body.operation === 'delete'
		? { ok: true }
		: body.operation === 'save-account'
		? { account: publicMailAccount({ ...body.account, revision: body.account.revision + 1 }) }
		: { inbox: { ...body.inbox, revision: body.inbox.revision + 1 } };

test('version 2 encrypted mail upgrades intact and older writers cannot drop the new queue', async () => {
	const w = workspace(),
		a = account();
	const db = await new Promise<IDBDatabase>((resolve) => {
		const request = indexedDB.open('thingtime-mail-v1', 2);
		request.onupgradeneeded = () => {
			for (const name of ['keys', 'mail', 'heads']) request.result.createObjectStore(name);
			request.result.createObjectStore('records', { keyPath: ['scope', 'key'] }).createIndex('scope', 'scope');
		};
		request.onsuccess = () => resolve(request.result);
	});
	const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
	const rowId = `account:${a.id}`,
		iv = crypto.getRandomValues(new Uint8Array(12));
	const plaintext = JSON.stringify({ account: { ...publicMailAccount(a), revision: 4 }, credentials: {}, local: false });
	const bytes = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(JSON.stringify([w.value.key, rowId])) },
		key,
		new TextEncoder().encode(plaintext)
	);
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(['keys', 'heads', 'records'], 'readwrite');
		tx.objectStore('keys').put(key, w.value.key);
		tx.objectStore('heads').put({ revision: 7 }, w.value.key);
		tx.objectStore('records').put({ scope: w.value.key, key: rowId, iv, bytes });
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
	await assert.rejects(read(w.value), /Reload older Thingtime tabs/);
	db.close();
	const local = await read(w.value);
	assert.equal(local.storageRevision, 7);
	assert.equal(local.state.accounts[0].revision, 4);
	assert.deepEqual(local.settingsWrites, {});
	await edit(w.value, { ...local.state.accounts[0], name: 'Retained through upgrade' });
	await assert.rejects(
		new Promise<void>((resolve, reject) => {
			const request = indexedDB.open('thingtime-mail-v1', 2);
			request.onsuccess = () => {
				request.result.close();
				resolve();
			};
			request.onerror = () => reject(request.error);
		}),
		{ name: 'VersionError' }
	);
	assert.equal(Object.keys((await read(w.value)).settingsWrites).length, 1);
});

test('offline cloud settings commit, reopen encrypted, and sync only after matching reconnection', async () => {
	const w = workspace(),
		a = account();
	w.offline();
	await edit(w.value, a);
	let local = await read(w.value);
	assert.equal(local.state.accounts[0].revision, 1);
	assert.equal(local.state.accounts[0].servers.imap!.password, undefined);
	assert.deepEqual(local.credentials[a.id], {});
	assert.equal(Object.values(local.settingsWrites)[0].desired.localRevision, 1);
	let calls = 0;
	await run(w.value, async () => {
		calls++;
		throw Error('unexpected');
	});
	assert.equal(calls, 0);
	const other = workspace();
	assert.equal(Object.keys((await read(other.value)).settingsWrites).length, 0);
	const db = await new Promise<IDBDatabase>((resolve) => {
		const request = indexedDB.open('thingtime-mail-v1');
		request.onsuccess = () => resolve(request.result);
	});
	const rows = await new Promise<any[]>((resolve) => {
		const request = db.transaction('records').objectStore('records').index('scope').getAll(w.value.key);
		request.onsuccess = () => resolve(request.result);
	});
	assert.equal(
		rows.some((row) => JSON.stringify(row).includes('synthetic-password-only')),
		false
	);
	assert.equal(rows.filter((row) => row.key.startsWith('settings-write:')).length, 1);
	db.close();
	w.online();
	await run(w.value, async (body) => {
		calls++;
		assert.equal((body.account as MailAccount).servers.imap!.password, 'synthetic-password-only');
		return response(body);
	});
	local = await read(w.value);
	assert.equal(calls, 1);
	assert.deepEqual(local.settingsWrites, {});
	assert.equal(mailRemoteRevision(local, 'mail-account', local.state.accounts[0]), 1);
});

test('anonymous edits, inboxes and removal never acquire an account outbox or call transport', async () => {
	const w = workspace(true),
		a = account();
	a.sync.cloud = false;
	a.sync.local = true;
	let local = await edit(w.value, a);
	local.state.folders = [{ id: 'folder_fixture', accountId: a.id, protocol: 'imap', path: 'INBOX', name: 'Inbox', inbox: true }];
	await writeMailLocal(w.value.scope, local, w.value.lease);
	local = await updateMailLocal(w.value.scope, w.value.lease, (value) =>
		editMailInbox(value, w.value.scope, { id: 'inbox_fixture', name: 'My view', folderIds: ['folder_fixture'], revision: 0 })
	);
	assert.deepEqual(local.settingsWrites, {});
	await run(w.value, async () => {
		throw Error('anonymous transport called');
	});
	await assert.rejects(edit(w.value, { ...local.state.accounts[0], sync: { cloud: true, local: false } }), /Anonymous/);
	await updateMailLocal(w.value.scope, w.value.lease, (value) => deleteMailSettings(value, w.value.scope, 'mail-account', a.id));
	assert.deepEqual((await read(w.value)).settingsWrites, {});
});

test('lost receipt reuses exact request while a newer local edit remains independent', async () => {
	const w = workspace(),
		a = account();
	await edit(w.value, a);
	let frozen = '',
		calls = 0;
	await run(w.value, async (body) => {
		frozen = JSON.stringify(body);
		calls++;
		throw Error('response lost');
	});
	let local = await read(w.value);
	await edit(w.value, { ...local.state.accounts[0], name: 'Newer device edit' });
	await run(
		w.value,
		async (body) => {
			assert.equal(JSON.stringify(body), frozen);
			calls++;
			return response(body);
		},
		() => 1_060_001
	);
	local = await read(w.value);
	assert.equal(local.state.accounts[0].name, 'Newer device edit');
	assert.equal(local.state.accounts[0].revision, 2);
	assert.equal(Object.keys(local.settingsWrites).length, 1);
	await run(
		w.value,
		async (body) => {
			assert.equal((body.account as MailAccount).revision, 1);
			assert.equal((body.account as MailAccount).name, 'Newer device edit');
			calls++;
			return response(body);
		},
		() => 1_060_002
	);
	local = await read(w.value);
	assert.equal(calls, 3);
	assert.deepEqual(local.settingsWrites, {});
	assert.equal(local.state.accounts[0].revision, 2);
});

test('slow transport does not lock local editing and two workers dispatch only one attempt', async () => {
	const w = workspace(),
		a = account();
	await edit(w.value, a);
	const started = latch(),
		release = latch();
	let calls = 0;
	const worker = run(w.value, async (body) => {
		calls++;
		started.resolve();
		await release.promise;
		return response(body);
	});
	await started.promise;
	await run(w.value, async () => {
		calls++;
		throw Error('competing worker must not send');
	});
	const before = (await read(w.value)).state.accounts[0];
	await edit(w.value, { ...before, name: 'Edited during request' });
	assert.equal((await read(w.value)).state.accounts[0].name, 'Edited during request');
	release.resolve();
	await worker;
	const local = await read(w.value);
	assert.equal(calls, 1);
	assert.equal(local.state.accounts[0].name, 'Edited during request');
	assert.equal(Object.keys(local.settingsWrites).length, 1);
	await assert.rejects(edit(w.value, { ...before, name: 'Stale editor' }), /Reopen/);
});

test('coalescing unsent edits keeps local versions monotonic across acknowledgement and refresh', async () => {
	const w = workspace(),
		a = account();
	await edit(w.value, a);
	for (const name of ['Second', 'Third', 'Fourth']) {
		const local = await read(w.value);
		await edit(w.value, { ...local.state.accounts[0], name });
	}
	let remote!: MailAccount;
	await run(w.value, async (body) => {
		assert.equal((body.account as MailAccount).revision, 0);
		remote = response(body).account!;
		return response(body);
	});
	const local = await read(w.value),
		current = local.state.accounts[0];
	assert.equal(current.revision, 4);
	assert.equal(mailRemoteRevision(local, 'mail-account', current), 1);
	assert.equal(mergeMailSettings(local, 'mail-account', [remote]).values[0].revision, 4);
	assert.equal(mergeMailSettings(local, 'mail-account', [{ ...remote, revision: 2, name: 'Changed elsewhere' }]).values[0].revision, 5);
});

test('refused writes preserve pending edits, do not block other records, and require an exact explicit review', async () => {
	const w = workspace(),
		a = account(),
		b = account();
	await edit(w.value, a);
	await edit(w.value, b);
	await run(w.value, async (body) => {
		if ((body.account as MailAccount).id === a.id) throw Object.assign(Error('private provider prose'), { status: 409 });
		return response(body);
	});
	let local = await read(w.value),
		reviewed = local.settingsWrites[mailSettingsKey('mail-account', a.id)];
	assert.equal(Object.keys(local.settingsWrites).length, 1);
	assert.equal(reviewed.status, 409);
	assert.equal(JSON.stringify(reviewed).includes('private provider prose'), false);
	assert.equal(mergeMailSettings(local, 'mail-account', [{ ...publicMailAccount(a), revision: 6, name: 'Remote' }]).values[0].name, a.name);
	await run(
		w.value,
		async () => {
			throw Error('refused write retried automatically');
		},
		() => 9_000_000
	);
	await edit(w.value, { ...local.state.accounts.find((row) => row.id === a.id)!, name: 'Still editable' });
	local = await read(w.value);
	assert.throws(() => adoptRemoteMailSettings(local, reviewed, null), /Review/);
	reviewed = local.settingsWrites[mailSettingsKey('mail-account', a.id)];
	await updateMailLocal(w.value.scope, w.value.lease, (value) =>
		adoptRemoteMailSettings(value, reviewed, { ...publicMailAccount(a), revision: 8, name: 'Explicit account choice' })
	);
	local = await read(w.value);
	assert.deepEqual(local.settingsWrites, {});
	assert.equal(local.state.accounts.find((row) => row.id === a.id)!.name, 'Explicit account choice');
	assert.equal(mailRemoteRevision(local, 'mail-account', local.state.accounts.find((row) => row.id === a.id)!), 8);
});

test('removal before dispatch cancels an unsent create; removal during dispatch waits for its receipt', async () => {
	const w = workspace(),
		a = account(),
		b = account();
	await edit(w.value, a);
	await updateMailLocal(w.value.scope, w.value.lease, (local) => deleteMailSettings(local, w.value.scope, 'mail-account', a.id));
	assert.deepEqual((await read(w.value)).settingsWrites, {});
	await edit(w.value, b);
	const started = latch(),
		release = latch();
	const worker = run(w.value, async (body) => {
		started.resolve();
		await release.promise;
		return response(body);
	});
	await started.promise;
	await updateMailLocal(w.value.scope, w.value.lease, (local) => deleteMailSettings(local, w.value.scope, 'mail-account', b.id));
	assert.equal((await read(w.value)).state.accounts.length, 0);
	release.resolve();
	await worker;
	await run(w.value, async (body) => {
		assert.equal(body.operation, 'delete');
		assert.equal(body.id, b.id);
		assert.equal(body.revision, 1);
		return response(body);
	});
	assert.deepEqual((await read(w.value)).settingsWrites, {});
});

test('sign-out and disconnect after a remote response leave the durable attempt available for safe retry', async () => {
	for (const retire of [true, false]) {
		const w = workspace(),
			a = account();
		await edit(w.value, a);
		const started = latch(),
			release = latch();
		const worker = run(w.value, async (body) => {
			started.resolve();
			await release.promise;
			return response(body);
		});
		await started.promise;
		if (retire) w.retire();
		else w.offline();
		release.resolve();
		await assert.rejects(worker, /retired|offline/);
		const activeLease = { assertCurrent() {}, onInvalidate: () => () => {} };
		const local = await readMailLocal(w.value.scope, activeLease);
		assert.equal(Object.keys(local.settingsWrites).length, 1);
		assert.equal(local.settingsRemoteRevisions[mailSettingsKey('mail-account', a.id)], 0);
	}
});

test('invalid receipts never advance sync or permit discarding an uncertain attempt', async () => {
	const w = workspace(),
		a = account();
	await edit(w.value, a);
	await run(w.value, async (body) => ({ account: { ...response(body).account!, id: 'wrong_identity' } }));
	const local = await read(w.value),
		pending = Object.values(local.settingsWrites)[0];
	assert.equal(local.settingsRemoteRevisions[mailSettingsKey('mail-account', a.id)], 0);
	assert.throws(() => adoptRemoteMailSettings(local, pending, null), /uncertain/);
});

test('proxy inbox edits and removals use their own server token and preserve canonical folder references', async () => {
	const w = workspace(),
		a = account();
	let initial = emptyLocalMail();
	initial.state.accounts = [{ ...publicMailAccount(a), revision: 4 }];
	initial.state.folders = [{ id: 'cloud_folder', accountId: a.id, protocol: 'imap', path: 'INBOX', name: 'Inbox', inbox: true }];
	await writeMailLocal(w.value.scope, initial, w.value.lease);
	await updateMailLocal(w.value.scope, w.value.lease, (local) =>
		editMailInbox(local, w.value.scope, { id: 'cloud_inbox', name: 'Together', revision: 0, folderIds: ['cloud_folder'] })
	);
	await run(w.value, async (body) => {
		assert.equal(body.operation, 'save-inbox');
		assert.deepEqual((body.inbox as any).folderIds, ['cloud_folder']);
		return response(body);
	});
	const local = await read(w.value);
	assert.equal(local.state.inboxes[0].revision, 1);
	assert.deepEqual(local.settingsWrites, {});
	await updateMailLocal(w.value.scope, w.value.lease, (value) => deleteMailSettings(value, w.value.scope, 'mail-inbox', 'cloud_inbox'));
	await run(w.value, async (body) => {
		assert.equal(body.revision, 1);
		return response(body);
	});
	assert.equal((await read(w.value)).state.inboxes.length, 0);
});

test('an older account snapshot cannot rewind an acknowledged local edit or its server token', async () => {
	const w = workspace(),
		a = account();
	await edit(w.value, a);
	await run(w.value, async (body) => response(body));
	let local = await read(w.value);
	await edit(w.value, { ...local.state.accounts[0], name: 'New saved name' });
	await run(w.value, async (body) => response(body));
	local = await read(w.value);
	const merged = mergeMailSettings(local, 'mail-account', [{ ...publicMailAccount(a), revision: 1 }]);
	assert.equal(merged.values[0].name, 'New saved name');
	assert.equal(merged.revisions[mailSettingsKey('mail-account', a.id)], 2);
	await updateMailLocal(w.value.scope, w.value.lease, (value) => deleteMailSettings(value, w.value.scope, 'mail-account', a.id));
	await assert.rejects(edit(w.value, a), /pending removal/);
});
