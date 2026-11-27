import assert from 'node:assert/strict';
import test from 'node:test';

import { createDeviceDiagnosticsService } from './deviceDiagnostics';

// auth/me calls ensure on every request. Creating the private Debug folder needs
// a transaction; finding the existing one must not open one.
test('ensure reads an existing Debug folder without opening a transaction', async () => {
	const rows = new Map<string, any>();
	let transactions = 0;
	let inserts = 0;
	const things = { findOne: async (filter: any) => rows.get(filter.shareId) ?? null };
	const service = createDeviceDiagnosticsService({
		things: async () => things,
		transaction: async (work) => {
			transactions++;
			return work({ id: 'session' });
		},
		insert: (async (_collection: any, doc: any) => {
			inserts++;
			rows.set(doc.shareId, doc);
		}) as any,
		customPlane: () => false,
		now: () => new Date('2026-11-27T00:00:00.000Z')
	});

	const first = await service.ensure('user-1', 'https://thingtime.com');
	assert.equal(first.ok, true);
	assert.equal(first.folder?.name, 'Debug');
	assert.equal(transactions, 1, 'the first call creates the folder in a transaction');
	assert.equal(inserts, 1);

	for (let i = 0; i < 3; i++) {
		const again = await service.ensure('user-1', 'https://thingtime.com');
		assert.equal(again.folder?.id, first.folder?.id);
		assert.equal(again.settings.enabled, true);
	}
	assert.equal(transactions, 1, 'later calls are a single read');
	assert.equal(inserts, 1);
});

test('ensure still refuses a folder whose identity changed', async () => {
	const service = createDeviceDiagnosticsService({
		things: async () => ({ findOne: async () => ({ shareId: 'x', ownerId: 'someone-else', acl: ['tt:user'], thingtime: ['folder'] }) }),
		transaction: async (work) => work({}),
		customPlane: () => false
	});
	await assert.rejects(service.ensure('user-1', 'https://thingtime.com'), /Debug folder identity changed/);
});
