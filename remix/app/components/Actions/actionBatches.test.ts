import assert from 'node:assert/strict';
import test from 'node:test';
import { readActionBatch, runActionBatches } from './actionBatches';

const batch = readActionBatch('{"input":"ids","size":2,"selectionKey":"picked"}');
test('an Action batch completes all chunks in order using the same captured input', async () => {
	const ids = ['a', 'b', 'c', 'd', 'e'];
	const calls: unknown[] = [];
	const result = await runActionBatches(batch, { ids, target: 'one' }, async (input) => {
		calls.push(input);
		if (calls.length === 1) ids.push('new');
		return { status: 'ok' };
	});
	assert.deepEqual(calls, [{ ids: ['a', 'b'], target: 'one' }, { ids: ['c', 'd'], target: 'one' }, { ids: ['e'], target: 'one' }]);
	assert.deepEqual(result.result, { message: 'Processed 5 selected items.', batch: { completed: 5, total: 5 } });
});

test('partial and uncertain chunks stop without a retry or a completion report', async () => {
	let calls = 0;
	await assert.rejects(runActionBatches(batch, { ids: ['a', 'b', 'c', 'd', 'e'] }, async () => {
		calls++;
		return calls === 2 ? { status: 'error', error: 'Gone' } : { status: 'ok' };
	}), /Confirmed 2 of 5.*Gone/);
	assert.equal(calls, 2);
	for (const value of ['{"input":"__proto__","size":2}', '{"input":"ids","size":0}']) assert.throws(() => readActionBatch(value));
});

test('chunks do not impose a total item limit', async () => {
	const ids = Array.from({ length: 4100 }, (_, i) => `saved-id-${i}`);
	const collected: unknown[] = [];
	await runActionBatches({ ...batch, size: 20 }, { ids }, async (input) => {
		collected.push(...input.ids as unknown[]);
		return { status: 'ok' };
	});
	assert.deepEqual(collected, ids);
});
