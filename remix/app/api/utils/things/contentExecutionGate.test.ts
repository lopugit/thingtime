import assert from 'node:assert/strict';
import test from 'node:test';
import { contentExecutionHold, recordCreationContentEpoch, type ContentExecutionHold } from './contentExecutionGate';
const hold: ContentExecutionHold = { version: 1, operationId: 'new-operation', completionEventId: 'new-server-completion', rootId: 'selected-root', binding: 'a'.repeat(64) };

test('canonical content mutations fence old held ownership during transfer, deduping unchanged provenance', async () => {
	for (const afterOwner of ['old-owner', 'new-owner']) {
		const updates: any[] = [];
		const collection = {
			findOne: async (filter: any) => filter.ownerId === 'old-owner' ? { creationCheckpoint: { contentEpoch: 7 } } : null,
			updateOne: async (filter: any, update: any, options: any) => { updates.push({ filter, update, options }); return { modifiedCount: 1 }; }
		};
		const before = { ownerId: 'old-owner', executionHold: hold }, after = { ownerId: afterOwner, executionHold: hold };
		const session = { id: 'same-content-transaction' };
		await recordCreationContentEpoch(collection, before, after, session);
		assert.equal(updates.length, 1);
		assert.equal(updates[0].filter.ownerId, 'old-owner');
		assert.equal(updates[0].filter['creationCheckpoint.contentEpoch'], 7);
		assert.deepEqual(updates[0].update, { $inc: { 'creationCheckpoint.contentEpoch': 1 } });
		assert.equal(updates[0].options.session, session);
	}
});

test('unheld ordinary writes do not acquire an operation fence; forged hold fields refuse', async () => {
	await recordCreationContentEpoch({ findOne: () => { throw Error('Unexpected operation query'); } }, null, { ownerId: 'owner' }, {});
	assert.throws(() => contentExecutionHold({ ...hold, binding: 'forged' }));
	assert.throws(() => contentExecutionHold({ ...hold, archivedReceipt: 'old-operation' } as any));
});
