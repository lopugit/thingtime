import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAlgorithmWrite, parseAlgorithmWriteAcknowledgment } from './algorithmSyncContract';
import { algorithmWriteDigest, createAlgorithmWriteReceipt, readAlgorithmWriteReceipt } from './algorithmSyncReceipt';
const version = 'algorithm-state-v1:' + 'a'.repeat(64);
const save = {
	id: '123e4567-e89b-42d3-a456-426614174000',
	writeId: 'fixture-write',
	expectedVersion: null,
	action: 'save',
	content: {
		name: 'Reading',
		emoji: '🧠',
		weights: { types: { text: 0.5 }, tags: { kindness: 1 }, authors: {} },
		eventCount: 2,
		lastTrainedAt: '2026-10-18T00:00:00.000Z'
	},
	description: 'An editable profile'
};
test('algorithm writes preserve canonical portable weights and refuse publication, training replay and authority fields', () => {
	assert.deepEqual(parseAlgorithmWrite(save), save);
	assert.deepEqual(parseAlgorithmWrite({ ...save, parentId: null }), { ...save, parentId: null });
	for (const bad of [
		null,
		[],
		{},
		{ ...save, ownerId: 'other' },
		{ ...save, shared: true },
		{ ...save, listed: true },
		{ ...save, acl: ['tt:all'] },
		{ ...save, events: [] },
		{ ...save, id: 'reserved-system' },
		{ ...save, expectedVersion: undefined },
		{ ...save, expectedVersion: 'timestamp' },
		{ ...save, expectedVersion: version, parentId: 'changed-lineage' },
		{ ...save, parentId: save.id },
		{ ...save, description: 'x'.repeat(301) },
		{ ...save, content: { ...save.content, weights: { types: { text: Infinity }, tags: {}, authors: {} } } },
		{ ...save, content: { ...save.content, eventCount: -1 } },
		{ ...save, content: { ...save.content, name: () => '' } },
		{ ...save, content: { ...save.content, extra: 'x'.repeat(2 * 1024 * 1024) } },
		{ ...save, action: 'delete' },
		{ id: save.id, writeId: save.writeId, action: 'delete', expectedVersion: null }
	])
		assert.throws(() => parseAlgorithmWrite(bad));
	const deleted = { id: save.id, writeId: save.writeId, action: 'delete', expectedVersion: version };
	assert.deepEqual(parseAlgorithmWrite(deleted), deleted);
});
test('algorithm receipt binds owner, home storage and exact content without retaining the interest profile', () => {
	const command = parseAlgorithmWrite(save),
		digest = algorithmWriteDigest('owner', command);
	const ack = { id: save.id, writeId: save.writeId, action: 'save' as const, expectedVersion: null, resultVersion: version };
	assert.deepEqual(parseAlgorithmWriteAcknowledgment(ack), ack);
	const receipt = createAlgorithmWriteReceipt('owner', ack, digest, '2026-10-18T00:00:00.000Z');
	assert.deepEqual(readAlgorithmWriteReceipt(receipt, 'owner', command, digest), ack);
	assert.ok(!JSON.stringify(receipt).includes('kindness'));
	for (const [owner, input] of [
		['other', save],
		['owner', { ...save, content: { ...save.content, eventCount: 3 } }],
		['owner', { ...save, description: 'Changed' }]
	] as const) {
		const changed = parseAlgorithmWrite(input),
			hash = algorithmWriteDigest(owner, changed);
		assert.notEqual(hash, digest);
		assert.throws(() => readAlgorithmWriteReceipt(receipt, owner, changed, hash));
	}
	for (const changed of [
		{ ...receipt, source: 'client', clientId: 'forged' },
		{ ...receipt, thingId: 'other' },
		{ ...receipt, mode: 'revision', operation: 'update' },
		{ ...receipt, after: { ...receipt.after, value: { ...ack, requestDigest: digest, resultVersion: null } } }
	])
		assert.throws(() => readAlgorithmWriteReceipt(changed, 'owner', command, digest));
	for (const bad of [
		{ ...ack, resultVersion: null },
		{ ...ack, ownerId: 'forged' },
		{ ...ack, action: 'delete' },
		{ ...ack, resultVersion: 'timestamp' }
	])
		assert.throws(() => parseAlgorithmWriteAcknowledgment(bad));
});
