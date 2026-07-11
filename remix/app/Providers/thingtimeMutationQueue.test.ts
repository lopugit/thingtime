import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { drainThingtimeMutationQueue } from './thingtimeMutationQueue.ts';

type State = { root?: string; nested?: { value: string } };
type Update = { type: 'replace'; value: State } | { type: 'nested'; value: string };

test('applies a nested edit to a whole-root replacement in the same batch', () => {
	const queue: Update[] = [
		{ type: 'replace', value: { root: 'replacement' } },
		{ type: 'nested', value: 'kept' }
	];

	const result = drainThingtimeMutationQueue<State, Update>({ root: 'old' }, queue, (state, update) => {
		if (update.type === 'replace') return { ...update.value };
		return { ...state, nested: { value: update.value } };
	});

	assert.deepEqual(result, {
		state: { root: 'replacement', nested: { value: 'kept' } },
		applied: true
	});
	assert.deepEqual(queue, []);
});

test('drains updates appended while applying an earlier update', () => {
	const queue = [1];
	const result = drainThingtimeMutationQueue(0, queue, (state, update) => {
		if (update === 1) queue.push(2);
		return state + update;
	});

	assert.deepEqual(result, { state: 3, applied: true });
	assert.deepEqual(queue, []);
});

test('reports a failed update and continues with later work', () => {
	const failure = new Error('bad update');
	const errors: unknown[] = [];
	const result = drainThingtimeMutationQueue(
		0,
		[1, 2, 3],
		(state, update) => {
			if (update === 2) throw failure;
			return state + update;
		},
		(error) => errors.push(error)
	);

	assert.deepEqual(result, { state: 4, applied: true });
	assert.deepEqual(errors, [failure]);
});
