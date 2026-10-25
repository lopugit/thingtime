import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { LocalActions } from './actions';
import { AccountFileSync, type AccountFileTransport } from './accountFiles';
import { AccountThingSync } from './accountSync';
import { localActionRequests } from './actionRequests';
import { LocalThings } from './things';
import { WorkspaceDatabase } from './storage';

const makeAction = (endpoint: string, body?: unknown, query?: unknown) => ({ thingtime: ['action'], crystal: {
	name: 'Local attachment action', runtime: 'browser', version: 1,
	capabilities: [{ capability: 'http.request', endpoints: [endpoint] }],
	steps: [{ op: 'http.request', method: endpoint.startsWith('GET ') ? 'GET' : 'POST', path: endpoint.slice(endpoint.indexOf(' ') + 1),
		feature: endpoint.includes('/content') ? 'api.attachment-content' : endpoint.includes('/annotate') ? 'api.attachment-annotate' : 'api.attachment-delete',
		minimumVersion: endpoint.includes('/content') ? '1.18.0' : endpoint.includes('/annotate') ? '1.2.0' : '1.8.0', ...(body === undefined ? {} : { body }), ...(query === undefined ? {} : { query }) },
		{ op: 'return', value: '$step.1' }]
} });

test('anonymous local file bytes stay readable offline while unsupported binary HTTP Actions and foreign or retired leases fail closed', async () => {
	const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), scope = { kind: 'anonymous' } as const;
	let active = true;
	const lease = { assertCurrent() { if (!active) throw Error('Workspace changed'); }, onInvalidate: () => () => {} };
	const things = new LocalThings(db, scope, lease), actions = new LocalActions(db, scope, lease), bytes = new TextEncoder().encode('offline original\0');
	const accountScope = { kind: 'account' as const, origin: 'https://files.test', ownerId: 'owner', dataPlane: 'home' };
	const accountUsageBefore = await db.transaction(accountScope, 'readonly', lease, tx => tx.usage());
	const originalFetch = globalThis.fetch; let fetches = 0;
	globalThis.fetch = async () => { fetches++; throw Error('Network forbidden'); };
	try {
		const file = await things.saveFile({ requestId: randomUUID(), name: 'local.txt', contentType: 'text/plain', bytes });
		assert.deepEqual((await things.readFile(file.id)).bytes, bytes);
		const reader = await things.create(makeAction(`GET /api/v1/attachments/content`, undefined, { id: file.id }));
		assert.equal(await actions.canRunLocally(reader.id), false, 'the HTTP Action interpreter only supports JSON responses');
		assert.equal((await actions.run({ action: reader.id })).status, 'error');
		const annotator = await things.create(makeAction('POST /api/v1/attachments/annotate', { id: file.id, title: 'Local title' }));
		const annotated = await actions.run({ action: annotator.id });
		assert.equal(annotated.status, 'ok', annotated.error);
		const localAnnotated = await things.get(file.id);
		assert.equal(localAnnotated.crystal.title, 'Local title');
		assert.equal((annotated.result as any).updatedAt, localAnnotated.updatedAt);
		const staleAnnotation = await things.create(makeAction('POST /api/v1/attachments/annotate', { id: file.id, title: 'stale', expectedUpdatedAt: file.updatedAt }));
		assert.equal(await actions.canRunLocally(staleAnnotation.id), false, 'the local writer refuses an unsupported optimistic-version field');
		const targetDelete = await things.create(makeAction('POST /api/v1/attachments/delete', { id: file.id, targetId: 'post' }));
		assert.equal(await actions.canRunLocally(targetDelete.id), false, 'bound-target deletion requires the dedicated owning editor');
		const linked = await things.saveLinkedFile({ requestId: randomUUID(), url: 'https://media.test/file.png', purpose: 'post' });
		const linkedReader = await things.create(makeAction('GET /api/v1/attachments/content', undefined, { id: linked.id }));
		assert.equal(await actions.canRunLocally(linkedReader.id), false);
		const bound = await things.saveFile({ requestId: randomUUID(), name: 'bound.txt', contentType: 'text/plain', purpose: 'post', bytes });
		const boundAnnotation = await things.create(makeAction('POST /api/v1/attachments/annotate', { id: bound.id, title: 'Not allowed' }));
		assert.equal((await actions.run({ action: boundAnnotation.id })).status, 'error');
		const unavailable = await things.saveFile({ requestId: randomUUID(), name: 'missing.txt', contentType: 'text/plain', bytes });
		await db.transaction(scope, 'readwrite', lease, tx => tx.deleteBytes(unavailable.id));
		await assert.rejects(things.readFile(unavailable.id), /missing|not stored/i);
		await assert.rejects(things.readFile('local-file-foreign'), /not stored/i);
		const removed = await things.create(makeAction('POST /api/v1/attachments/delete', { id: file.id }));
		const deletion = await actions.run({ action: removed.id });
		assert.equal(deletion.status, 'ok', deletion.error);
		assert.equal((deletion.result as any).deleted, true);
		await assert.rejects(things.get(file.id), /not in this workspace/i);
		assert.deepEqual(await db.transaction(accountScope, 'readonly', lease, tx => tx.usage()), accountUsageBefore, 'anonymous Actions do not write any records or bytes into the account partition');
		active = false;
		await assert.rejects(actions.run({ action: reader.id }), /Workspace changed/);
		assert.equal(fetches, 0);
	} finally { globalThis.fetch = originalFetch; await db.close(); }
});

test('account-home file Action completes locally and leaves the captured deletion queue for its sync worker', async () => {
	const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), scope = { kind: 'account', origin: 'https://files.test', ownerId: 'owner', dataPlane: 'home' } as const;
	let active = true;
	const lease = { assertCurrent() { if (!active) throw Error('Workspace changed'); }, onInvalidate: () => () => {} };
	const files = new AccountFileSync(db, scope, lease), sync = new AccountThingSync(db, scope, lease), actions = new LocalActions(db, scope, lease, sync);
	const bytes = new TextEncoder().encode('account-home original'), requestId = randomUUID();
	const file = await files.things.saveFile({ requestId, name: 'account.txt', contentType: 'text/plain', bytes });
	const calls: string[] = [];
	const transport: AccountFileTransport = {
		start: async () => { calls.push('start'); return { id: 'server-file', partSizeBytes: bytes.length, partCount: 1 }; },
		parts: async (_id, parts) => parts.map(part => ({ ...part, url: 'https://storage.test/part', headers: {}, expiresAt: new Date(Date.now() + 60_000).toISOString() })),
		put: async () => { calls.push('put'); },
		complete: async () => { calls.push('complete'); return { id: 'server-file', name: 'account.txt', size: bytes.length, contentType: 'text/plain', mediaKind: 'file' }; }
	};
	try {
		await files.sync(transport);
		calls.length = 0;
		const annotator = await files.things.create(makeAction('POST /api/v1/attachments/annotate', { id: file.id, title: 'Queued local title' }));
		const annotation = await actions.run({ action: annotator.id });
		assert.equal(annotation.status, 'ok', annotation.error);
		const accountAnnotated = await files.things.get(file.id);
		assert.equal(accountAnnotated.crystal.title, 'Queued local title');
		assert.equal((annotation.result as any).updatedAt, accountAnnotated.updatedAt);
		assert.equal((await files.metadata.status()).find(row => row.id === file.id)?.state, 'pending');
		assert.deepEqual(calls, [], 'metadata remains in its independent local queue until its worker runs');
		const remover = await files.things.create(makeAction('POST /api/v1/attachments/delete', { id: file.id }));
		const result = await actions.run({ action: remover.id });
		assert.equal(result.status, 'ok', result.error);
		assert.deepEqual(result.result, { ok: true, local: true, queued: true });
		assert.deepEqual(calls, [], 'Action execution must not run the remote deletion worker');
		const status = await files.status();
		assert.equal(status.find(row => row.id === file.id)?.state, 'pending');
		assert.deepEqual((await files.library()).things, []);
		active = false;
		await assert.rejects(files.readFile(file.id), /Workspace changed/);
	} finally { await db.close(); }
});

test('account library writers recheck binding, draft and expiry inside their own write transactions', async () => {
	const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), scope = { kind: 'account', origin: 'https://files.test', ownerId: 'owner', dataPlane: 'home' } as const;
	const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, files = new AccountFileSync(db, scope, lease), bytes = new TextEncoder().encode('guarded file');
	try {
		for (const state of ['bound', 'draft', 'expired']) {
			const file = await files.things.saveFile({ requestId: randomUUID(), name: `${state}.txt`, contentType: 'text/plain', bytes });
			await db.transaction(scope, 'readwrite', lease, async tx => {
				const row = await tx.get<any>('things', file.id);
				if (state === 'bound') row.targetId = 'post-now-bound';
				if (state === 'draft') row.localAttachment.draftId = 'draft-now-bound';
				if (state === 'expired') row.localAttachment.expiresAt = new Date(Date.now() - 1000).toISOString();
				await tx.put('things', file.id, row);
			});
			await assert.rejects(files.things.annotateLibraryFile({ id: file.id, title: 'must not write' }), /standalone library file|not stored/i);
			await assert.rejects(files.remove(file.id), /owning editor/i);
		}
		assert.deepEqual(await files.metadata.status(), [], 'rejected annotations must not enqueue account metadata writes');
	} finally { await db.close(); }
});

test('an Action library listing that becomes stale before annotation cannot change a newly bound file', async () => {
	const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), scope = { kind: 'anonymous' } as const;
	const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, things = new LocalThings(db, scope, lease), bytes = new TextEncoder().encode('race-safe file');
	try {
		const file = await things.saveFile({ requestId: randomUUID(), name: 'race.txt', contentType: 'text/plain', bytes });
		const listed = await things.snapshot();
		const request = localActionRequests(db, scope, lease, async () => null, undefined, () => ({
			library: async () => {
				await db.transaction(scope, 'readwrite', lease, async tx => {
					const current = await tx.get<any>('things', file.id);
					await tx.put('things', file.id, { ...current, targetId: 'post-bound-after-list' });
				});
				return { things: listed };
			},
			annotateFile: input => things.annotateLibraryFile(input),
			remove: id => things.removeLibraryFile(id)
		}));
		await assert.rejects(request({ method: 'POST', path: '/api/v1/attachments/annotate', feature: 'api.attachment-annotate', minimumVersion: '1.2.0', query: {}, body: { id: file.id, title: 'stale listing' }, maxResultBytes: 1024 }, 'local-workspace', new AbortController().signal), /standalone library file/i);
		assert.equal((await things.get(file.id)).targetId, 'post-bound-after-list');
		assert.equal((await things.get(file.id)).crystal.title, undefined);
	} finally { await db.close(); }
});

test('anonymous library deletion keeps normal child cascades and refuses protected child records atomically', async () => {
	const db = new WorkspaceDatabase(new IDBFactory(), undefined, undefined, IDBKeyRange), scope = { kind: 'anonymous' } as const;
	const lease = { assertCurrent() {}, onInvalidate: () => () => {} }, things = new LocalThings(db, scope, lease), bytes = new TextEncoder().encode('file with children');
	try {
		const file = await things.saveFile({ requestId: randomUUID(), name: 'comments.txt', contentType: 'text/plain', bytes });
		const comment = await things.create({ thingtime: ['comment'], targetId: file.id, crystal: { text: 'A file comment' } });
		const reaction = { id: 'file-reaction', thingtime: ['reaction'], targetId: file.id, crystal: { emoji: '❤️' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1 };
		await db.transaction(scope, 'readwrite', lease, tx => tx.put('things', reaction.id, reaction));
		const deleted = await things.removeLibraryFile(file.id);
		assert.deepEqual(new Set(deleted.deleted), new Set([file.id, comment.id, reaction.id]));
		await assert.rejects(things.get(file.id), /not in this workspace/i);
		await assert.rejects(things.get(comment.id), /not in this workspace/i);
		await assert.rejects(things.get(reaction.id), /not in this workspace/i);

		const protectedFile = await things.saveFile({ requestId: randomUUID(), name: 'protected.txt', contentType: 'text/plain', bytes });
		await db.transaction(scope, 'readwrite', lease, tx => tx.put('things', 'action-run-protected', {
			id: 'action-run-protected', thingtime: ['action-run'], crystal: {}, targetId: protectedFile.id,
			createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1
		}));
		await assert.rejects(things.removeLibraryFile(protectedFile.id), /protected run history/i);
		assert.deepEqual((await things.readFile(protectedFile.id)).bytes, bytes);
		assert.ok(await db.transaction(scope, 'readonly', lease, tx => tx.get('things', 'action-run-protected')));
	} finally { await db.close(); }
});
