import assert from 'node:assert/strict';
import test from 'node:test';
import { newThingMutationCapture } from './recordMutation';
import { timelineMutationContext, withTimelineMutationContext } from './mutationContext';

test('nested Action writes retain the initiating AI operation with independent event identities', async () => {
	const captures = await withTimelineMutationContext('owner', 'ai', async () => {
		const first = newThingMutationCapture('owner');
		const second = await withTimelineMutationContext('owner', 'action', async () => {
			await Promise.resolve();
			return newThingMutationCapture('owner');
		});
		return [first, second, newThingMutationCapture('owner')];
	});
	assert.equal(new Set(captures.map(capture => capture.operationId)).size, 1);
	assert.equal(new Set(captures.map(capture => capture.id)).size, 3);
	assert.deepEqual(captures.map(capture => capture.source), ['ai', 'ai', 'ai']);
	assert.equal(timelineMutationContext('owner'), null);
	assert.equal(newThingMutationCapture('owner').source, 'api');
});

test('overlapping requests, actor changes and anonymous work cannot share provenance', async () => {
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const pending = withTimelineMutationContext('owner', 'ai', async () => {
		const first = newThingMutationCapture('owner');
		await gate;
		assert.equal(newThingMutationCapture('owner').operationId, first.operationId);
		return first;
	});
	const concurrent = await withTimelineMutationContext('owner', 'action', async () => {
		await Promise.resolve();
		const capture = newThingMutationCapture('owner');
		assert.equal(newThingMutationCapture('other').source, 'api');
		await withTimelineMutationContext('other', 'action', async () => {
			assert.equal(newThingMutationCapture('owner').source, 'api');
			assert.notEqual(newThingMutationCapture('other').operationId, capture.operationId);
		});
		await withTimelineMutationContext(null, 'action', async () => {
			assert.equal(newThingMutationCapture('owner').source, 'api');
		});
		return capture;
	});
	release();
	const first = await pending;
	assert.notEqual(first.operationId, concurrent.operationId);
	assert.equal(first.source, 'ai');
	assert.equal(concurrent.source, 'action');
});

test('errors restore the caller context and explicit internal captures keep their own contract', async () => {
	await withTimelineMutationContext('owner', 'ai', async () => {
		const before = newThingMutationCapture('owner');
		await assert.rejects(withTimelineMutationContext('other', 'action', async () => { throw new Error('refused'); }), /refused/);
		const after = newThingMutationCapture('owner');
		assert.equal(after.operationId, before.operationId);
		const explicit = newThingMutationCapture('owner', 'api');
		assert.equal(explicit.source, 'api');
		assert.notEqual(explicit.operationId, before.operationId);
	});
	assert.equal(timelineMutationContext('owner'), null);
});
