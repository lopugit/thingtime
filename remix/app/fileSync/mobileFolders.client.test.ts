import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { armNativePhotoRun } from './nativePhotoRun.client';
import { getNativeSyncAdapter } from './nativeSyncHost.client';
import { PHOTO_AUTOMATION_INTERVAL_MS } from './configuration';
import {
	parseMobileFolderResult,
	supportsNativeSourcePaths,
	supportsNativePhotoContinuation,
	supportsSoleNativePhotoRun,
	validNativeSourcePath,
	supportsNativePartPayloadBytes,
	mobileFolderSource,
	requestMobileFolders,
	supportsMobileFolders,
	supportsMobileSyncConditions,
	supportsMobileFolderPublication,
	supportsNativePathInspection,
	supportsNativePathStamp,
	supportsNativePhotoInventoryPages,
	supportsNativeBackupCapture,
	assertNativeFolderInventoryCoverage,
	type FolderRequest
} from './mobileFolders.client';
import { nativeBridgeMessageEvent } from '../utils/nativeBridge';
import { rootIdentity } from '../utils/rootIdentity';
import { saved, scope } from './foregroundSync.fixture';
const rootId = '00000000-0000-4000-8000-000000000001';
const expected = { requestId: 'request', ownerId: 'owner', origin: 'https://native.test' };
const root = { id: rootId, name: 'Selected folder' };
const entry = { path: 'file', id: 'inode', version: '1', kind: 'file' as const, size: 3, sha256: 'a'.repeat(64) };
test('automatic saved-settings recovery revalidates authority and backs off refusals', async t => {
	const originals = new Map(['window', 'navigator', 'indexedDB', 'IDBKeyRange', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	t.after(() => { for (const [key, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
	} });
	Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: new IDBFactory() });
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: IDBKeyRange });
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: async (_key: string, _options: object, run: () => Promise<unknown>) => run() } } });
	let now = Date.now(); t.mock.method(Date, 'now', () => now);
	for (const scenario of ['recover', 'denied', 'native-pause', 'revoked', 'saved-pause', 'local-pause', 'destination-review', 'transfer-expired', 'transfer-missing', 'transfer-permission', 'transfer-state', 'grant-changed', 'queue-changed', 'future-retry'] as const) {
		const reviewed = { ...saved, id: 'authority-' + scenario, configuration: { ...saved.configuration, localRootId: rootId, sourceKind: 'photos' as const } };
		const binding = { ...scope, rootId: reviewed.id }, actions: string[] = [], checks: string[] = [];
		const target = Object.assign(new EventTarget(), { location: { origin: scope.origin }, thingtimeNativeBridge: {
			version: '1.0.0', platform: 'ios' as const, isNativeWebView: true as const, devicePairingVersion: '1.0.0',
			fileAccessVersion: '1.8.0', fileStagingVersion: '1.2.0', filePublicationVersion: '1.2.0', filePhotoAutomationVersion: '1.2.0',
			postMessage: ({ type, payload }: { type: string; payload: any }) => {
				actions.push(payload.action);
				queueMicrotask(() => {
					const photoRoot = { id: reviewed.configuration.localRootId, name: 'Photos', sourceKind: 'photos', photoAccess: scenario === 'revoked' ? 'unavailable' : 'full' };
					let extra: object = { roots: [photoRoot] };
					if (type === 'mobile-device') extra = { state: 'paired', deviceId: scope.deviceId };
					else if (payload.action === 'photo-run-status') extra = { ...extra, rootId: photoRoot.id, configurationId: reviewed.id,
						deviceId: scope.deviceId, configurationRevision: reviewed.updatedAt, photoRunProgress: {
							stage: scenario === 'native-pause' ? 'paused' : 'needs-review', activity: { phase: 'waiting', reason: ['destination-review', 'transfer-expired', 'transfer-missing', 'transfer-permission', 'transfer-state', 'grant-changed', 'queue-changed'].includes(scenario) ? scenario : 'saved-settings' },
							...(scenario === 'future-retry' ? { retryAt: new Date(now + 600_000).toISOString() } : {}),
							confirmed: { photos: 0, videos: 0, other: 0, wifiBytes: 0, mobileBytes: 0, unknownBytes: 0 }
						} };
					else if (payload.action === 'arm-photo-run') {
						checks.push('arm');
						assert.equal(payload.resume, undefined, 'automatic retries cannot bypass native Pause');
						extra = scenario === 'denied' || scenario === 'native-pause' ? { error: 'Background transfer permission changed.' } : { ...extra,
							rootId: photoRoot.id, configurationId: reviewed.id, deviceId: scope.deviceId, configurationRevision: reviewed.updatedAt,
							photoRunArmed: true, scheduled: true, nativeOwnsRun: true, photoRunProgress: { stage: 'ready', confirmed: { photos: 0, videos: 0, other: 0, wifiBytes: 0, mobileBytes: 0, unknownBytes: 0 } } };
					}
					target.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: {
						type: type === 'mobile-device' ? 'mobile-device-result' : 'mobile-files-result', payload: { ...payload, ...extra }
					} }));
				});
			}
		}, fetch: async () => {
			checks.push('saved');
			return Response.json({ ok: true, thing: { ...reviewed, crystal: { ...reviewed.configuration, paused: scenario === 'saved-pause' },
				author: { id: scope.ownerId }, acl: ['tt:user'], thingtime: ['file-sync'] } });
		} });
		Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
		Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => Response.json({ schemaVersion: 1, origin: scope.origin, features: {
			'api.things': { version: '1.53.0' }, 'api.things-update': { version: '1.21.0' }, 'api.file-sync-transfer-admissions': { version: '1.3.0' }
		} }) });
		const run = () => armNativePhotoRun({ reviewed, scope: binding, generation: rootIdentity.read().generation,
			adapter: getNativeSyncAdapter()!, automatic: true, isPaused: () => scenario === 'local-pause', resumeScope: () => assert.fail('automatic recovery cannot resume a user pause') });
		if (['denied', 'native-pause', 'revoked', 'saved-pause'].includes(scenario)) await assert.rejects(run()); else await run();
		if (['recover', 'denied', 'transfer-expired', 'transfer-missing', 'transfer-permission', 'transfer-state'].includes(scenario)) {
			assert.deepEqual(checks, ['saved', 'arm']);
			assert.ok(actions.indexOf('list') < actions.indexOf('arm-photo-run'));
			await run(); assert.deepEqual(checks, ['saved', 'arm'], 'condition wakes retain cooldown after refusal');
			now += PHOTO_AUTOMATION_INTERVAL_MS;
			if (scenario === 'denied') await assert.rejects(run()); else await run();
			assert.deepEqual(checks, ['saved', 'arm', 'saved', 'arm']);
		} else if (scenario === 'native-pause') assert.deepEqual(checks, ['saved', 'arm'], 'native refuses an automatic attempt without explicit Resume');
		else assert.ok(!checks.includes('arm'), scenario + ' cannot obtain new authority');
	}
});
const response = (extra = {}) => ({ type: 'mobile-files-result', payload: { ...expected, roots: [root], ...extra } });
test('single-path inspection negotiates the native contract and requires explicit scoped absence', () => {
	for (const [platform, version, supported] of [
		['macos', '1.3.0', false], ['macos', '1.4.0', true], ['ios', '1.1.1', false], ['ios', '1.2.0', true],
		['ios', '2.0.0', false], ['android', '1.4.0', false], ['android', '1.9.0', false], ['ios', '1.bad.0', false]
	] as const) assert.equal(supportsNativePathInspection({ platform, fileAccessVersion: version }), supported);
	const parse = (extra: object) => parseMobileFolderResult(response({ rootId, path: 'file', complete: true, entry, ...extra }), expected, { action: 'inspect', rootId, path: 'file' });
	assert.deepEqual(parse({})?.inspectedEntry, entry);
	assert.equal(parse({ entry: null })?.inspectedEntry, null);
	for (const patch of [{ entry: undefined }, { complete: false }, { path: 'other' }, { rootId: 'other' },
		{ entry: { ...entry, path: 'other' } }, { entry: { ...entry, size: -1 } }]) assert.throws(() => parse(patch));
});
test('Mac stamp inspection is additive and cannot smuggle a digest into metadata', () => {
	for (const [platform, version, supported] of [
		['macos', '1.21.0', false], ['macos', '1.22.0', true], ['macos', '1.23.0', true],
		['macos', '2.0.0', false], ['ios', '1.22.0', false]
	] as const) assert.equal(supportsNativePathStamp({ platform, fileAccessVersion: version }), supported);
	const stamp = { path: 'file', id: entry.id, version: entry.version, kind: 'file', size: entry.size };
	const parse = (value: unknown) => parseMobileFolderResult(response({ rootId, path: 'file', complete: true, stamp: value }), expected,
		{ action: 'inspect-stamp', rootId, path: 'file' });
	assert.deepEqual(parse(stamp)?.inspectedStamp, stamp);
	assert.equal(parse(null)?.inspectedStamp, null);
	for (const invalid of [undefined, { ...stamp, path: 'other' }, { ...stamp, size: -1 }, { ...stamp, fingerprint: 'a'.repeat(64) }])
		assert.throws(() => parse(invalid));
});
test('photo inventory pages negotiate independently of legacy folder pages', () => {
	for (const [platform, version, supported] of [
		['macos', '1.18.0', false], ['macos', '1.19.0', true],
		['ios', '1.4.0', false], ['ios', '1.5.0', true], ['ios', '1.6.0', true],
		['macos', '2.0.0', false], ['android', '1.99.0', false]
	] as const) assert.equal(supportsNativePhotoInventoryPages({ platform, fileAccessVersion: version }), supported);
});
test('iOS Rust backup negotiates per-entry pages without advertising strict folder coverage', () => {
	const modern = { platform: 'ios', fileAccessVersion: '1.5.0', fileInventoryStrictCoverage: false } as const;
	assert.equal(supportsNativeBackupCapture(modern), true);
	assert.equal(supportsNativeBackupCapture({ ...modern, fileAccessVersion: '1.4.0' }), false);
	assert.doesNotThrow(() => assertNativeFolderInventoryCoverage(modern, { mode: 'backup', propagateDeletes: false }));
	for (const mode of ['two-way', 'download', 'upload', 'backup'] as const) {
		assert.throws(() => assertNativeFolderInventoryCoverage(modern, { mode, propagateDeletes: true }), /one-way Backup/);
		if (mode !== 'backup') assert.throws(() => assertNativeFolderInventoryCoverage(modern, { mode, propagateDeletes: false }), /complete folder inventory/);
	}
	assert.doesNotThrow(() => assertNativeFolderInventoryCoverage({ platform: 'macos', fileAccessVersion: '1.19.0' }, { mode: 'two-way', propagateDeletes: false }));
});
test('native folder capability is explicit and account/origin/request responses are fenced', () => {
	assert.equal(supportsMobileFolders({ platform: 'ios', isNativeWebView: true } as any), false);
	assert.equal(supportsMobileFolders({ platform: 'android', isNativeWebView: true, fileAccessVersion: '1.0.0' } as any), true);
	assert.equal(supportsMobileFolders({ platform: 'ios', isNativeWebView: true, fileAccessVersion: '1.0.0' } as any), true);
	for (const key of ['requestId', 'ownerId', 'origin'])
		assert.equal(parseMobileFolderResult(response({ [key]: 'different' }), expected, { action: 'list' }), null);
	assert.deepEqual(parseMobileFolderResult(response(), expected, { action: 'list' }), { roots: [root] });
	assert.throws(() => parseMobileFolderResult(response({ error: 'Permission unavailable' }), expected, { action: 'list' }), /Permission unavailable/);
	assert.throws(() => parseMobileFolderResult(response({ roots: [root, root] }), expected, { action: 'list' }), /Invalid native/);
});
test('incomplete, duplicate, colliding and missing-ancestor scans never become an empty inventory', () => {
	const parse = (extra: object) =>
		parseMobileFolderResult(response({ rootId, complete: true, entries: [entry], ...extra }), expected, { action: 'scan', rootId });
	assert.equal(parse({})?.entries?.length, 1);
	for (const extra of [
		{ complete: false },
		{ rootId: 'other' },
		{ entries: [entry, entry] },
		{ entries: [{ ...entry, path: '../file' }] },
		{ entries: [{ ...entry, path: 'missing/file' }] },
		{ entries: [entry, { ...entry, id: 'other', path: 'FILE' }] }
	])
		assert.throws(() => parse(extra));
	assert.deepEqual(parse({ entries: [] })?.entries, []);
});
test('scan diagnostics remain scoped failures and cannot disguise a partial inventory as complete', () => {
	for (const action of ['scan', 'scan-capture'] as const) {
		const request = action === 'scan' ? { action, rootId } : {
			action, rootId, inventoryDeviceId: 'device', captureId: '00000000-0000-4000-8000-000000000002'
		};
		const diagnostic = { rootId, complete: false, scanFailure: { reason: 'symlink', path: 'nested/link' } };
		const parse = (extra = {}) => parseMobileFolderResult(response({ ...diagnostic, ...extra }), expected, request);
		assert.throws(() => parse(), /Indexing stopped at “nested\/link”: symbolic links are not supported/);
		for (const key of ['requestId', 'ownerId', 'origin']) assert.equal(parse({ [key]: 'other' }), null);
		for (const extra of [
			{ rootId: 'other' }, { complete: true }, { complete: undefined }, { entries: [] }, { capture: {} }, { inventoryPage: {} },
			{ scanFailure: { reason: 'unknown', path: 'nested/link' } }, { scanFailure: { reason: 'toString', path: 'nested/link' } },
			{ scanFailure: { reason: 'unreadable', path: null } }, { scanFailure: { reason: 'symlink', path: '/private/path' } },
			{ scanFailure: { reason: 'symlink', path: '../outside' } }, { scanFailure: { reason: 'symlink', path: 'bad\u202epath' } },
			{ scanFailure: { reason: 'symlink', path: 'nested/link', message: 'untrusted native details' } }
		]) assert.throws(() => parse(extra), /Invalid native scan diagnostic/);
		assert.throws(() => parse({ scanFailure: { reason: 'invalid-path', path: null } }), /Indexing stopped: a path cannot be represented safely/);
		for (const reason of ['special', 'unreadable', 'changed', 'duplicate-identity', 'path-collision'])
			assert.throws(() => parse({ scanFailure: { reason, path: 'nested/file' } }), /Indexing stopped at “nested\/file”/);
		assert.throws(() => parseMobileFolderResult(response(diagnostic), expected, { action: 'list' }), /Invalid native scan diagnostic/);
	}
});
test('bounded reads reject changed versions, offsets, byte counts and source sizes', () => {
	const request = { action: 'read' as const, rootId, path: 'file', version: '1', offset: 0, length: 3 };
	const chunk = { version: '1', size: 3, offset: 0, data: 'AQID' };
	assert.equal(parseMobileFolderResult(response({ rootId, path: 'file', chunk }), expected, request)?.chunk?.data, 'AQID');
	for (const patch of [{ version: '2' }, { offset: 1 }, { data: 'AQ==' }, { data: '_not_base64_' }, { size: -1 }])
		assert.throws(() => parseMobileFolderResult(response({ rootId, path: 'file', chunk: { ...chunk, ...patch } }), expected, request));
});
test('native source chunks reads, rechecks its version, and cancels the exact pending request', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const target = new EventTarget() as any;
	target.location = { origin: expected.origin };
	let requests: any[] = [],
		changed = false,
		hold = false;
	target.thingtimeNativeBridge = {
		platform: 'android',
		isNativeWebView: true,
		fileAccessVersion: '1.2.0',
		postMessage(message: any) {
			const p = message.payload;
			requests.push(p);
			if (p.action === 'suspend' || hold) return;
			queueMicrotask(() =>
				target.dispatchEvent(
					new CustomEvent(nativeBridgeMessageEvent, {
						detail: {
							type: 'mobile-files-result',
							payload: {
								...p,
								roots: [root],
								...(changed
									? { error: 'File changed' }
									: {
											chunk: {
												version: p.version,
												offset: p.offset,
												size: 131073,
												data: btoa(String.fromCharCode(7).repeat(Math.min(p.length, 131073 - p.offset)))
											}
									  })
							}
						}
					})
				)
			);
		}
	};
	Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
	try {
		const controller = new AbortController(),
			source = mobileFolderSource('owner', rootId, { ...entry, size: 131073 }, controller.signal);
		await source.check();
		const bytes = await source.read(0, 131073);
		assert.equal(bytes.length, 131073);
		assert.ok(bytes.every((b) => b === 7));
		assert.deepEqual(
			requests.map((r) => r.length),
			[1, 65536, 65536, 1]
		);
		assert.ok(requests.every((r) => r.verifiedChunks === true));
		await source.verify!();
		assert.equal(requests.at(-1).verifiedChunks, undefined);
		changed = true;
		await assert.rejects(async () => source.check(), /File changed/);
		changed = false;
		hold = true;
		const pending = requestMobileFolders('owner', { action: 'choose' }, controller.signal);
		const id = requests.at(-1).requestId;
		controller.abort();
		await assert.rejects(pending, { name: 'AbortError' });
		assert.equal(requests.at(-1).action, 'suspend');
		assert.equal(requests.at(-1).requestId, id);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else delete (globalThis as any).window;
	}
});

function iosFolderBridge(t: TestContext) {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	type Request = FolderRequest & typeof expected;
	const requests: Request[] = [];
	const location = { origin: expected.origin };
	const target = Object.assign(new EventTarget(), { location, thingtimeNativeBridge: {
		version: '1.0.0', platform: 'ios', isNativeWebView: true, fileAccessVersion: '1.8.0', filePhotoAutomationVersion: '1.2.0', fileUploadVersion: '1.5.0',
		postMessage: ({ payload }: { payload: Request }) => { requests.push(payload); }
	} });
	Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
	t.after(() => {
		rootIdentity.confirm(rootIdentity.read().generation);
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else Reflect.deleteProperty(globalThis, 'window');
	});
	const reply = ({ requestId, ownerId, origin }: Request, payload: object = { roots: [root] }) =>
		target.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, {
			detail: { type: 'mobile-files-result', payload: { requestId, ownerId, origin, ...payload } }
		}));
	return { requests, reply, location };
}

test('queued iOS cancellation leaves the active slot alone and native Pause bypasses it', async t => {
	const { requests, reply } = iosFolderBridge(t);
	const activeController = new AbortController(), queuedController = new AbortController(), signal = new AbortController().signal;
	const active = requestMobileFolders('owner', { action: 'list' }, activeController.signal);
	const queued = requestMobileFolders('owner', { action: 'choose' }, queuedController.signal);
	const next = requestMobileFolders('owner', { action: 'list' }, signal);
	await Promise.resolve();
	assert.deepEqual(requests.map(request => request.action), ['list']);
	queuedController.abort();
	await assert.rejects(queued, { name: 'AbortError' });
	assert.deepEqual(requests.map(request => request.action), ['list']);

	const pause = requestMobileFolders('owner', { action: 'pause-photo-runs' }, signal);
	assert.deepEqual(requests.map(request => request.action), ['list', 'pause-photo-runs']);
	reply(requests[1], { roots: [], photoRunsPaused: true });
	await pause;
	const cancel = requestMobileFolders('owner', { action: 'cancel-deferred-upload', rootId,
		configurationId: 'connection', deviceId: 'device' }, signal);
	assert.deepEqual(requests.map(request => request.action), ['list', 'pause-photo-runs', 'cancel-deferred-upload']);
	reply(requests[2], { roots: [], rootId, configurationId: 'connection', cancelled: true });
	await cancel;

	activeController.abort();
	await assert.rejects(active, { name: 'AbortError' });
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(requests.map(request => request.action), ['list', 'pause-photo-runs', 'cancel-deferred-upload', 'suspend', 'list']);
	assert.equal(requests[3].requestId, requests[0].requestId);
	reply(requests[4]);
	await next;
});

for (const change of ['account', 'origin'] as const) {
	test(`queued iOS work cannot cross a change of ${change}`, async t => {
		const { requests, reply, location } = iosFolderBridge(t);
		const signal = new AbortController().signal;
		const active = requestMobileFolders('owner', { action: 'list' }, signal);
		const queued = requestMobileFolders('owner', { action: 'choose' }, signal);
		await Promise.resolve();
		if (change === 'account') {
			rootIdentity.changed();
			rootIdentity.confirm(rootIdentity.read().generation);
		} else location.origin = 'https://different.native.test';
		reply(requests[0]);
		await Promise.all([assert.rejects(active, { name: 'AbortError' }), assert.rejects(queued, { name: 'AbortError' })]);
		assert.deepEqual(requests.map(request => request.action), ['list']);
		const fresh = requestMobileFolders('current-owner', { action: 'list' }, signal);
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(requests[1].origin, location.origin);
		assert.equal(requests[1].ownerId, 'current-owner');
		reply(requests[1]);
		await fresh;
	});
}

test('iOS retries a busy status read once and never resends an uncertain arm', async t => {
	const { requests, reply } = iosFolderBridge(t);
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const signal = new AbortController().signal;
	const status: FolderRequest = { action: 'photo-run-status', rootId, configurationId: 'connection', deviceId: 'device' };
	const read = requestMobileFolders('owner', status, signal);
	await Promise.resolve();
	reply(requests[0], { error: 'Another folder request is running.' });
	await new Promise<void>(resolve => setImmediate(resolve));
	t.mock.timers.tick(150);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.deepEqual(requests.map(request => request.action), ['photo-run-status', 'photo-run-status']);
	reply(requests[1], { roots: [], rootId, configurationId: 'connection', deviceId: 'device', photoRunProgress: null });
	await read;

	const arm: FolderRequest = { action: 'arm-photo-run', rootId, execution: 'native',
		authorization: { ...saved, configuration: { ...saved.configuration, localRootId: rootId, sourceKind: 'photos' },
			scope: { ...scope, origin: expected.origin } }
	};
	const busy = requestMobileFolders('owner', arm, signal);
	await new Promise<void>(resolve => setImmediate(resolve));
	reply(requests[2], { error: 'Another folder request is running.' });
	await assert.rejects(busy, /Another folder request is running/);
	const uncertain = requestMobileFolders('owner', arm, signal);
	await new Promise<void>(resolve => setImmediate(resolve));
	t.mock.timers.tick(30_000);
	await assert.rejects(uncertain, /Folder access timed out/);
	assert.deepEqual(requests.map(request => request.action), ['photo-run-status', 'photo-run-status', 'arm-photo-run', 'arm-photo-run', 'suspend']);
	assert.equal(requests[4].requestId, requests[3].requestId);
});

test('transfer conditions require the new native capability and reject missing or malformed policy signals', () => {
	for (const [version, supported] of [
		['1.0.0', false],
		['1.1.0', true],
		['2.0.0', false]
	] as const)
		assert.equal(supportsMobileSyncConditions({ platform: 'ios', isNativeWebView: true, fileAccessVersion: version } as any), supported);
	for (const network of ['wifi', 'cellular', 'ethernet', 'offline', 'unknown'])
		for (const charging of [true, false, null])
			assert.deepEqual(parseMobileFolderResult(response({ conditions: { network, charging } }), expected, { action: 'conditions' })?.conditions, {
				network,
				charging
			});
	for (const conditions of [undefined, {}, { network: 'wifi' }, { network: 'wifi', charging: 1 }, { network: 'unmetered', charging: true }])
		assert.throws(() => parseMobileFolderResult(response({ conditions }), expected, { action: 'conditions' }), /conditions are unavailable/);
});

test('folder publication is scoped, version negotiated and projected without native paths', () => {
	const android = {
		platform: 'android',
		isNativeWebView: true,
		fileAccessVersion: '1.3.0',
		fileStagingVersion: '1.0.0',
		filePublicationVersion: '1.1.0'
	} as any;
	const parse = (extra: object) => parseMobileFolderResult(response({ roots: [{ ...root, ...extra }] }), expected, { action: 'list' })!.roots[0];
	assert.deepEqual(parse({ publicationVersion: '1.0.0', uri: 'content://private', owner: 'private' }), { ...root, publicationVersion: '1.0.0' });
	assert.equal(supportsMobileFolderPublication(parse({ publicationVersion: '1.0.0' }), android), true);
	for (const folder of [undefined, root, { ...root, publicationVersion: '2.0.0' }])
		assert.equal(supportsMobileFolderPublication(folder, android), false);
	for (const version of [null, true, '', '1', '1.0.0-private']) assert.throws(() => parse({ publicationVersion: version }));
	assert.equal(supportsMobileFolderPublication(root, { ...android, platform: 'ios', filePublicationVersion: '1.0.0' }), true);
	assert.equal(supportsMobileFolderPublication(root, { ...android, filePublicationVersion: '1.0.0' }), false);
});

test('Mac 1.2 reads a full bounded range once and validates binary stream framing', async () => {
	const size = 8 * 1024 * 1024 + 17,
		bytes = new Uint8Array(size).fill(23),
		controller = new AbortController();
	const scanned = { ...entry, size },
		calls: string[] = [];
	const request = async (_owner: string, input: any) => {
		calls.push(input.action);
		if (input.action === 'read') return { roots: [root], chunk: { version: '1', size, offset: 0, data: 'Fw==' } };
		return parseMobileFolderResult(
			response({
				rootId,
				path: entry.path,
				chunk: { version: '1', size, offset: input.offset, length: input.length, bytes: bytes.slice(input.offset, input.offset + input.length) }
			}),
			expected,
			input
		)!;
	};
	const source = mobileFolderSource('owner', rootId, scanned, controller.signal, request, { platform: 'macos', fileAccessVersion: '1.2.0' });
	await source.check();
	assert.deepEqual(await source.read(0, size), bytes);
	assert.deepEqual(calls, ['read', 'read-range']);
	const input = { action: 'read-range' as const, rootId, path: entry.path, version: '1', offset: 0, length: 3 };
	for (const patch of [{ bytes: [1, 2, 3] }, { bytes: new Uint8Array(2) }, { offset: 1 }, { version: '2' }, { size: 2 }, { length: 4 }]) {
		assert.throws(() =>
			parseMobileFolderResult(
				response({ rootId, path: entry.path, chunk: { version: '1', size: 3, offset: 0, length: 3, bytes: new Uint8Array(3), ...patch } }),
				expected,
				input
			)
		);
	}
	controller.abort();
	await assert.rejects(source.read(0, 3));
	await assert.rejects(source.read(0, 32 * 1024 * 1024 + 1));
});

test('Android streams correlated binary pulls, rejects early completion and stops malformed or aborted ranges', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const target = new EventTarget() as any;
	target.location = { origin: expected.origin };
	const bytes = new Uint8Array(65539).fill(19);
	let mode = 'ok',
		suspended = 0,
		frames = 0,
		at = 0,
		current: any,
		token: string;
	const emit = (type: string, payload: any) => target.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: { type, payload } }));
	const pull = () => {
		token = crypto.randomUUID();
		emit('mobile-files-range-pull', { ...current, token, offset: mode === 'malformed' ? at + 1 : at, length: Math.min(65536, bytes.length - at) });
	};
	const complete = () => emit('mobile-files-result', { ...current, roots: [root], staging: { received: bytes.length } });
	target.thingtimeNativeBridge = {
		platform: 'android',
		isNativeWebView: true,
		fileAccessVersion: '1.3.0',
		fileStagingVersion: '1.1.0',
		postMessage(message: any) {
			if (message.payload.action === 'suspend') {
				suspended++;
				return;
			}
			current = message.payload;
			at = 0;
			assert.equal(current.length, bytes.length);
			assert.equal(current.bytes, undefined);
			assert.equal(current.data, undefined);
			queueMicrotask(() => {
				if (mode === 'early') complete();
				else if (mode !== 'hold') pull();
			});
		},
		postFileFrame(frame: ArrayBuffer) {
			assert.ok(frame instanceof ArrayBuffer);
			assert.equal(new TextDecoder().decode(frame.slice(0, 36)), token);
			const body = new Uint8Array(frame, 36);
			assert.deepEqual(body, bytes.slice(at, at + body.length));
			assert.ok(body.length <= 65536);
			at += body.length;
			frames++;
			queueMicrotask(() => {
				if (at === bytes.length) complete();
				else pull();
			});
		}
	};
	Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
	const scope = { ownerId: 'owner', origin: expected.origin, dataPlane: 'home', rootId: 'config', deviceId: 'device' };
	const input = {
		action: 'stage-range' as const,
		rootId,
		offset: 0,
		bytes,
		transfer: {
			scope,
			rootId,
			operation: {
				id: crypto.randomUUID(),
				confirmed: false,
				mutation: { kind: 'copy' as const, from: 'remote' as const, path: 'file', expectedTarget: null, source: { ...entry, size: bytes.length } }
			}
		}
	};
	try {
		assert.equal((await requestMobileFolders('owner', input, new AbortController().signal)).staging!.received, bytes.length);
		assert.equal(frames, 2);
		for (const failure of ['early', 'malformed']) {
			mode = failure;
			await assert.rejects(requestMobileFolders('owner', input, new AbortController().signal));
		}
		assert.equal(suspended, 2);
		mode = 'hold';
		const abort = new AbortController(),
			pending = requestMobileFolders('owner', input, abort.signal);
		abort.abort();
		await assert.rejects(pending, { name: 'AbortError' });
		assert.equal(suspended, 3);
		target.thingtimeNativeBridge.fileStagingVersion = '1.0.0';
		await assert.rejects(requestMobileFolders('owner', input, new AbortController().signal), /Update the Android/);
		assert.equal(suspended, 3);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else Reflect.deleteProperty(globalThis, 'window');
	}
});

test('Android upload ranges require ordered binary frames and a matching final receipt', async () => {
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	const target = new EventTarget() as any;
	target.location = { origin: expected.origin };
	const bytes = new Uint8Array(65539).fill(23);
	let mode = 'ok',
		current: any,
		at = 0,
		frames = 0,
		suspended = 0,
		token: string;
	const emit = (type: string, payload: any) => target.dispatchEvent(new CustomEvent(nativeBridgeMessageEvent, { detail: { type, payload } }));
	const complete = () =>
		emit('mobile-files-result', {
			...current,
			roots: [root],
			chunk: {
				version: mode === 'version' ? 'changed' : current.version,
				size: bytes.length,
				offset: current.offset,
				length: bytes.length
			}
		});
	const send = () => {
		token = crypto.randomUUID();
		const count = Math.min(65536, bytes.length - at),
			frame = new Uint8Array(76 + count);
		frame.set(new TextEncoder().encode(current.requestId));
		frame.set(new TextEncoder().encode(token), 36);
		new DataView(frame.buffer).setUint32(72, mode === 'order' ? at + 1 : at);
		frame.set(bytes.subarray(at, at + count), 76);
		// An old request cannot supply bytes or elicit an acknowledgement.
		const stale = frame.slice();
		stale.set(new TextEncoder().encode(crypto.randomUUID()));
		emit('mobile-files-read-frame', { frame: stale.buffer });
		emit('mobile-files-read-frame', { frame: frame.buffer });
	};
	target.thingtimeNativeBridge = {
		platform: 'android',
		isNativeWebView: true,
		fileAccessVersion: '1.4.0',
		postMessage(message: any) {
			if (message.payload.action === 'suspend') {
				suspended++;
				return;
			}
			current = message.payload;
			at = 0;
			queueMicrotask(() => {
				if (mode === 'early') complete();
				else if (mode !== 'hold') send();
			});
		},
		postFileFrame(ack: ArrayBuffer) {
			assert.equal(ack.byteLength, 36);
			assert.equal(new TextDecoder().decode(ack), token);
			frames++;
			at += Math.min(65536, bytes.length - at);
			queueMicrotask(() => {
				if (at === bytes.length) complete();
				else send();
			});
		}
	};
	Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
	const input = { action: 'read-range' as const, rootId, path: entry.path, version: '1', offset: 0, length: bytes.length };
	try {
		assert.deepEqual((await requestMobileFolders('owner', input, new AbortController().signal)).range!.bytes, bytes);
		assert.equal(frames, 2);
		for (const failed of ['early', 'order', 'version']) {
			mode = failed;
			await assert.rejects(requestMobileFolders('owner', input, new AbortController().signal));
		}
		assert.equal(suspended, 3);
		mode = 'hold';
		const controller = new AbortController(),
			pending = requestMobileFolders('owner', input, controller.signal);
		controller.abort();
		await assert.rejects(pending, { name: 'AbortError' });
		assert.equal(suspended, 4);
		target.thingtimeNativeBridge.fileAccessVersion = '1.3.0';
		await assert.rejects(requestMobileFolders('owner', input, new AbortController().signal), /Update the Android/);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else Reflect.deleteProperty(globalThis, 'window');
	}
});

test('Android 1.4 source selects binary reads while retaining full final verification', async () => {
	const calls: FolderRequest[] = [],
		bytes = new Uint8Array(65539).fill(1);
	const send = async (_owner: string, input: FolderRequest) => {
		calls.push(input);
		return input.action === 'read'
			? { roots: [root], chunk: { version: '1', size: bytes.length, offset: 0, data: 'AQ==' } }
			: { roots: [root], range: { version: '1', size: bytes.length, offset: 0, bytes } };
	};
	const source = mobileFolderSource('owner', rootId, { ...entry, size: bytes.length }, new AbortController().signal, send, {
		platform: 'android',
		fileAccessVersion: '1.4.0'
	});
	await source.check();
	assert.deepEqual(await source.read(0, bytes.length), bytes);
	await source.verify!();
	assert.deepEqual(
		calls.map((c) => c.action),
		['read', 'read-range', 'read']
	);
	assert.equal((calls[0] as any).verifiedChunks, true);
	assert.equal((calls[2] as any).verifiedChunks, undefined);
});

test('empty native sources retain exact-version checks and bypass positive-only native upload adapters', async () => {
    const empty = { ...entry, size: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
    const calls: FolderRequest[] = []; let stale = false;
    const send = async (_owner: string, input: FolderRequest) => {
        calls.push(input); assert.equal(input.action, 'read');
        return parseMobileFolderResult(response({ rootId, path: empty.path, chunk: { version: stale ? 'changed' : empty.version, offset: 0, size: 0, data: '' } }), expected, input)!;
    };
    const source = mobileFolderSource('owner', rootId, empty, new AbortController().signal, send, { platform: 'ios', fileAccessVersion: '1.3.0', fileUploadVersion: '1.3.0' });
    assert.equal(source.size, 0); assert.equal(source.uploadFile, undefined); assert.equal(source.uploadPart, undefined);
    await source.check(); await source.verify!();
    assert.deepEqual(await source.read(0, 0), new Uint8Array());
    assert.equal(calls.length, 2); assert.ok(calls.every(call => call.action === 'read' && call.length === 1));
    stale = true; await assert.rejects(async () => { await source.check(); }, /Native file changed/);
});

test('only updated Mac part adapters advertise validated native source fences', () => {
 const entry = { id: 'file', path: 'file.bin', version: 'v1', kind: 'file' as const, size: 4, sha256: 'a'.repeat(64) };
 for (const [platform, fileAccessVersion, expected] of [['macos', '1.11.1', undefined], ['macos', '1.12.0', true], ['ios', '1.12.0', undefined], ['android', '1.12.0', undefined]] as const) {
  const source = mobileFolderSource('owner', 'root', entry, new AbortController().signal, async () => { throw Error('construction performs no IO'); }, { platform, fileAccessVersion, fileUploadVersion: '1.0.1' });
  assert.equal(source.nativePartSourceChecks, expected);
 }
});

test('Mac payload receipt telemetry is additive, exact-length and independently negotiated', () => {
 for (const [platform, version, supported] of [
  ['macos', '1.0.1', false], ['macos', '1.1.0', true], ['macos', '1.2.0', true],
  ['macos', '2.1.0', false], ['ios', '1.3.0', false], ['android', '1.1.0', false]
 ] as const) assert.equal(supportsNativePartPayloadBytes({ platform, fileUploadVersion: version }), supported);
 const upload = { uploadId: 'attachment', requestId: 'operation', partNumber: 1, offset: 0, length: 3, source: entry };
 const part = { ...upload, version: entry.version, size: entry.size, sha256: 'a'.repeat(64) };
 const parse = (patch: object) => parseMobileFolderResult(response({ rootId, uploadedPart: { ...part, ...patch } }), expected, { action: 'upload-part', rootId, upload })!.uploadedPart;
 assert.deepEqual(parse({ payloadBytes: 3 }), { sha256: part.sha256, payloadBytes: 3 });
 for (const payloadBytes of [undefined, null, 0, 2, 4, -1, 0.5, NaN, '3', Infinity])
  assert.deepEqual(parse({ payloadBytes }), { sha256: part.sha256 });
 for (const patch of [{ sha256: 'bad' }, { requestId: 'wrong' }, { length: 4 }, { version: 'changed' }])
  assert.throws(() => parse({ payloadBytes: 3, ...patch }), /receipt/);
});

test('only negotiated Mac sources propagate exact accepted payload measurements', async () => {
 for (const [platform, fileUploadVersion, known] of [['macos', '1.0.1', false], ['macos', '1.1.0', true], ['ios', '1.3.0', false]] as const) {
  for (const payloadBytes of [undefined, 0, 3, 4]) {
   const source = mobileFolderSource('owner', rootId, entry, new AbortController().signal,
    async () => ({ roots: [root], uploadedPart: { sha256: 'a'.repeat(64), payloadBytes } }),
    { platform, fileUploadVersion, fileAccessVersion: '1.12.0' });
   assert.equal(source.nativePartPayloadBytes, known ? true : undefined);
   assert.deepEqual(await source.uploadPart!({ uploadId: 'attachment', requestId: 'operation', partNumber: 1, offset: 0, length: 3 }),
    { sha256: 'a'.repeat(64), ...(known && payloadBytes === 3 ? { payloadBytes: 3 } : {}) });
  }
 }
});


test('Mac source paths remain exact owner-bound metadata, separate from relative IO paths', () => {
 const sourcePath = '/Volumes/External/Projects/Music library';
 assert.equal(supportsNativeSourcePaths({ platform: 'macos', fileAccessVersion: '1.15.0' }), true);
 for (const bridge of [{ platform: 'macos', fileAccessVersion: '1.14.0' }, { platform: 'macos', fileAccessVersion: '2.15.0' }, { platform: 'ios', fileAccessVersion: '1.15.0' }] as const) assert.equal(supportsNativeSourcePaths(bridge), false);
 assert.equal(parseMobileFolderResult(response({ roots: [{ ...root, sourcePath }] }), expected, { action: 'list' })?.roots[0].sourcePath, sourcePath);
 assert.equal(parseMobileFolderResult(response({ ownerId: 'other', roots: [{ ...root, sourcePath }] }), expected, { action: 'list' }), null);
 for (const path of ['relative/folder', '//remote/share', '/a/../b', '/a/./b', '/a//b', '/a\0b']) {
  assert.equal(validNativeSourcePath(path), false);
  assert.throws(() => parseMobileFolderResult(response({ roots: [{ ...root, sourcePath: path }] }), expected, { action: 'list' }), /Invalid native/);
 }
 assert.throws(() => parseMobileFolderResult(response({ roots: [{ ...root, sourcePath, sourceKind: 'photos', photoAccess: 'full' }] }), expected, { action: 'list' }), /Invalid native/);
 assert.equal(validNativeSourcePath('/'), true);
});


test('compound observation requires exact policy echo and complete ordered candidate/parent observations', () => {
 const observation = { version: 1 as const, network: 'wifi' as const, chargingOnly: true, configurationId: 'connection', configurationRevision: '2026-11-07T00:00:00.000Z' };
 const request = { action: 'observe-path' as const, rootId, path: 'nested/file', observation, remainingMs: 30_000 };
 const entries = [{ ...entry, path: 'nested/file' }, null];
 const parse = (extra = {}) => parseMobileFolderResult(response({ rootId, path: request.path, observation, complete: true, observedEntries: entries, conditions: { network: 'wifi', charging: true }, ...extra }), expected, request);
 assert.deepEqual(parse()!.observedEntries, entries);
 assert.throws(() => parse({ observation: { ...observation, configurationRevision: 'changed' } }));
 assert.throws(() => parse({ observedEntries: [null] }));
 assert.throws(() => parse({ observedEntries: [...entries].reverse() }));
 assert.throws(() => parse({ conditions: { network: 'unknown', charging: true } }));
 assert.throws(() => parse({ complete: false }));
 assert.equal(parse({ complete: false, observationUnavailable: true, observedEntries: [] })!.observationUnavailable, true);
 assert.throws(() => parse({ complete: false, observationUnavailable: true, observedEntries: [null] }));
});

const iosPhotoRoots = [{ id: rootId, name: 'Photo Library', sourceKind: 'photos', photoAccess: 'full' }];

test('native Photos run status accepts the iOS grant snapshot and preserves exact counters', () => {
	const request = { action: 'photo-run-status', rootId, configurationId: 'config', deviceId: 'phone' } as const;
	const revision = '2026-11-08T00:00:00.000Z';
	const counters = { photos: 2, videos: 1, other: 0, wifiBytes: 12, mobileBytes: 4, unknownBytes: 1 };
	const progress = { stage: 'uploading', configurationRevision: revision, confirmed: counters,
		currentFile: { confirmedBytes: 6, sentBytes: 8, totalBytes: 10 }, uploadBytesPerSecond: 4, privatePath: '/hidden' };
	const parse = (patch: object) => parseMobileFolderResult(response({ ...request, roots: iosPhotoRoots, configurationRevision: revision,
		photoRunProgress: progress, ...patch }), expected, request)?.photoRunStatus;
	const result = parse({});
	assert.equal(result?.configurationRevision, revision);
	assert.deepEqual(result?.photoRunProgress?.confirmed, counters);
	assert.equal(result?.photoRunProgress?.uploadBytesPerSecond, 4);
	assert.equal(result?.photoRunProgress?.activity, undefined);
	assert.equal(JSON.stringify(result).includes('privatePath'), false);
	assert.deepEqual(parse({ configurationRevision: undefined, photoRunProgress: null }), { configurationRevision: null, photoRunProgress: null });
	for (const patch of [
		{ configurationId: 'other' }, { deviceId: 'other' }, { rootId: 'other' },
		{ roots: [...iosPhotoRoots, ...iosPhotoRoots] },
		{ configurationRevision: '2026-11-08T00:01:00.000Z' },
		{ photoRunProgress: { ...progress, confirmed: { ...counters, mobileBytes: -1 } } },
		{ photoRunProgress: { ...progress, currentFile: { ...progress.currentFile, sentBytes: 11 } } }
	]) assert.throws(() => parse(patch));
});

test('optional native Photos activity exposes only measured progress and known, newest-first events', () => {
	const request = { action: 'photo-run-status', rootId, configurationId: 'config', deviceId: 'phone' } as const;
	const revision = '2026-11-08T00:00:00.000Z';
	const progress = { stage: 'preparing', confirmed: { photos: 2, videos: 1, other: 0, wifiBytes: 12, mobileBytes: 4, unknownBytes: 1 } };
	const parse = (activity: unknown) => parseMobileFolderResult(response({ ...request, roots: iosPhotoRoots,
		configurationRevision: revision, photoRunProgress: { ...progress, activity } }), expected, request)?.photoRunStatus?.photoRunProgress;
	assert.deepEqual(parse({
		phase: 'downloading', downloadFraction: 0, backlogOriginals: 0, privatePath: '/hidden', backgroundRequest: 'declined',
		indexed: { photos: 2, videos: 0, files: 4, assetId: 'private' }, prepared: { completed: 0, total: 2 },
		events: [{ phase: 'verifying', at: revision }, { phase: 'indexing', at: '2026-11-08T00:00:02Z', privatePath: '/hidden' },
			{ phase: 'private', at: revision }, { phase: 'uploading', at: '/hidden' }]
	})?.activity, {
		phase: 'downloading', downloadFraction: 0, backlogOriginals: 0, backgroundRequest: 'declined',
		indexed: { photos: 2, videos: 0, files: 4 }, prepared: { completed: 0, total: 2 },
		events: [{ phase: 'indexing', at: '2026-11-08T00:00:02.000Z' }, { phase: 'verifying', at: revision }]
	});
	assert.deepEqual(parse({ phase: 'waiting', downloadFraction: 0.5, backlogOriginals: -1, reason: 'secret',
		prepared: { completed: 3, total: 2 }, backgroundRequest: 'secret' })?.activity, { phase: 'waiting' });
	assert.deepEqual(parse({ phase: 'uploading', cloudPreparationFraction: 0.25, downloadFraction: 0.9 })?.activity,
		{ phase: 'uploading', cloudPreparationFraction: 0.25 });
	assert.deepEqual(parse({ phase: 'uploading', cloudPreparationFraction: -0.1 })?.activity, { phase: 'uploading' });
	assert.equal(parse({ phase: 'unknown' })?.activity, undefined);
	assert.deepEqual(parse({ phase: 'unknown' })?.confirmed, progress.confirmed);
	assert.equal(parse({ phase: 'indexing', events: Array.from({ length: 30 }, () => ({ phase: 'indexing', at: revision })) })?.activity?.events?.length, 12);
	const latestFound = { kind: 'video', capturedAt: '2026-11-08T07:23:41Z' };
	const indexing = { unit: 'assets', completed: 1, total: 6 };
	assert.deepEqual(parse({ phase: 'indexing', indexing, latestFound: { ...latestFound, asset: 'private' },
		events: [{ phase: 'indexing', at: revision, discovered: 1, item: { ...latestFound, path: '/private' } }]
	})?.activity, { phase: 'indexing', indexing, latestFound, events: [{ phase: 'indexing', at: revision, discovered: 1, item: latestFound }] });
	assert.deepEqual(parse({ phase: 'indexing', indexing: { ...indexing, completed: 7 }, latestFound: { kind: 'photo', capturedAt: 'private' } })?.activity,
		{ phase: 'indexing', latestFound: { kind: 'photo' } });
});

test('continued Photos work is separately negotiated and bound to one exact configuration revision', () => {
	const old = { platform: 'ios', filePhotoAutomationVersion: '1.1.0', filePhotoContinuationVersion: '1.0.0' } as const;
	const current = { ...old, filePhotoAutomationVersion: '1.2.0' };
	assert.equal(supportsSoleNativePhotoRun(old), false);
	assert.equal(supportsNativePhotoContinuation(old), false);
	assert.equal(supportsNativePhotoContinuation(current), true);
	assert.equal(supportsNativePhotoContinuation(current, '1.1.0'), false);
	assert.equal(supportsNativePhotoContinuation({ ...current, filePhotoContinuationVersion: '1.1.0' }, '1.1.0'), true);
	assert.equal(supportsNativePhotoContinuation({ ...current, filePhotoContinuationVersion: '2.0.0' }), false);
	const request = { action: 'run-photo-in-background', rootId, configurationId: 'config', deviceId: 'phone',
		configurationRevision: '2026-11-08T00:00:00.000Z' } as const;
	const parse = (patch: object) => parseMobileFolderResult(response({ ...request, roots: iosPhotoRoots, photoContinuationRequested: true,
		photoContinuationStatus: 'active', ...patch }), expected, request)?.photoContinuation;
	assert.deepEqual(parse({}), { requested: true, status: 'active' });
	assert.deepEqual(parse({ photoContinuationRequested: false, photoContinuationStatus: 'waiting' }), { requested: false, status: 'waiting' });
	for (const patch of [{ configurationRevision: 'other' }, { deviceId: 'other' }, { photoContinuationRequested: false },
		{ photoContinuationStatus: 'unknown' }]) assert.throws(() => parse(patch));
});

test('new folder policy client refuses old host before dispatch and negotiates authorized parts on capable host', async t => {
 const { requests, reply } = iosFolderBridge(t);
 const configuration = { ...saved.configuration, sourceKind: 'folder' as const, configurationVersion: 5 as const,
  mode: 'backup' as const, paused: false, propagateDeletes: false, localRootId: rootId, uploadPolicy: { uploadBytesPerHour: 100_000_000 } };
 const authorization = { ...saved, configuration, scope: { ...scope, rootId: saved.id } };
 const source = { ...entry, sha256: null, fingerprint: { algorithm: 'sha256-parts-v1' as const, partSizeBytes: 8 * 1024 * 1024, partCount: 1, sha256: 'a'.repeat(64) } };
 const upload = { source, authorization, uploadId: 'upload', requestId: 'operation', partNumber: 1, offset: 0, length: 3 };
 await assert.rejects(requestMobileFolders('owner', { action: 'upload-part', rootId, upload }, new AbortController().signal), /Update Thingtime/);
 assert.equal(requests.length, 0, 'an unsupported host sees no upload mutation');
 const bridge = (window as any).thingtimeNativeBridge;
 bridge.fileUploadPolicyVersion = '1.1.0'; bridge.fileUploadVersion = '1.6.0';
 const pending = requestMobileFolders('owner', { action: 'upload-part', rootId, upload }, new AbortController().signal);
 await new Promise(resolve => setTimeout(resolve, 0));
 assert.equal((requests[0] as any).action, 'upload-part-authorized');
 assert.deepEqual((requests[0] as any).upload.authorization, authorization);
 reply(requests[0], { roots: [root], rootId, uploadedPart: { uploadId: upload.uploadId, requestId: upload.requestId, partNumber: 1, offset: 0, length: 3, version: source.version, size: 3, sha256: 'b'.repeat(64) } });
 assert.equal((await pending).uploadedPart?.sha256, 'b'.repeat(64));
});

test('authorized folder part interruption remains a retryable inactive wait', () => {
 assert.throws(() => parseMobileFolderResult({ type: 'mobile-files-result', payload: { ...expected, rootId, syncWait: 'inactive' } }, expected,
  { action: 'upload-part', rootId, upload: {} as any }), (error: any) => error.reason === 'inactive');
});
