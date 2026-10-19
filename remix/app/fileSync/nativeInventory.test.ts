import test from 'node:test';
import assert from 'node:assert/strict';
import { readNativeInventory, parseNativeInventoryCapture, parseNativeInventoryPage, type NativeInventoryCapture } from './nativeInventory';
import { parseMobileFolderResult, supportsNativeInventoryPages, supportsNativeScanExclusions, assertNativeScanExclusions, type FolderRequest } from './mobileFolders.client';

const rootId = crypto.randomUUID(), generation = crypto.randomUUID();
const entry = { path: 'file', id: 'inode', version: '1', kind: 'file' as const, size: 0, sha256: 'a'.repeat(64) };
const capture: NativeInventoryCapture = { id: crypto.randomUUID(), generation, totalEntries: 1 };
const expected = { ownerId: 'owner', origin: 'https://sync.test', requestId: 'request' };
const page = { capture, offset: 0, entries: [entry], nextOffset: null };

test('native inventories negotiate explicit platform versions and pin every response', () => {
	for (const [platform, fileAccessVersion, supported] of [
		['macos', '1.4.0', false], ['macos', '1.5.0', false], ['macos', '1.5.1', true], ['macos', '1.6.0', true],
		['ios', '1.2.0', false], ['ios', '1.3.0', false], ['ios', '1.3.1', true], ['ios', '2.0.0', false], ['android', '1.9.0', false]
	] as const) assert.equal(supportsNativeInventoryPages({ platform, fileAccessVersion }), supported);
	const parse = (request: FolderRequest, patch = {}) => parseMobileFolderResult({ type: 'mobile-files-result',
		payload: { ...expected, rootId, complete: true, capture, inventoryPage: page, roots: [], ...patch } }, expected, request);
	const begin = { action: 'scan-capture' as const, rootId, inventoryDeviceId: 'device', captureId: capture.id };
	assert.deepEqual(parse(begin)?.capture, capture);
	for (const patch of [{ rootId: 'other' }, { complete: false }, { capture: { ...capture, id: crypto.randomUUID() } }])
		assert.throws(() => parse(begin, patch));
	assert.deepEqual(parse({ action: 'scan-page', rootId, inventoryDeviceId: 'device', capture, offset: 0 })?.inventoryPage, page);
	assert.throws(() => parse({ action: 'scan-discard', rootId, inventoryDeviceId: 'device', capture }));
	assert.equal(parse(begin, { ownerId: 'other' }), null);
});

test('native inventory pages refuse missing, foreign, reordered and oversized observations', () => {
	for (const bad of [undefined, {}, { ...capture, totalEntries: -1 }, { ...capture, generation: 'not-uuid' }, { ...capture, totalEntries: Infinity }])
		assert.throws(() => parseNativeInventoryCapture(bad));
	for (const patch of [{ capture: { ...capture, generation: crypto.randomUUID() } }, { capture: { ...capture, totalEntries: 2 } },
		{ offset: 1 }, { nextOffset: 1 }, { entries: [] }, { nextOffset: undefined }, { entries: [{ ...entry, path: '../outside' }] }])
		assert.throws(() => parseNativeInventoryPage({ ...page, ...patch }, capture, 0));
	const empty = { ...capture, totalEntries: 0 };
	assert.deepEqual(parseNativeInventoryPage({ capture: empty, offset: 0, entries: [], nextOffset: null }, empty, 0).entries, []);
	const huge = Array.from({ length: 128 }, (_, i) => ({ ...entry, id: String(i), path: (('x'.repeat(200) + '/').repeat(20)) + String(i) }));
	const largeCapture = { ...capture, totalEntries: huge.length };
	assert.throws(() => parseNativeInventoryPage({ capture: largeCapture, offset: 0, entries: huge, nextOffset: null }, largeCapture, 0), /byte bound/);
});

test('native page reader preserves a sealed generation and releases it on completion or consumer failure', async () => {
	for (const fail of [false, true]) {
		const requests: FolderRequest[] = []; let current: NativeInventoryCapture | undefined;
		const iterator = readNativeInventory({ ownerId: 'owner', deviceId: 'device', rootId, signal: new AbortController().signal,
			request: async (ownerId, request) => {
				assert.equal(ownerId, 'owner'); requests.push(request);
				if (request.action === 'scan-capture') { current = { ...capture, id: request.captureId, totalEntries: 2 }; return { roots: [], capture: current }; }
				if (request.action === 'scan-page') return { roots: [], inventoryPage: { capture: current!, offset: request.offset,
					entries: [{ ...entry, id: String(request.offset), path: 'file-' + request.offset }], nextOffset: request.offset === 0 ? 1 : null } };
				return { roots: [], discarded: true };
			} });
		const rows = [];
		try { for await (const value of iterator) { rows.push(value); if (fail) throw Error('consumer refused'); } } catch (error) { assert.equal((error as Error).message, 'consumer refused'); }
		assert.deepEqual(rows.map(r => r.ordinal), fail ? [0] : [0, 1]);
		assert.ok(rows.every(r => r.generation === generation));
		assert.equal(rows[0].totalEntries, undefined);
		if (!fail) assert.equal(rows[1].totalEntries, 2);
		assert.equal(requests.at(-1)?.action, 'scan-discard');
	}
});

test('cancellation after a native page reply cannot expose that page', async () => {
	const abort = new AbortController(); let current = capture, pages = 0;
	const iterator = readNativeInventory({ ownerId: 'owner', deviceId: 'device', rootId, signal: abort.signal, request: async (_, request) => {
		if (request.action === 'scan-capture') { current = { ...capture, id: request.captureId }; return { roots: [], capture: current }; }
		assert.equal(request.action, 'scan-page'); pages++; abort.abort();
		return { roots: [], inventoryPage: { ...page, capture: current } };
	} });
	await assert.rejects(async () => { for await (const _ of iterator) assert.fail('cancelled page escaped'); }, { name: 'AbortError' });
	assert.equal(pages, 1);
});


test('native scan exclusions require negotiated pruning and an exact echoed policy', () => {
	for (const [platform, fileAccessVersion, supported] of [
		['macos', '1.5.1', false], ['macos', '1.6.0', true], ['macos', '1.7.0', true],
		['ios', '1.3.1', false], ['ios', '1.4.0', true], ['ios', '2.4.0', false], ['android', '1.9.0', false]
	] as const) {
		const bridge = { platform, fileAccessVersion };
		assert.equal(supportsNativeScanExclusions(bridge), supported);
		const scan = { action: 'scan' as const, rootId, excludedPaths: ['Library'] };
		if (supported) assert.doesNotThrow(() => assertNativeScanExclusions(scan, bridge));
		else assert.throws(() => assertNativeScanExclusions(scan, bridge), /Update Thingtime/);
	}
	assert.throws(() => assertNativeScanExclusions({ action: 'scan', rootId, excludedPaths: null } as any, { platform: 'macos', fileAccessVersion: '1.6.0' }));
	const exclusions = ['Library', 'Applications', '.Trash'];
	const request = { action: 'scan' as const, rootId, excludedPaths: exclusions };
	const parse = (patch: object) => parseMobileFolderResult({ type: 'mobile-files-result', payload: {
		...expected, roots: [], rootId, complete: true, excludedPaths: exclusions, entries: [entry], ...patch
	} }, expected, request);
	assert.deepEqual(parse({})?.entries, [entry]);
	assert.deepEqual(parse({ excludedPaths: ['applications', '.trash', 'LIBRARY'] })?.entries, [entry]);
	for (const patch of [{ excludedPaths: undefined }, { excludedPaths: [] }, { excludedPaths: ['Library'] },
		{ entries: [{ ...entry, path: 'library/private' }] }, { entries: [{ ...entry, path: '.Trash' }] }]) assert.throws(() => parse(patch));
	assert.deepEqual(parse({ entries: [{ ...entry, path: 'Library-copy' }] })?.entries?.[0].path, 'Library-copy');
	assert.throws(() => assertNativeScanExclusions({ ...request, excludedPaths: ['Library', 'LIBRARY'] }, { platform: 'macos', fileAccessVersion: '1.6.0' }));
	const begin = { action: 'scan-capture' as const, rootId, inventoryDeviceId: 'device', captureId: capture.id, excludedPaths: exclusions };
	const body = { ...expected, roots: [], rootId, complete: true, capture };
	assert.throws(() => parseMobileFolderResult({ type: 'mobile-files-result', payload: body }, expected, begin));
	assert.deepEqual(parseMobileFolderResult({ type: 'mobile-files-result', payload: { ...body, excludedPaths: exclusions } }, expected, begin)?.capture, capture);
});

test('native paged reader pins exclusions and never imports excluded observations', async () => {
	for (const leak of [false, true]) {
		const exclusions = ['Library']; let current = capture; const requests: FolderRequest[] = [];
		const iterator = readNativeInventory({ ownerId: 'owner', deviceId: 'device', rootId, signal: new AbortController().signal,
			excludedPaths: exclusions, request: async (_, request) => {
				requests.push(request);
				if (request.action === 'scan-capture') {
					assert.deepEqual(request.excludedPaths, ['Library']); exclusions.push('Applications');
					current = { ...capture, id: request.captureId }; return { roots: [], capture: current };
				}
				if (request.action === 'scan-page') return { roots: [], inventoryPage: { ...page, capture: current,
					entries: [{ ...entry, path: leak ? 'LIBRARY/private' : 'Applications' }] } };
				return { roots: [] };
			} });
		if (leak) await assert.rejects(async () => { for await (const _ of iterator) assert.fail('excluded entry escaped'); }, /excluded path/);
		else { const rows = []; for await (const p of iterator) rows.push(...p.entries); assert.equal(rows[0].path, 'Applications'); }
		assert.equal(requests.at(-1)?.action, 'scan-discard');
	}
});
