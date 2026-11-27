import assert from 'node:assert/strict';
import test from 'node:test';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { streamOneWayForegroundSync } from './streamingForegroundSync';
import { readNativeIndexChanges, type NativeIndexChangesPage } from './streamingIndex';
import { SyncConnectionWait, SYNC_RETRY_DELAY_MS } from './syncConnectionWait';

const transient = () => new SyncConnectionWait('Waiting for folder access verification to reconnect.', undefined, 'folder-identity');
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function page(id: string, entries: NativeIndexChangesPage['changes'][number]['entry'][], after: number, complete = false): NativeIndexChangesPage {
	return { id, generation: id, state: complete ? 'complete' : 'running', revision: after + entries.length,
		changes: entries.map((entry, i) => ({ sequence: after + i + 1, revision: entry.version, entry })),
		nextSequence: after + entries.length, hasMore: false };
}

test('transient producer verification preserves the consumer and durable cursor across bounded retries', { timeout: 5000 }, async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const f = await foregroundFixture(2), input: Parameters<typeof streamOneWayForegroundSync>[2] = f.input(), confirmed = deferred(), failed = deferred(), failedAgain = deferred();
	const offsets: number[] = [], commits: number[][] = [];
	let retrySignal: AbortSignal | undefined, begins = 0, failures = 0;
	input.inspectLocal = async path => structuredClone(f.local.find(e => e.path === path) ?? null);
	input.scanLocal = async () => { throw Error('Whole scan forbidden'); };
	input.progress = progress => { if (progress.confirmed === 1) confirmed.resolve(); };
	const original = input.journal.pagedRuns.bind(input.journal);
	input.journal = { ...input.journal, pagedRuns: (...args) => {
		const runs = original(...args);
		return { ...runs, appendStreamInput: async (...values) => {
			commits.push(values[2].map(change => change.sequence));
			return runs.appendStreamInput(...values);
		} };
	} };
	input.streamLocalChanges = (captureId, afterSequence, signal, readyToFinish) => readNativeIndexChanges({
		ownerId: scope.ownerId, deviceId: scope.deviceId, rootId: saved.configuration.localRootId,
		captureId, afterSequence, signal, readyToFinish,
		request: async (_owner, request) => {
			if (request.action === 'scan-stream') { begins++; return { roots: [], changesPage: page(captureId, [], 0) }; }
			if (request.action !== 'scan-changes') throw Error('Unexpected action');
			offsets.push(request.afterSequence!); retrySignal = signal;
			if (request.afterSequence === 0) return { roots: [], changesPage: page(captureId, [f.local[0]], 0) };
			if (++failures <= 2) { (failures === 1 ? failed : failedAgain).resolve(); throw transient(); }
			return { roots: [], changesPage: page(captureId, [f.local[1]], 1, true) };
		}
	});
	const running = streamOneWayForegroundSync(saved, scope, input, new AbortController().signal);
	try {
		await Promise.all([failed.promise, confirmed.promise]); await turn();
		assert.equal(retrySignal!.aborted, false); assert.equal(f.creates(), 1);
		const runs = original({ scope, currentScope: input.currentScope }), active = (await runs.active())!;
		assert.equal((await runs.streamState(active.spec)).indexedSequence, 1);
		assert.deepEqual(offsets, [0, 1]);
		t.mock.timers.tick(SYNC_RETRY_DELAY_MS - 1); await turn(); assert.deepEqual(offsets, [0, 1]);
		t.mock.timers.tick(1); await failedAgain.promise; await turn();
		assert.deepEqual(offsets, [0, 1, 1]); assert.equal(f.creates(), 1); assert.equal(retrySignal!.aborted, false);
		t.mock.timers.tick(SYNC_RETRY_DELAY_MS); await running;
		assert.deepEqual(offsets, [0, 1, 1, 1]); assert.equal(begins, 1);
		assert.deepEqual(commits, [[1], [2]]); assert.equal(f.creates(), 2);
		assert.equal(await runs.active(), null);
	} finally { f.journal().close(); }
});

test('explicit cancellation aborts producer backoff immediately without another request', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const controller = new AbortController(), failed = deferred(); let calls = 0;
	const iterator = readNativeIndexChanges({ ownerId: 'owner', deviceId: 'device', rootId: 'root', captureId: 'capture',
		afterSequence: 7, signal: controller.signal, request: async (_owner, request) => {
			calls++; if (request.action === 'scan-stream') return { roots: [], changesPage: page('capture', [], 7) };
			failed.resolve(); throw transient();
		} });
	const pending = iterator.next(); await failed.promise; await turn();
	const reason = new DOMException('Stopped', 'AbortError'); controller.abort(reason);
	await assert.rejects(pending, error => error === reason);
	t.mock.timers.tick(300_000); await turn(); assert.equal(calls, 2);
});

test('terminal producer revocation aborts a held consumer immediately', { timeout: 5000 }, async () => {
	const f = await foregroundFixture(2), input: Parameters<typeof streamOneWayForegroundSync>[2] = f.input(), entered = deferred();
	const revoked = Error('Authority revoked'); let heldAborted = false;
	input.inspectLocal = async path => structuredClone(f.local.find(e => e.path === path) ?? null);
	const fetch = input.runtime.fetch;
	input.runtime = { ...input.runtime, fetch: async (url, init) => {
		if (init?.method === 'POST') {
			entered.resolve();
			const signal = init.signal!;
			await new Promise<void>((_resolve, reject) => {
				const abort = () => { heldAborted = true; reject(signal.reason); };
				signal.addEventListener('abort', abort, { once: true });
				if (signal.aborted) abort();
			});
		}
		return fetch(url, init);
	} };
	input.streamLocalChanges = (captureId, afterSequence, signal) => readNativeIndexChanges({
		ownerId: scope.ownerId, deviceId: scope.deviceId, rootId: saved.configuration.localRootId,
		captureId, afterSequence, signal, request: async (_owner, request) => {
			if (request.action === 'scan-stream') return { roots: [], changesPage: page(captureId, [], 0) };
			if (request.action !== 'scan-changes') throw Error('Unexpected action');
			if (request.afterSequence === 0) return { roots: [], changesPage: page(captureId, [f.local[0]], 0) };
			await entered.promise; throw revoked;
		}
	});
	try {
		await assert.rejects(streamOneWayForegroundSync(saved, scope, input, new AbortController().signal), error => error === revoked);
		assert.equal(heldAborted, true); assert.equal(f.creates(), 0);
	} finally { f.journal().close(); }
});

test('revocation and untyped transport failures escape immediately; start and finish never retry', async () => {
	for (const action of ['scan-changes', 'scan-stream', 'scan-stream-finish'] as const) {
		for (const error of [Error('Authority revoked'), Error('TLS refused'), new SyncConnectionWait('Other transport'), transient()]) {
			if (action === 'scan-changes' && error instanceof SyncConnectionWait && error.reason === 'folder-identity') continue;
			let calls = 0;
			const iterator = readNativeIndexChanges({ ownerId: 'owner', deviceId: 'device', rootId: 'root', captureId: 'capture',
				afterSequence: 0, signal: new AbortController().signal, readyToFinish: async () => true,
				request: async (_owner, request) => {
					calls++; if (request.action === action) throw error;
					return { roots: [], changesPage: { ...page('capture', [], 0), state: 'indexed' } };
				} });
			if (action === 'scan-stream-finish') assert.equal((await iterator.next()).done, false);
			await assert.rejects(iterator.next(), found => found === error);
			assert.equal(calls, action === 'scan-stream' ? 1 : action === 'scan-changes' ? 2 : 3);
		}
	}
});

test('generation validation still rejects a recovered page before yielding or advancing the cursor', async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const failed = deferred(); let reads = 0;
	const iterator = readNativeIndexChanges({ ownerId: 'owner', deviceId: 'device', rootId: 'root', captureId: 'capture',
		afterSequence: 4, signal: new AbortController().signal, request: async (_owner, request) => {
			if (request.action === 'scan-stream') return { roots: [], changesPage: page('capture', [], 4) };
			if (request.action !== 'scan-changes') throw Error('Unexpected action');
			assert.equal(request.afterSequence, 4);
			if (++reads === 1) { failed.resolve(); throw transient(); }
			return { roots: [], changesPage: { ...page('capture', [], 4), generation: 'changed' } };
		} });
	const pending = iterator.next(); await failed.promise; await turn();
	t.mock.timers.tick(SYNC_RETRY_DELAY_MS);
	await assert.rejects(pending, /generation changed/); assert.equal(reads, 2);
});

/** Observe owned cancellation without stopping the native watcher. */
function heldRead<T>(signal: AbortSignal, read: Promise<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		read.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
			signal.removeEventListener('abort', abort); reject(error);
		});
	});
}

test('indexed producer keeps native changes live during held publication and wakes finish without a polling tick', { timeout: 5000 }, async t => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const f = await foregroundFixture(2), input: Parameters<typeof streamOneWayForegroundSync>[2] = f.input();
	const entered = deferred(), release = deferred(), firstWatch = deferred(), nextWatch = deferred(), changed = deferred();
	const watches: AbortSignal[] = [], offsets: number[] = [];
	let reads = 0, finishes = 0, waitSignal: AbortSignal | undefined;
	const fetch = input.runtime.fetch;
	input.inspectLocal = async path => structuredClone(f.local.find(e => e.path === path) ?? null);
	input.runtime = { ...input.runtime, fetch: async (url, init) => {
		if (init?.method === 'POST') { entered.resolve(); await heldRead(init.signal!, release.promise); }
		return fetch(url, init);
	} };
	input.streamLocalChanges = (captureId, afterSequence, signal, readyToFinish, waitForFinish) => readNativeIndexChanges({
		ownerId: scope.ownerId, deviceId: scope.deviceId, rootId: saved.configuration.localRootId,
		captureId, afterSequence, signal, readyToFinish,
		waitForFinish: wait => { waitSignal = wait; return waitForFinish!(wait); },
		request: async (_owner, request, requestSignal) => {
			if (request.action === 'scan-stream') return { roots: [], changesPage: page(captureId, [], 0) };
			if (request.action === 'scan-stream-finish') {
				finishes++; assert.equal(request.afterSequence, 2);
				return { roots: [], changesPage: page(captureId, [], 2, true) };
			}
			assert.equal(request.action, 'scan-changes'); reads++; offsets.push(request.afterSequence!);
			if (reads === 1) return { roots: [], changesPage: { ...page(captureId, [f.local[0]], 0), state: 'indexed' } };
			assert.equal(request.waitMilliseconds, 25_000); watches.push(requestSignal);
			if (reads === 2) {
				firstWatch.resolve(); await heldRead(requestSignal, changed.promise);
				return { roots: [], changesPage: { ...page(captureId, [f.local[1]], 1), state: 'indexed' } };
			}
			nextWatch.resolve(); return heldRead(requestSignal, new Promise<never>(() => {}));
		}
	});
	try {
		const running = streamOneWayForegroundSync(saved, scope, input, new AbortController().signal);
		await Promise.all([entered.promise, firstWatch.promise]);
		t.mock.timers.tick(10_000); await turn();
		assert.equal(reads, 2); assert.equal(finishes, 0); assert.equal(watches[0].aborted, false);
		const previousWait = waitSignal!;
		changed.resolve(); await nextWatch.promise;
		assert.equal(previousWait.aborted, true); assert.deepEqual(offsets, [0, 1, 2]);
		assert.equal(f.creates(), 0); assert.equal(finishes, 0);
		release.resolve(); await running;
		assert.equal(reads, 3); assert.equal(finishes, 1); assert.equal(f.creates(), 2);
		assert.equal(watches[1].aborted, true); assert.equal(waitSignal!.aborted, true);
	} finally { f.journal().close(); }
});

test('consumer completion during an asynchronous durable readiness check cannot lose its wake', { timeout: 5000 }, async () => {
	const f = await foregroundFixture(), input: Parameters<typeof streamOneWayForegroundSync>[2] = f.input();
	const entered = deferred(), release = deferred(), checking = deferred(), staleRead = deferred(), confirmed = deferred();
	let checks = 0;
	const fetch = input.runtime.fetch, original = input.journal.pagedRuns.bind(input.journal);
	input.inspectLocal = async () => structuredClone(f.local[0]);
	input.runtime = { ...input.runtime, fetch: async (url, init) => {
		if (init?.method === 'POST') { entered.resolve(); await release.promise; }
		return fetch(url, init);
	} };
	input.progress = progress => { if (progress.confirmed === 1) confirmed.resolve(); };
	input.journal = { ...input.journal, pagedRuns: (...args) => {
		const runs = original(...args);
		return { ...runs, streamReadyToFinish: async spec => {
			const ready = await runs.streamReadyToFinish(spec);
			if (++checks === 1) { assert.equal(ready, false); checking.resolve(); await staleRead.promise; }
			return ready;
		} };
	} };
	input.streamLocalChanges = async function* (id, _after, signal, _ready, waitForFinish) {
		yield { ...page(id, f.local, 0), state: 'indexed' };
		await entered.promise;
		await waitForFinish!(signal!);
		yield page(id, [], 1, true);
	};
	try {
		const running = streamOneWayForegroundSync(saved, scope, input, new AbortController().signal);
		await checking.promise; release.resolve(); await confirmed.promise; await turn();
		staleRead.resolve(); await running;
		assert.ok(checks >= 2); assert.equal(f.creates(), 1);
	} finally { f.journal().close(); }
});

test('Stop cancels both owned waits with the original reason and makes no further native calls', { timeout: 5000 }, async () => {
	const controller = new AbortController(), watching = deferred(), never = new Promise<never>(() => {});
	const signals: AbortSignal[] = []; let calls = 0;
	const iterator = readNativeIndexChanges({ ownerId: 'owner', deviceId: 'device', rootId: 'root', captureId: 'capture',
		afterSequence: 0, signal: controller.signal, readyToFinish: async () => false,
		waitForFinish: signal => { signals.push(signal); watching.resolve(); return heldRead(signal, never); },
		request: async (_owner, request, signal) => {
			calls++;
			if (calls <= 2) return { roots: [], changesPage: { ...page('capture', [], 0), state: 'indexed' } };
			assert.equal(request.action, 'scan-changes'); signals.push(signal); return heldRead(signal, never);
		}
	});
	await iterator.next(); const pending = iterator.next(); await watching.promise;
	const reason = new DOMException('Stopped by user', 'AbortError'); controller.abort(reason);
	await assert.rejects(pending, error => error === reason); await turn();
	assert.equal(calls, 3); assert.equal(signals.length, 2);
	for (const signal of signals) { assert.equal(signal.aborted, true); assert.equal(signal.reason, reason); }
});

test('buffered indexed pages drain before readiness waits; a revision racing finish survives the mandatory poll', async () => {
	const entry = { path: 'file', id: 'inode', version: '1', kind: 'folder' as const, size: 0, sha256: null };
	const actions: string[] = []; let reads = 0, finishes = 0, waits = 0;
	const iterator = readNativeIndexChanges({ ownerId: 'owner', deviceId: 'device', rootId: 'root', captureId: 'capture',
		afterSequence: 0, signal: new AbortController().signal, readyToFinish: async () => true,
		waitForFinish: async () => { waits++; }, request: async (_owner, request) => {
			actions.push(request.action);
			if (request.action === 'scan-stream') return { roots: [], changesPage: page('capture', [], 0) };
			if (request.action === 'scan-changes') {
				reads++;
				if (reads === 1) return { roots: [], changesPage: { ...page('capture', [entry], 0), state: 'indexed', revision: 2, hasMore: true } };
				if (reads === 2) return { roots: [], changesPage: { ...page('capture', [{ ...entry, version: '2' }], 1), state: 'indexed' } };
				assert.equal(request.waitMilliseconds, 2_000);
				return { roots: [], changesPage: { ...page('capture', [], 3), state: 'indexed' } };
			}
			assert.equal(request.action, 'scan-stream-finish'); finishes++;
			assert.equal(request.afterSequence, finishes === 1 ? 2 : 3);
			return { roots: [], changesPage: finishes === 1
				? { ...page('capture', [{ ...entry, version: '3' }], 2), state: 'indexed' }
				: page('capture', [], 3, true) };
		}
	});
	const sequences: number[] = [];
	for await (const value of iterator) sequences.push(...value.changes.map(change => change.sequence));
	assert.deepEqual(sequences, [1, 2, 3]); assert.equal(waits, 0);
	assert.deepEqual(actions, ['scan-stream', 'scan-changes', 'scan-changes', 'scan-stream-finish', 'scan-changes', 'scan-stream-finish']);
});

test('a page returned after consumer wake is discarded and recovered by native finish at the unchanged cursor', async () => {
	const ready = deferred(), reading = deferred(), late = deferred(); let drained = false, reads = 0, finishes = 0;
	const entry = { path: 'new-folder', id: 'inode', version: '1', kind: 'folder' as const, size: 0, sha256: null };
	let readSignal: AbortSignal | undefined;
	const iterator = readNativeIndexChanges({ ownerId: 'owner', deviceId: 'device', rootId: 'root', captureId: 'capture',
		afterSequence: 0, signal: new AbortController().signal, readyToFinish: async () => drained,
		waitForFinish: () => ready.promise, request: async (_owner, request, signal) => {
			if (request.action === 'scan-stream') return { roots: [], changesPage: page('capture', [], 0) };
			if (request.action === 'scan-changes') {
				if (++reads === 1) return { roots: [], changesPage: { ...page('capture', [], 0), state: 'indexed' } };
				if (reads === 2) {
					readSignal = signal; reading.resolve(); await late.promise;
					return { roots: [], changesPage: { ...page('capture', [entry], 0), state: 'indexed' } };
				}
				return { roots: [], changesPage: { ...page('capture', [], 1), state: 'indexed' } };
			}
			assert.equal(request.action, 'scan-stream-finish');
			if (++finishes === 1) {
				assert.equal(request.afterSequence, 0); assert.equal(readSignal!.aborted, true); late.resolve();
				return { roots: [], changesPage: { ...page('capture', [entry], 0), state: 'indexed' } };
			}
			assert.equal(request.afterSequence, 1); return { roots: [], changesPage: page('capture', [], 1, true) };
		}
	});
	await iterator.next(); const pending = iterator.next(); await reading.promise;
	drained = true; ready.resolve();
	assert.equal((await pending).value?.changes[0].sequence, 1);
	for await (const value of iterator) assert.equal(value.changes.length, 0);
	assert.equal(finishes, 2);
});

test('indexed read revocation escapes immediately and cancels its readiness wait', async () => {
	const revoked = Error('Authority revoked'), waits: AbortSignal[] = []; let reads = 0;
	const iterator = readNativeIndexChanges({ ownerId: 'owner', deviceId: 'device', rootId: 'root', captureId: 'capture',
		afterSequence: 0, signal: new AbortController().signal, readyToFinish: async () => false,
		waitForFinish: signal => { waits.push(signal); return heldRead(signal, new Promise<never>(() => {})); },
		request: async (_owner, request) => {
			if (request.action === 'scan-changes' && ++reads === 2) throw revoked;
			return { roots: [], changesPage: { ...page('capture', [], 0), state: 'indexed' } };
		}
	});
	await iterator.next(); await assert.rejects(iterator.next(), error => error === revoked);
	assert.equal(reads, 2); assert.equal(waits.length, 1); assert.equal(waits[0].aborted, true);
});
