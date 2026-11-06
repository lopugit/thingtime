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
