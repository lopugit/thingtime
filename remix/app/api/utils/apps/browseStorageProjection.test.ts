import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

const remixRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const vite = await createServer({
	root: remixRoot,
	configFile: false,
	appType: 'custom',
	server: { middlewareMode: true },
	resolve: { alias: { '~': path.join(remixRoot, 'app') } }
});
const browse = await vite.ssrLoadModule('/app/api/utils/apps/browse.ts');
const namespace = await vite.ssrLoadModule('/app/api/utils/apps/namespace.ts');
test.after(async () => {
	await vite.close();
});

const { projectAppDataStorage } = browse as typeof import('./browse');
const { APP_STORAGE_ACCOUNTING_VERSION, appStorageCounterMatch } = namespace as typeof import('./namespace');

const now = new Date('2026-08-07T00:00:00.000Z');
const appId = 'app-a';
const ownerId = 'user-a';
const match = appStorageCounterMatch(ownerId, appId);

const counter = (overrides: Record<string, unknown> = {}) => ({
	shareId: match.shareId,
	schemaVersion: match.schemaVersion,
	thingtime: ['app-storage'],
	ownerId,
	acl: ['tt:user'],
	targetId: null,
	tags: [],
	storageLedgerEnvelopeVersion: match.storageLedgerEnvelopeVersion,
	crystal: {
		quotaKind: 'app-storage',
		appId,
		usedBytes: 12_345,
		storageAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION,
		storageLedgerStatus: 'ready',
		...overrides
	},
	createdAt: now,
	updatedAt: now
});

const app = (status = 'ready') => ({
	crystal: {
		storageAllowanceBytes: 100_000,
		storageUsedBytes: 20_000,
		userStorageAllowanceBytes: 25_000,
		storageAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION,
		storageLedgerStatus: status
	}
});

test('app-data summaries use the protected counter as their only exact byte source', () => {
	assert.deepEqual(projectAppDataStorage({ appId, ownerId, app: app(), counter: counter() }), {
		usedBytes: 12_345,
		budgetBytes: 25_000,
		budgetKind: 'finite',
		storageAccountingStatus: 'ready',
		storageAccountingVersion: APP_STORAGE_ACCOUNTING_VERSION
	});
});

test('missing and malformed counters never render as zero', () => {
	for (const candidate of [
		null,
		counter({ usedBytes: -1 }),
		{ ...counter(), thingtime: ['data'] },
		{ ...counter(), extraRootField: 'not-server-owned' }
	]) {
		const projected = projectAppDataStorage({ appId, ownerId, app: app(), counter: candidate });
		assert.equal(projected.usedBytes, null);
		assert.equal(projected.storageAccountingStatus, 'unavailable');
	}
});

test('fenced counters say reconciling and do not expose their stale byte value', () => {
	const projected = projectAppDataStorage({
		appId,
		ownerId,
		app: app('initializing'),
		counter: counter({ storageLedgerStatus: 'needs-reconcile' })
	});
	assert.equal(projected.usedBytes, null);
	assert.equal(projected.storageAccountingStatus, 'reconciling');
});

test('deleted apps retain exact usage but never invent a missing inherited allowance', () => {
	const inherited = projectAppDataStorage({ appId, ownerId, app: null, counter: counter() });
	assert.equal(inherited.storageAccountingStatus, 'ready');
	assert.equal(inherited.usedBytes, 12_345);
	assert.equal(inherited.budgetKind, 'unavailable');
	assert.equal(inherited.budgetBytes, null);

	const explicit = projectAppDataStorage({
		appId,
		ownerId,
		app: null,
		counter: counter({ storageAllowanceBytes: 30_000 })
	});
	assert.equal(explicit.storageAccountingStatus, 'ready');
	assert.equal(explicit.budgetKind, 'finite');
	assert.equal(explicit.budgetBytes, 30_000);
});
