import test from 'node:test';
import assert from 'node:assert/strict';
import {
	parseMobileFolderResult,
	mobileFolderSource,
	requestMobileFolders,
	supportsMobileFolders,
	supportsMobileSyncConditions,
	supportsMobileFolderPublication,
	supportsNativePathInspection,
	type FolderRequest
} from './mobileFolders.client';
import { nativeBridgeMessageEvent } from '../utils/nativeBridge';
const rootId = '00000000-0000-4000-8000-000000000001';
const expected = { requestId: 'request', ownerId: 'owner', origin: 'https://native.test' };
const root = { id: rootId, name: 'Selected folder' };
const entry = { path: 'file', id: 'inode', version: '1', kind: 'file' as const, size: 3, sha256: 'a'.repeat(64) };
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
