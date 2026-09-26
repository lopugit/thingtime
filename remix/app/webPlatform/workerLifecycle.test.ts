import assert from 'node:assert/strict';
import test from 'node:test';
import { runPlatformWorker } from './workerLifecycle';

function fixture() {
	let terminated = 0,
		released = 0;
	const inputs: unknown[] = [],
		results: unknown[] = [];
	const worker: any = { onmessage: null, onerror: null, postMessage: (value: unknown) => inputs.push(value), terminate: () => terminated++ };
	const stop = runPlatformWorker(
		worker,
		{ value: 42 },
		(ok, result) => results.push({ ok, result }),
		() => released++
	);
	return {
		inputs,
		results,
		stop,
		message: (data: unknown) => worker.onmessage({ data }),
		error: () => worker.onerror(),
		cleanup: () => [terminated, released]
	};
}
test('slow worker startup does not consume execution time; repeated ready messages cannot extend the deadline', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const f = fixture();
	t.mock.timers.tick(9000);
	assert.deepEqual(f.inputs, []);
	assert.deepEqual(f.results, []);
	f.message({ type: 'tt-platform-worker-ready' });
	assert.deepEqual(f.inputs, [{ value: 42 }]);
	t.mock.timers.tick(1999);
	f.message({ type: 'tt-platform-worker-ready' });
	assert.equal(f.inputs.length, 1);
	assert.deepEqual(f.results, []);
	t.mock.timers.tick(1);
	assert.deepEqual(f.results, [{ ok: false, result: 'The program exceeded its 2-second execution limit.' }]);
	f.message({ ok: true, result: 'late' });
	f.stop();
	assert.equal(f.results.length, 1);
	assert.deepEqual(f.cleanup(), [1, 1]);
});
test('a worker that never boots is bounded independently and cannot start after expiry', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const f = fixture();
	t.mock.timers.tick(10000);
	assert.match(JSON.stringify(f.results), /did not start/);
	f.message({ type: 'tt-platform-worker-ready' });
	assert.deepEqual(f.inputs, []);
	assert.deepEqual(f.cleanup(), [1, 1]);
});
test('success, browser errors and cancellation release the worker exactly once', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	for (const mode of ['success', 'error', 'cancel']) {
		const f = fixture();
		f.message({ type: 'tt-platform-worker-ready' });
		if (mode === 'success') f.message({ ok: true, result: 42 });
		else if (mode === 'error') f.error();
		else f.stop();
		t.mock.timers.tick(20000);
		f.stop();
		assert.equal(f.results.length, mode === 'cancel' ? 0 : 1);
		assert.deepEqual(f.cleanup(), [1, 1]);
	}
});

test('DOM requests share the execution deadline and cannot resume a stopped worker', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const calls: unknown[] = [],
		messages: unknown[] = [],
		results: unknown[] = [];
	let cleaned = 0;
	const worker: any = { onmessage: null, onerror: null, terminate: () => {}, postMessage: (data: unknown) => messages.push(data) };
	const stop = runPlatformWorker(
		worker,
		{},
		(ok, result) => results.push({ ok, result }),
		() => cleaned++,
		(request) => {
			calls.push(request);
			return { value: 42 };
		}
	);
	const request = { type: 'tt-platform-dom', id: 1 };
	worker.onmessage({ data: request });
	assert.equal(calls.length, 0);
	worker.onmessage({ data: { type: 'tt-platform-worker-ready' } });
	t.mock.timers.tick(1999);
	worker.onmessage({ data: request });
	assert.deepEqual(messages[1], { type: 'tt-platform-dom-result', id: 1, ok: true, result: { value: 42 } });
	assert.deepEqual(results, []);
	t.mock.timers.tick(1);
	worker.onmessage({ data: request });
	assert.equal(calls.length, 1);
	assert.equal(results.length, 1);
	stop();
	assert.equal(cleaned, 1);
});

test('DOM policy failures end execution and release resources once', () => {
	let cleaned = 0;
	const messages: unknown[] = [],
		results: unknown[] = [];
	const worker: any = { onmessage: null, onerror: null, terminate: () => {}, postMessage: (data: unknown) => messages.push(data) };
	runPlatformWorker(
		worker,
		{},
		(ok, result) => results.push({ ok, result }),
		() => cleaned++,
		() => {
			throw new Error('Stale DOM handle');
		}
	);
	worker.onmessage({ data: { type: 'tt-platform-worker-ready' } });
	worker.onmessage({ data: { type: 'tt-platform-dom', id: 1 } });
	worker.onmessage({ data: { ok: true, result: 'late' } });
	assert.deepEqual(results, [{ ok: false, result: 'Stale DOM handle' }]);
	assert.equal(messages.length, 1);
	assert.equal(cleaned, 1);
});
