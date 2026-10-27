import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId, Binary } from 'mongodb';
import { storedSnapshotVersion, storedSnapshotMatch } from './storedSnapshot';
const doc = {
	_id: new ObjectId(),
	shareId: 'snapshot',
	ownerId: 'owner',
	updatedAt: new Date('2026-10-17'),
	crystal: { name: 'Fixture' },
	bytes: new Binary(Buffer.from([1, 2]))
};
test('stored comparison tokens preserve BSON, physical identity and unrecognized envelope fields', () => {
	const prefix = 'theme-state-v1:',
		version = storedSnapshotVersion(doc, prefix);
	assert.match(version, /^theme-state-v1:[a-f0-9]{64}$/);
	assert.equal(storedSnapshotVersion(doc, prefix), version);
	for (const changed of [
		{ ...doc, _id: new ObjectId() },
		{ ...doc, extra: true },
		{ ...doc, updatedAt: doc.updatedAt.toISOString() },
		{ ...doc, bytes: new Binary(Buffer.from([2, 1])) }
	])
		assert.notEqual(storedSnapshotVersion(changed, prefix), version);
	assert.deepEqual(storedSnapshotMatch(doc, prefix), { _id: doc._id, ownerId: doc.ownerId, $expr: { $eq: ['$$ROOT', { $literal: doc }] } });
	assert.throws(() => storedSnapshotVersion({ ...doc, crystal: { text: 'x'.repeat(1024 * 1024) } }, prefix), /limit/);
	assert.throws(() => storedSnapshotVersion({ ...doc, _id: null }, prefix), /versioned/);
});
