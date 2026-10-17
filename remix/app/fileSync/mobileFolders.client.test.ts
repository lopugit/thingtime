import test from 'node:test';
import assert from 'node:assert/strict';
import {
	parseMobileFolderResult,
	mobileFolderSource,
	requestMobileFolders,
	supportsMobileFolders,
	supportsMobileSyncConditions,
	supportsMobileFolderPublication
} from './mobileFolders.client';
import { nativeBridgeMessageEvent } from '../utils/nativeBridge';
const rootId = '00000000-0000-4000-8000-000000000001';
const expected = { requestId: 'request', ownerId: 'owner', origin: 'https://native.test' };
const root = { id: rootId, name: 'Selected folder' };
const entry = { path: 'file', id: 'inode', version: '1', kind: 'file' as const, size: 3, sha256: 'a'.repeat(64) };
const response = (extra = {}) => ({ type: 'mobile-files-result', payload: { ...expected, roots: [root], ...extra } });
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
	const size = 8 * 1024 * 1024 + 17, bytes = new Uint8Array(size).fill(23), controller = new AbortController();
	const scanned = { ...entry, size }, calls: string[] = [];
	const request = async (_owner: string, input: any) => {
		calls.push(input.action);
		if (input.action === 'read') return { roots: [root], chunk: { version: '1', size, offset: 0, data: 'Fw==' } };
		return parseMobileFolderResult(response({ rootId, path: entry.path, chunk: { version: '1', size, offset: input.offset, length: input.length, bytes: bytes.slice(input.offset, input.offset + input.length) } }), expected, input)!;
	};
	const source = mobileFolderSource('owner', rootId, scanned, controller.signal, request, { platform: 'macos', fileAccessVersion: '1.2.0' });
	await source.check();
	assert.deepEqual(await source.read(0, size), bytes);
	assert.deepEqual(calls, ['read', 'read-range']);
	const input = { action: 'read-range' as const, rootId, path: entry.path, version: '1', offset: 0, length: 3 };
	for (const patch of [{ bytes: [1, 2, 3] }, { bytes: new Uint8Array(2) }, { offset: 1 }, { version: '2' }, { size: 2 }, { length: 4 }]) {
		assert.throws(() => parseMobileFolderResult(response({ rootId, path: entry.path, chunk: { version: '1', size: 3, offset: 0, length: 3, bytes: new Uint8Array(3), ...patch } }), expected, input));
	}
	controller.abort(); await assert.rejects(source.read(0, 3));
	await assert.rejects(source.read(0, 32 * 1024 * 1024 + 1));
});
