import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { bindLocalWorkspace } from '../local-workspace/runtime.client';
import type { WorkspaceScope } from '../local-workspace/storage';
import { rootIdentity } from '../utils/rootIdentity';
import { currentMailWorkspace, withMailRemote } from './workspace.client';
import { emptyLocalMail, readMailLocal, writeMailLocal, mailStorageKey } from './localStore';
import { mailRequest, relayMailRequest } from './client';
import type { MailAccount } from './model';

const account = { kind: 'account', origin: 'https://mail.example', ownerId: 'mail_owner', dataPlane: 'home' } as const;
const bind = (scope: WorkspaceScope, confirmed = false) => {
	rootIdentity.changed();
	const generation = rootIdentity.read().generation;
	bindLocalWorkspace(scope.kind === 'anonymous', generation, scope.kind === 'account' ? scope : undefined, confirmed);
	rootIdentity.confirm(generation);
	return currentMailWorkspace()!;
};
const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
};

test('anonymous and offline mail open encrypted device data without any cloud discovery or fetch', async () => {
	const original = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = async () => {
		requests++;
		throw new Error('unexpected network');
	};
	try {
		const anonymous = bind({ kind: 'anonymous' });
		const content = emptyLocalMail();
		content.connectorToken = 'synthetic-pairing-token-not-an-account-credential';
		content.state.messages = Array.from({ length: 2001 }, (_, i) => ({
			id: `message_${i}`,
			accountId: 'mailbox_one',
			folderId: 'folder_one',
			remoteId: String(i),
			subject: `Message ${i}`,
			from: 'sender@example.test',
			to: 'reader@example.test',
			date: null,
			text: 'Retained body',
			unread: true,
			attachmentCount: 0,
			truncated: false
		}));
		await writeMailLocal(anonymous.scope, content, anonymous.lease);
		const reopened = await readMailLocal(anonymous.scope, anonymous.lease);
		assert.equal(reopened.state.messages.length, 2001);
		assert.equal(reopened.connectorToken, content.connectorToken);
		assert.equal(anonymous.canSync(), false);
		await assert.rejects(mailRequest(account.ownerId), /Sign in/);
		await assert.rejects(relayMailRequest(account.ownerId, {} as MailAccount, {}, new AbortController().signal), /Sign in/);
		const offline = bind(account);
		assert.equal((await readMailLocal(offline.scope, offline.lease)).state.messages.length, 0);
		await assert.rejects(mailRequest(account.ownerId), /offline/);
		assert.equal(requests, 0, 'refuse before capability negotiation or cookie-bearing fetch');
	} finally {
		globalThis.fetch = original;
	}
});

test('mail home storage preserves same-origin keys but separates selected origins and anonymous identities', async () => {
	const first = bind(account);
	const content = emptyLocalMail();
	content.connectorToken = 'origin-one-fixture';
	await writeMailLocal(first.scope, content, first.lease);
	assert.equal(mailStorageKey(first.scope), `${account.origin}:${account.ownerId}`);
	const differentOrigin = bind({ ...account, origin: 'https://second.example' });
	assert.equal((await readMailLocal(differentOrigin.scope, differentOrigin.lease)).connectorToken, '');
	const differentOwner = bind({ ...account, ownerId: 'different_owner' });
	assert.equal((await readMailLocal(differentOwner.scope, differentOwner.lease)).connectorToken, '');
	const customPlane = bind({ ...account, dataPlane: 'custom-plane' });
	assert.equal((await readMailLocal(customPlane.scope, customPlane.lease)).connectorToken, 'origin-one-fixture', 'mail remains on its home plane');
	await assert.rejects(readMailLocal(first.scope, first.lease), /workspace changed/i);
	const again = bind({ kind: 'anonymous' });
	assert.notEqual((await readMailLocal(again.scope, again.lease)).connectorToken, 'origin-one-fixture');
});

test('identity retirement during encryption refuses a stale write and preserves the durable revision', async () => {
	const workspace = bind(account);
	const before = await readMailLocal(workspace.scope, workspace.lease);
	const started = deferred(),
		release = deferred();
	const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
	const original = crypto.subtle.encrypt;
	crypto.subtle.encrypt = async (...args) => {
		started.resolve();
		await release.promise;
		return encrypt(...args);
	};
	try {
		const saving = writeMailLocal(workspace.scope, { ...before, connectorToken: 'retired-change' }, workspace.lease);
		const refused = assert.rejects(saving, /workspace changed/i);
		await started.promise;
		bind({ kind: 'anonymous' });
		release.resolve();
		await refused;
	} finally {
		crypto.subtle.encrypt = original;
		release.resolve();
	}
	const reopened = bind(account);
	assert.deepEqual(await readMailLocal(reopened.scope, reopened.lease), before);
});

test('retirement during decryption never returns plaintext to the old screen', async () => {
	const workspace = bind(account);
	const started = deferred(),
		release = deferred();
	const original = crypto.subtle.decrypt,
		decrypt = original.bind(crypto.subtle);
	crypto.subtle.decrypt = async (...args) => {
		started.resolve();
		await release.promise;
		return decrypt(...args);
	};
	try {
		const reading = readMailLocal(workspace.scope, workspace.lease);
		const refused = assert.rejects(reading, /workspace changed/i);
		await started.promise;
		bind({ kind: 'anonymous' });
		release.resolve();
		await refused;
	} finally {
		crypto.subtle.decrypt = original;
		release.resolve();
	}
});

test('identity retirement during the IndexedDB write rolls back rows and the revision together', async () => {
	const workspace = bind(account);
	const before = await readMailLocal(workspace.scope, workspace.lease);
	const original = IDBObjectStore.prototype.put;
	let retired = false;
	IDBObjectStore.prototype.put = function (...args) {
		const request = original.apply(this, args);
		if (this.name === 'records' && !retired) {
			retired = true;
			bind({ kind: 'anonymous' });
		}
		return request;
	};
	try {
		await assert.rejects(writeMailLocal(workspace.scope, { ...before, connectorToken: 'must-roll-back' }, workspace.lease));
		assert.equal(retired, true);
	} finally {
		IDBObjectStore.prototype.put = original;
	}
	const reopened = bind(account);
	assert.deepEqual(await readMailLocal(reopened.scope, reopened.lease), before);
});

test('remote mail requires matching confirmed identity and cancels on confirmation loss without disabling local reads', async () => {
	const workspace = bind(account, true);
	let calls = 0;
	await assert.rejects(
		withMailRemote('other_owner', undefined, async () => {
			calls++;
		}),
		/Sign in/
	);
	const started = deferred(),
		release = deferred();
	let observedSignal!: AbortSignal;
	const pending = withMailRemote(account.ownerId, undefined, async (signal) => {
		calls++;
		observedSignal = signal;
		started.resolve();
		await release.promise;
		return 'late reply';
	});
	const refused = assert.rejects(pending, /aborted/i);
	await started.promise;
	bindLocalWorkspace(false, rootIdentity.read().generation, account, false);
	assert.equal(observedSignal.aborted, true);
	release.resolve();
	await refused;
	workspace.lease.assertCurrent();
	assert.equal(workspace.canSync(), false);
	await readMailLocal(workspace.scope, workspace.lease);
	assert.equal(calls, 1);
});
