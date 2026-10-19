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

test('Mac 1.8 backup capture preserves coverage, polls one identity and pages every skip', async () => {
	const { supportsNativeBackupCapture } = await import('./mobileFolders.client');
	for (const [platform, fileAccessVersion, wanted] of [['macos', '1.7.9', false], ['macos', '1.8.0', true], ['macos', '2.8.0', false], ['ios', '1.8.0', false]] as const)
		assert.equal(supportsNativeBackupCapture({ platform, fileAccessVersion }), wanted);
	const captureId = crypto.randomUUID(), current = { ...capture, id: captureId, coverage: 'partial' as const, consistency: 'per-entry' as const, totalSkipped: 129 };
	const requests: FolderRequest[] = [], progress: unknown[] = [];
	const rows = [];
	for await (const frame of readNativeInventory({ ownerId: 'owner', deviceId: 'device', rootId, captureId, backupPolicy: { mode: 'backup', propagateDeletes: false },
		signal: new AbortController().signal, waitForPoll: async () => {}, onProgress: p => progress.push(p), request: async (_, request) => {
			requests.push(request);
			if (request.action === 'scan-capture') return { roots: [], backupCapture: { ...current, state: 'running' } };
			if (request.action === 'scan-status') { assert.equal(request.captureId, captureId); return { roots: [], backupCapture: { ...current, state: 'complete' } }; }
			if (request.action === 'scan-skips') return { roots: [], skippedPage: { capture: current, offset: request.offset, totalSkipped: 129,
				skipped: Array.from({ length: Math.min(128, 129 - request.offset) }, (_, i) => ({ ordinal: request.offset + i, path: 'link-' + (request.offset + i), reason: 'symlink', scope: 'entry' })),
				nextOffset: request.offset === 0 ? 128 : null } };
			if (request.action === 'scan-page') return { roots: [], inventoryPage: { ...page, capture: current } };
			return { roots: [] };
		} })) rows.push(frame);
	assert.equal(rows.length, 3); assert.deepEqual(rows.map(p => p.skippedPage?.skipped.length), [128, 1, undefined]);
	assert.equal(rows[2].totalEntries, 1); assert.ok(rows.every(p => p.backupCapture?.coverage === 'partial'));
	assert.equal(progress.length, 2); assert.equal(requests.at(-1)?.action, 'scan-discard');
});

test('late path collisions may retract provisional rows before the sealed count is pinned', async () => {
	const current = { ...capture, coverage: 'partial' as const, consistency: 'per-entry' as const, totalSkipped: 2 };
	const progress: number[] = [], frames = []; let polls = 0;
	for await (const frame of readNativeInventory({ ownerId: 'owner', deviceId: 'device', rootId, captureId: current.id,
		backupPolicy: { mode: 'backup', propagateDeletes: false }, signal: new AbortController().signal,
		waitForPoll: async () => {}, onProgress: p => progress.push(p.totalEntries), request: async (_, request) => {
			if (request.action === 'scan-capture') return { roots: [], backupCapture: { ...current, totalEntries: 200, totalSkipped: 0, state: 'running' } };
			if (request.action === 'scan-status') return { roots: [], backupCapture: ++polls === 1
				? { ...current, totalEntries: 100, totalSkipped: 1, state: 'running' }
				: { ...current, state: 'complete' } };
			if (request.action === 'scan-skips') return { roots: [], skippedPage: { capture: current, offset: 0, totalSkipped: 2,
				skipped: ['Foo', 'foo'].map((path, ordinal) => ({ ordinal, path, reason: 'path-collision', scope: 'subtree' })), nextOffset: null } };
			if (request.action === 'scan-page') return { roots: [], inventoryPage: { ...page, capture: current } };
			return { roots: [] };
		} })) frames.push(frame);
	assert.deepEqual(progress, [200, 100, 1]);
	assert.deepEqual(frames.flatMap(frame => frame.entries), [entry]);
	assert.equal(frames.at(-1)?.totalEntries, 1);
	assert.throws(() => parseNativeInventoryPage({ ...page, capture: { ...current, totalEntries: 200 } }, current, 0));
});

test('backup metadata cannot downgrade into strict capture or cross native pages', async () => {
	const { parseNativeBackupCapture, parseNativeSkippedPage } = await import('./nativeInventory');
	const partial = { ...capture, coverage: 'partial' as const, consistency: 'per-entry' as const, totalSkipped: 1 };
	const skips = { capture: partial, offset: 0, totalSkipped: 1, skipped: [{ ordinal: 0, path: null, reason: 'changed', scope: 'root' }], nextOffset: null };
	assert.deepEqual(parseNativeSkippedPage(skips, partial, 0), skips);
	for (const patch of [{ coverage: 'full' }, { consistency: 'snapshot' }, { totalSkipped: 0 }]) assert.throws(() => parseNativeBackupCapture({ ...partial, ...patch }));
	assert.throws(() => parseNativeInventoryPage({ ...page, capture }, partial, 0));
	assert.throws(() => parseNativeSkippedPage({ ...skips, capture }, partial, 0));
	assert.throws(() => parseNativeSkippedPage({ ...skips, skipped: [{ ordinal: 0, path: null, reason: 'symlink', scope: 'root' }] }, partial, 0));
	const request: FolderRequest = { action: 'scan-capture', rootId, inventoryDeviceId: 'device', captureId: partial.id };
	assert.throws(() => parseMobileFolderResult({ type: 'mobile-files-result', payload: { ...expected, roots: [], rootId, complete: true, capture: partial } }, expected, request));
	const response = { ...expected, roots: [], rootId, capturePolicy: 'backup-supported', complete: false, backupCapture: { ...partial, state: 'running' } };
	assert.deepEqual(parseMobileFolderResult({ type: 'mobile-files-result', payload: response }, expected, { ...request, capturePolicy: 'backup-supported' })?.backupCapture, response.backupCapture);
	assert.throws(() => parseMobileFolderResult({ type: 'mobile-files-result', payload: { ...response, complete: true } }, expected, { ...request, capturePolicy: 'backup-supported' }));
});

test('backup requires explicit deletion-free policy and transient native timeout preserves reconnect identity', async () => {
	const { NativeInventoryRetryWait } = await import('./nativeInventory');
	for (const backupPolicy of [{ mode: 'two-way', propagateDeletes: false }, { mode: 'backup', propagateDeletes: true }] as const) {
		await assert.rejects(async () => { for await (const _ of readNativeInventory({ ownerId: 'owner', deviceId: 'device', rootId, backupPolicy,
			signal: new AbortController().signal, request: async () => assert.fail('unsafe request') })) {} }, /backup with deletion/);
	}
	const captureId = crypto.randomUUID(); let calls = 0;
	for (const failure of ['Folder access timed out.', 'Permission revoked']) {
		await assert.rejects(async () => { for await (const _ of readNativeInventory({ ownerId: 'owner', deviceId: 'device', rootId, captureId,
			backupPolicy: { mode: 'backup', propagateDeletes: false }, signal: new AbortController().signal, request: async (_, request) => {
				assert.equal(request.action, 'scan-capture'); assert.equal('captureId' in request && request.captureId, captureId); calls++; throw Error(failure);
			} })) {} }, error => failure.includes('timed out') ? error instanceof NativeInventoryRetryWait : (error as Error).message === failure);
	}
	assert.equal(calls, 2);
});

test('running backup coverage remains partial until sealing, including a scan with no skips', async () => {
	const { parseNativeBackupStatus } = await import('./nativeInventory');
	const c = { ...capture, coverage: 'partial' as const, consistency: 'per-entry' as const, totalSkipped: 0 };
	assert.equal(parseNativeBackupStatus({ ...c, state: 'running' }).coverage, 'partial');
	assert.throws(() => parseNativeBackupStatus({ ...c, state: 'complete' }));
	let current = c; const frames = [];
	for await (const frame of readNativeInventory({ ownerId: 'owner', deviceId: 'device', rootId, signal: new AbortController().signal,
		backupPolicy: { mode: 'backup', propagateDeletes: false }, waitForPoll: async () => {}, request: async (_, request) => {
			if (request.action === 'scan-capture') { current = { ...c, id: request.captureId }; return { roots: [], backupCapture: { ...current, state: 'running' } }; }
			if (request.action === 'scan-status') return { roots: [], backupCapture: { ...current, coverage: 'full', state: 'complete' } };
			if (request.action === 'scan-skips') return { roots: [], skippedPage: { capture: { ...current, coverage: 'full' }, offset: 0, skipped: [], nextOffset: null, totalSkipped: 0 } };
			if (request.action === 'scan-page') return { roots: [], inventoryPage: { ...page, capture: { ...current, coverage: 'full' } } };
			return { roots: [] };
		} })) frames.push(frame);
	assert.equal(frames.at(-1)?.backupCapture?.coverage, 'full');
});

test('serialized native identity cooldown remains retryable while authority failures and aborts remain terminal', async () => {
 const { NativeInventoryRetryWait } = await import('./nativeInventory');
 for (const failure of ['Error invoking remote method: [folder_identity_retry] Folder identity verification is temporarily unavailable.',
  'Folder access could not be verified. Check pairing, consent and the selected account.', 'Folder access changed. Reopen this device with the current account.']) {
  for (const backup of [true, false]) {
   await assert.rejects(async () => {
    for await (const _ of readNativeInventory({ ownerId: 'owner', deviceId: 'device', rootId,
     backupPolicy: backup ? { mode: 'backup', propagateDeletes: false } : undefined,
     signal: new AbortController().signal, request: async () => { throw Error(failure); } })) {}
   }, error => (error instanceof NativeInventoryRetryWait) === (backup && failure.includes('[folder_identity_retry]')));
  }
 }
 const abort = new AbortController();
 await assert.rejects(async () => {
  for await (const _ of readNativeInventory({ ownerId: 'owner', deviceId: 'device', rootId,
   backupPolicy: { mode: 'backup', propagateDeletes: false }, signal: abort.signal,
   request: async () => { abort.abort(new Error('explicit cancellation')); throw Error('[folder_identity_retry]'); } })) {}
 }, /explicit cancellation/);
});

test('retry after unavailable polling reuses the task capture and reads only freshly authorized sealed pages', async () => {
 const { NativeInventoryRetryWait } = await import('./nativeInventory');
 const c = { ...capture, coverage: 'full' as const, consistency: 'per-entry' as const, totalSkipped: 0 };
 const calls: string[] = [], frames = [];
 let offline = true;
 const input = { ownerId: 'owner', deviceId: 'device', rootId, captureId: c.id,
  backupPolicy: { mode: 'backup' as const, propagateDeletes: false }, signal: new AbortController().signal,
  waitForPoll: async () => {}, request: async (_: string, r: FolderRequest) => {
   calls.push(r.action);
   if (r.action === 'scan-capture' || r.action === 'scan-status') {
    assert.equal(r.captureId, c.id);
    if (r.action === 'scan-status' && offline) throw Error('[folder_identity_retry]');
    return { roots: [], backupCapture: offline ? { ...c, coverage: 'partial' as const, state: 'running' as const } : { ...c, state: 'complete' as const } };
   }
   if (r.action === 'scan-skips') return { roots: [], skippedPage: { capture: c, offset: 0, skipped: [], nextOffset: null, totalSkipped: 0 } };
   if (r.action === 'scan-page') return { roots: [], inventoryPage: { ...page, capture: c } };
   return { roots: [] };
  } };
 await assert.rejects(async () => { for await (const frame of readNativeInventory(input)) frames.push(frame); }, NativeInventoryRetryWait);
 assert.deepEqual(calls, ['scan-capture', 'scan-status']); assert.equal(frames.length, 0);
 offline = false;
 for await (const frame of readNativeInventory(input)) frames.push(frame);
 assert.equal(frames.at(-1)?.generation, c.generation);
 assert.deepEqual(frames.at(-1)?.entries, [entry]);
 assert.deepEqual(calls.slice(2), ['scan-capture', 'scan-skips', 'scan-page', 'scan-discard']);
});

test('Gitignore policy is negotiated before all capture requests and every response echoes exact text', async () => {
 const { supportsNativeIgnoreRules } = await import('./mobileFolders.client');
 const ignoreRules = 'node_modules/\n!keep';
 assert.equal(supportsNativeIgnoreRules({ platform: 'macos', fileAccessVersion: '1.9.0' }), true);
 for (const bridge of [{ platform: 'macos' as const, fileAccessVersion: '1.8.0' }, { platform: 'ios' as const, fileAccessVersion: '1.9.0' }])
  assert.throws(() => assertNativeScanExclusions({ action: 'scan', rootId, ignoreRules }, bridge), /Gitignore/);
 const c = { ...capture, coverage: 'full' as const, consistency: 'per-entry' as const, totalSkipped: 0 };
 const pairs: [FolderRequest, object][] = [
  [{ action: 'scan', rootId, ignoreRules }, { entries: [entry] }],
  [{ action: 'scan-capture', rootId, inventoryDeviceId: 'device', captureId: capture.id, ignoreRules }, { capture }],
  [{ action: 'scan-page', rootId, inventoryDeviceId: 'device', capture, offset: 0, ignoreRules }, { inventoryPage: page }],
  [{ action: 'scan-discard', rootId, inventoryDeviceId: 'device', capture, ignoreRules }, { discarded: true }],
  [{ action: 'scan-status', rootId, inventoryDeviceId: 'device', captureId: capture.id, capturePolicy: 'backup-supported', ignoreRules }, { capturePolicy: 'backup-supported', backupCapture: { ...c, state: 'complete' } }],
  [{ action: 'scan-cancel', rootId, inventoryDeviceId: 'device', captureId: capture.id, capturePolicy: 'backup-supported', ignoreRules }, { complete: false, capturePolicy: 'backup-supported', captureId: capture.id, cancelled: true }],
  [{ action: 'scan-skips', rootId, inventoryDeviceId: 'device', capture: c, offset: 0, capturePolicy: 'backup-supported', ignoreRules }, { capturePolicy: 'backup-supported', skippedPage: { capture: c, offset: 0, totalSkipped: 0, skipped: [], nextOffset: null } }]
 ];
 for (const [request, fields] of pairs) {
  const payload = { ...expected, roots: [], rootId, complete: true, ignoreRules, ...fields };
  assert.ok(parseMobileFolderResult({ type: 'mobile-files-result', payload }, expected, request));
  for (const changed of [undefined, '', 'other/']) assert.throws(() => parseMobileFolderResult({ type: 'mobile-files-result', payload: { ...payload, ignoreRules: changed } }, expected, request), /ignore rules changed/);
 }
});


test('default status polling leaves headroom for shared device reads and aborts promptly', async t => {
 t.mock.timers.enable({ apis: ['setTimeout'] });
 const controller = new AbortController(); let statusReads = 0;
 const id = crypto.randomUUID();
 const status = { id, generation: crypto.randomUUID(), totalEntries: 0, totalSkipped: 0,
  state: 'running' as const, coverage: 'partial' as const, consistency: 'per-entry' as const };
 const iterator = readNativeInventory({ ownerId: 'owner', deviceId: 'device', rootId, captureId: id,
  signal: controller.signal, backupPolicy: { mode: 'backup', propagateDeletes: false },
  request: async (_, request) => {
   if (request.action === 'scan-status') statusReads++;
   assert.ok(['scan-capture', 'scan-status'].includes(request.action));
   return { roots: [], backupCapture: status };
  } });
 const stopped = assert.rejects(iterator.next(), /abort/i);
 for (let ms = 0; ms < 60_000; ms += 100) {
  t.mock.timers.tick(100); await new Promise<void>(resolve => setImmediate(resolve));
 }
 // Native reads authorize twice. Reserve at least half of the 240/minute
 // device budget for the monitor, heartbeat and other device operations.
 assert.ok(statusReads >= 20, 'continues observing progress');
 assert.ok(statusReads * 2 + 6 <= 120, `excessive authenticated reads: ${statusReads}`);
 controller.abort(); await stopped;
 const prior = statusReads; t.mock.timers.tick(60_000);
 await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(statusReads, prior);
});
