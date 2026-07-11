import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes this TypeScript test directly and requires the .ts extension.
import { createOrderedEditorJsChangeQueue } from './editorJsChangeQueue.ts';

const deferred = <Value>() => {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
	await Promise.resolve();
	await Promise.resolve();
};

test('starts every save immediately and emits resolved snapshots in request order', async () => {
	const first = deferred<string>();
	const second = deferred<string>();
	const started: string[] = [];
	const emitted: string[] = [];
	const queue = createOrderedEditorJsChangeQueue<string, string>({
		getSignature: (value) => value,
		onEmit: (value) => emitted.push(value)
	});

	queue.enqueue(() => {
		started.push('A');
		return first.promise;
	});
	queue.enqueue(() => {
		started.push('AB');
		return second.promise;
	});

	assert.deepEqual(started, ['A', 'AB']);
	second.resolve('AB');
	await flushMicrotasks();
	assert.deepEqual(emitted, []);

	first.resolve('A');
	await flushMicrotasks();
	assert.deepEqual(emitted, ['A', 'AB']);
});

test('suppresses only adjacent duplicate signatures', async () => {
	const emitted: string[] = [];
	const queue = createOrderedEditorJsChangeQueue<string, string>({
		getSignature: (value) => value,
		onEmit: (value) => emitted.push(value)
	});

	for (const value of ['A', 'A', 'AB', 'AB', 'A']) {
		queue.enqueue(() => Promise.resolve(value));
	}
	await flushMicrotasks();

	assert.deepEqual(emitted, ['A', 'AB', 'A']);
});

test('seeds the mounted baseline without losing a return to that value', async () => {
	const emitted: string[] = [];
	const queue = createOrderedEditorJsChangeQueue<string, string>({
		getSignature: (value) => value,
		onEmit: (value) => emitted.push(value),
		initialSignature: 'A'
	});

	for (const value of ['A', 'AB', 'A']) queue.enqueue(() => value);
	await flushMicrotasks();

	assert.deepEqual(emitted, ['AB', 'A']);
});

test('continues in order after an earlier save rejects', async () => {
	const failed = new Error('save failed');
	const emitted: string[] = [];
	const errors: unknown[] = [];
	const queue = createOrderedEditorJsChangeQueue<string, string>({
		getSignature: (value) => value,
		onEmit: (value) => emitted.push(value),
		onError: (error) => errors.push(error)
	});

	queue.enqueue(() => Promise.reject(failed));
	queue.enqueue(() => Promise.resolve('after failure'));
	await flushMicrotasks();

	assert.deepEqual(errors, [failed]);
	assert.deepEqual(emitted, ['after failure']);

	queue.enqueue(() => Promise.resolve('still active'));
	await flushMicrotasks();
	assert.deepEqual(emitted, ['after failure', 'still active']);
});

test('drops late completions and refuses new saves after disposal', async () => {
	const pending = deferred<string>();
	const emitted: string[] = [];
	let startsAfterDispose = 0;
	const queue = createOrderedEditorJsChangeQueue<string, string>({
		getSignature: (value) => value,
		onEmit: (value) => emitted.push(value)
	});

	queue.enqueue(() => pending.promise);
	queue.dispose();
	queue.enqueue(() => {
		startsAfterDispose += 1;
		return 'too late';
	});
	pending.resolve('late result');
	await flushMicrotasks();

	assert.deepEqual(emitted, []);
	assert.equal(startsAfterDispose, 0);
});

test('close refuses new work but drains every already-started save', async () => {
	const first = deferred<string>();
	const second = deferred<string>();
	const emitted: string[] = [];
	let startsAfterClose = 0;
	const queue = createOrderedEditorJsChangeQueue<string, string>({
		getSignature: (value) => value,
		onEmit: (value) => emitted.push(value)
	});

	queue.enqueue(() => first.promise);
	queue.enqueue(() => second.promise);
	const closed = queue.close();
	queue.enqueue(() => {
		startsAfterClose += 1;
		return 'too late';
	});

	second.resolve('second');
	await flushMicrotasks();
	assert.deepEqual(emitted, []);
	first.resolve('first');
	await closed;

	assert.deepEqual(emitted, ['first', 'second']);
	assert.equal(startsAfterClose, 0);
});
