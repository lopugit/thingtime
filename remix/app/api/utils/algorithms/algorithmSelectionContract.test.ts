import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAlgorithmSelection, parseAlgorithmSelectionWrite, parseAlgorithmSelectionAcknowledgment } from './algorithmSelectionContract';
const version = 'algorithm-selection-v1:' + 'a'.repeat(64),
	command = { algorithmId: 'fixture-algorithm', expectedVersion: version, writeId: 'fixture-write' };
test('active algorithm contracts preserve null clearing and reject authority, oversized and ambiguous fields', () => {
	assert.deepEqual(parseAlgorithmSelection({ algorithmId: null, version }), { algorithmId: null, version });
	assert.deepEqual(parseAlgorithmSelectionWrite(command), command);
	const acknowledgment = { ...command, result: { algorithmId: command.algorithmId, version } };
	assert.deepEqual(parseAlgorithmSelectionAcknowledgment(acknowledgment), acknowledgment);
	for (const row of [
		{ ...command, ownerId: 'forged' },
		{ ...command, algorithmId: {} },
		{ ...command, algorithmId: undefined },
		{ ...command, expectedVersion: 'old' },
		{ ...command, writeId: 'x'.repeat(161) },
		{ ...command, algorithmId: '../../escape' }
	])
		assert.throws(() => parseAlgorithmSelectionWrite(row));
	assert.throws(() => parseAlgorithmSelectionAcknowledgment({ ...acknowledgment, result: { algorithmId: 'other', version } }));
	assert.throws(() => parseAlgorithmSelection({ algorithmId: null, version, privateValue: 'not accepted' }));
});
