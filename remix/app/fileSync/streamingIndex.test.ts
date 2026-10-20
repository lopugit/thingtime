import assert from 'node:assert/strict';
import test from 'node:test';
import { readNativeIndexChanges, type NativeIndexChangesPage } from './streamingIndex';
import { assertNativeScanExclusions, parseMobileFolderResult, supportsNativeStreamingIndex, supportsNativeStreamingBatches, type FolderRequest } from './mobileFolders.client';
const id = crypto.randomUUID(),
	entry = { path: 'file', id: 'inode', version: '1', kind: 'file' as const, size: 0, sha256: 'a'.repeat(64) };
const page = (sequence: number, state: NativeIndexChangesPage['state'], changes: NativeIndexChangesPage['changes'] = []): NativeIndexChangesPage => ({
	id,
	generation: id,
	state,
	revision: sequence,
	changes,
	nextSequence: sequence,
	hasMore: false,
	totalSkipped: 0
});
test('native streaming capability and every scoped result negotiate independently from sealed inventory', () => {
	const request: FolderRequest = {
		action: 'scan-changes',
		rootId: 'root',
		inventoryDeviceId: 'device',
		captureId: id,
		afterSequence: 0,
		capturePolicy: 'one-way-supported',
		excludedPaths: ['Library'],
		ignoreRules: '*.log'
	};
	assert.equal(supportsNativeStreamingIndex({ platform: 'macos', fileAccessVersion: '1.10.0' }), false);
	assert.equal(supportsNativeStreamingIndex({ platform: 'macos', fileAccessVersion: '1.11.0' }), true);
	assert.throws(() => assertNativeScanExclusions(request, { platform: 'macos', fileAccessVersion: '1.10.0' }), /Update/);
	const expected = { ownerId: 'owner', origin: 'https://sync.test', requestId: 'request' },
		payload = {
			...expected,
			roots: [],
			rootId: 'root',
			complete: false,
			capturePolicy: 'one-way-supported',
			excludedPaths: ['Library'],
			ignoreRules: '*.log',
			changesPage: page(0, 'indexed')
		};
	assert.equal(parseMobileFolderResult({ type: 'mobile-files-result', payload }, expected, request)?.changesPage?.state, 'indexed');
	for (const patch of [
		{ rootId: 'wrong' },
		{ capturePolicy: 'backup-supported' },
		{ excludedPaths: [] },
		{ ignoreRules: 'other' },
		{ changesPage: { ...page(0, 'indexed'), id: 'wrong' } }
	])
		assert.throws(() => parseMobileFolderResult({ type: 'mobile-files-result', payload: { ...payload, ...patch } }, expected, request));
});
test('initial indexing completion keeps subscription active until consumers drain, including a revision racing finish', async () => {
	let drained = false,
		reads = 0,
		finishes = 0;
	const actions: string[] = [];
	const iterator = readNativeIndexChanges({
		ownerId: 'owner',
		deviceId: 'device',
		rootId: 'root',
		captureId: id,
		afterSequence: 0,
		signal: new AbortController().signal,
		readyToFinish: async () => drained,
		request: async (_owner, request) => {
			actions.push(request.action);
			if (request.action === 'scan-stream') return { roots: [], changesPage: page(0, 'running') };
			if (request.action === 'scan-changes') {
				if (finishes) return { roots: [], changesPage: page(2, 'indexed') };
				reads++;
				return { roots: [], changesPage: reads === 1 ? page(1, 'indexed', [{ sequence: 1, revision: entry.version, entry }]) : page(1, 'indexed') };
			}
			assert.equal(request.action, 'scan-stream-finish');
			finishes++;
			return {
				roots: [],
				changesPage: finishes === 1 ? page(2, 'indexed', [{ sequence: 2, revision: '2', entry: { ...entry, version: '2' } }]) : page(2, 'complete')
			};
		}
	});
	assert.equal((await iterator.next()).value?.state, 'indexed');
	assert.equal(finishes, 0);
	assert.equal((await iterator.next()).value?.changes.length, 0);
	assert.equal(finishes, 0);
	drained = true;
	assert.equal((await iterator.next()).value?.changes[0].sequence, 2);
	assert.equal((await iterator.next()).value?.state, 'indexed');
	assert.equal((await iterator.next()).value?.state, 'complete');
	assert.equal((await iterator.next()).done, true);
	assert.deepEqual(actions, ['scan-stream', 'scan-changes', 'scan-changes', 'scan-stream-finish', 'scan-changes', 'scan-stream-finish']);
});
test('corrected hosts batch feed RPCs while legacy hosts retain their128-entry fallback', async () => {
	const rows = Array.from({ length: 1024 }, (_, i) => ({ sequence: i + 1, revision: '1', entry: { ...entry, path: `file-${i}` } }));
	const calls: number[] = [];
	for (const version of ['1.11.0', '1.11.1']) {
		let reads = 0, observed = 0;
		for await (const result of readNativeIndexChanges({ ownerId: 'owner', deviceId: 'device', rootId: 'root', captureId: id,
			afterSequence: 0, signal: new AbortController().signal,
			...(supportsNativeStreamingBatches({ platform: 'macos', fileAccessVersion: version }) ? { pageSize: 4096 } : {}),
			request: async (_owner, request) => {
				if (request.action === 'scan-stream') return { roots: [], changesPage: page(0, 'running') };
				assert.equal(request.action, 'scan-changes'); reads++;
				const changes = rows.slice(request.afterSequence, request.afterSequence + request.pageSize!);
				const next = request.afterSequence + changes.length;
				return { roots: [], changesPage: { ...page(next, 'complete', changes), revision: rows.length, hasMore: next < rows.length } };
			} })) observed += result.changes.length;
		assert.equal(observed, rows.length); calls.push(reads);
	}
	assert.deepEqual(calls, [8, 1]);
});
