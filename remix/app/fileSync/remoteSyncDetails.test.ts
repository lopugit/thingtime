import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRemoteSyncDetailsCommand } from './remoteSyncDetails';
import { executeRemoteSyncDetails, type RemoteSyncDetailsContext } from './remoteSyncDetails.client';
import { newFileSyncConfiguration } from './configuration';
import type { FolderHost } from './desktopFolders.client';
import type { SyncScope } from './reconcile';
import type { openSyncJournal } from './journal.client';

const scope: SyncScope = { origin: 'https://example.test', ownerId: 'owner', deviceId: 'device', dataPlane: 'home', rootId: 'connection' };
const row = () => ({ id: 'connection', author: { id: 'owner' }, acl: ['tt:user'], thingtime: ['file-sync'], updatedAt: '2026-10-23T00:00:00Z',
	crystal: newFileSyncConfiguration({ name: 'Documents', deviceId: 'device', localRootId: 'local', remoteFolderId: 'cloud' }) });
const context = (thing = row(), select = scope): RemoteSyncDetailsContext => ({
	ownerId: 'owner', deviceId: 'device', signal: new AbortController().signal, check() {}, scope: () => select,
	host: { origin: () => 'https://example.test', fetch: async () => new Response(JSON.stringify({ thing }), { headers: { 'Content-Type': 'application/json' } }) } as unknown as FolderHost
});

test('remote journal selectors accept paged metadata and refuse native path escapes or unexpected properties', () => {
	assert.deepEqual(validateRemoteSyncDetailsCommand({ action: 'progress', connectionId: 'connection', runId: 'run', parent: 'Photos', after: 'Photos/old' }),
		{ action: 'progress', connectionId: 'connection', runId: 'run', parent: 'Photos', after: 'Photos/old' });
	for (const value of [
		{ action: 'progress', connectionId: 'connection', runId: 'run', parent: '../private' },
		{ action: 'coverage', connectionId: 'connection', inventoryId: 'inventory', generation: 'generation', offset: -1 },
		{ action: 'details', connectionId: 'connection', ownerId: 'other' },
		{ action: 'priorities', connectionId: 'connection', operation: 'read', paths: [] },
		{ action: 'priorities', connectionId: 'connection', operation: 'save', paths: ['one', 'one'], expectedRevision: 0 },
		{ action: 'priorities', connectionId: 'connection', operation: 'save', paths: ['Documents'], expectedRevision: 0.5 }
	]) assert.throws(() => validateRemoteSyncDetailsCommand(value));
});

test('remote journal access rechecks the exact owned connection and device before reading any metadata', async () => {
	let reads = 0;
	const dependencies = { details: () => { reads++; return {}; } };
	await assert.rejects(executeRemoteSyncDetails({ action: 'details', connectionId: 'connection' }, context({ ...row(), author: { id: 'other' } }), dependencies));
	await assert.rejects(executeRemoteSyncDetails({ action: 'details', connectionId: 'connection' }, context({ ...row(), crystal: { ...row().crystal, deviceId: 'foreign' } }), dependencies));
	await assert.rejects(executeRemoteSyncDetails({ action: 'details', connectionId: 'connection' }, context(row(), { ...scope, ownerId: 'other' }), dependencies));
	assert.equal(reads, 0);
	assert.deepEqual(await executeRemoteSyncDetails({ action: 'details', connectionId: 'connection' }, context(), dependencies), {});
	assert.equal(reads, 1);
});

test('stale remote run and backup generations never fall through to a different journal capture', async () => {
	let opens = 0;
	const dependencies = { details: () => ({ progressDescriptor: { scope, run: { id: 'new-run' } } as any,
		inventoryDescriptor: { scope, inventory: { id: 'inventory', source: 'local' as const, generation: 'new-generation' } } }),
		open: (async () => { opens++; throw Error('Unexpected journal open'); }) as typeof openSyncJournal };
	await assert.rejects(executeRemoteSyncDetails({ action: 'progress', connectionId: 'connection', runId: 'old-run' }, context(), dependencies), /run changed/);
	await assert.rejects(executeRemoteSyncDetails({ action: 'coverage', connectionId: 'connection', inventoryId: 'inventory', generation: 'old-generation' }, context(), dependencies), /inventory changed/);
	assert.equal(opens, 0);
});

test('remote upload priority saves keep revision CAS and current exclusions on the native journal', async () => {
	const thing = row(); thing.crystal.excludedPaths = ['Private'];
	let saves = 0, closes = 0;
	const open = (async () => ({ close() { closes++; }, priorities(access: any) {
		assert.deepEqual(access.currentScope(), scope);
		return { async read() { return { revision: 7, paths: ['Documents'] }; }, async save(paths: string[], revision: number) {
			saves++; assert.equal(revision, 7); return { revision: 8, paths };
		} };
	} })) as unknown as typeof openSyncJournal;
	const result = await executeRemoteSyncDetails({ action: 'priorities', connectionId: 'connection', operation: 'save', paths: ['Photos'], expectedRevision: 7 }, context(thing), { open });
	assert.deepEqual(result, { revision: 8, paths: ['Photos'] });
	await assert.rejects(executeRemoteSyncDetails({ action: 'priorities', connectionId: 'connection', operation: 'save', paths: ['Private/secret'], expectedRevision: 7 }, context(thing), { open }), /excluded/);
	assert.equal(saves, 1); assert.equal(closes, 2);
});
