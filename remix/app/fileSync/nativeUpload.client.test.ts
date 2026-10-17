import {
	supportsNativeFileUploads,
	supportsNativeBackgroundUploads,
	nativeFileUploadStarted,
	nativeFileUploadProgress,
	requestMobileFolders
} from './mobileFolders.client';
import { newFileSyncConfiguration } from './configuration';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
	mobileFolderSource,
	parseMobileFolderResult,
	supportsNativePartUploads,
	type FolderRequest,
	type FolderCapabilities
} from './mobileFolders.client';
import { fingerprintSource } from './contentFingerprint';
import type { SyncEntry } from './reconcile';
const rootId = '11111111-1111-4111-8111-111111111111';
const expected = { requestId: '22222222-2222-4222-8222-222222222222', ownerId: 'owner', origin: 'https://sync.test' };
const host: FolderCapabilities = { platform: 'ios', fileAccessVersion: '1.1.1', fileUploadVersion: '1.0.0' };
async function fixture() {
	const bytes = new Uint8Array([1, 2, 3, 4]);
	const entry: SyncEntry = {
		id: 'id',
		path: 'file.bin',
		version: 'v1',
		size: 4,
		kind: 'file',
		sha256: null,
		fingerprint: await fingerprintSource({ size: 4, check() {}, read: async () => bytes })
	};
	const upload = { source: entry, uploadId: 'upload', requestId: 'operation', partNumber: 1, offset: 0, length: 4 };
	const request: FolderRequest = { action: 'upload-part', rootId, upload };
	const part = { uploadId: 'upload', requestId: 'operation', partNumber: 1, offset: 0, length: 4, version: 'v1', size: 4, sha256: 'a'.repeat(64) };
	const result = { type: 'mobile-files-result', payload: { ...expected, rootId, roots: [{ id: rootId, name: 'Folder' }], uploadedPart: part } };
	return { entry, upload, request, part, result };
}
test('native upload capability is explicit and the descriptor stays bound to the scanned source', async () => {
	const f = await fixture(),
		abort = new AbortController();
	let sent: FolderRequest | undefined;
	assert.equal(supportsNativePartUploads(host), true);
	assert.equal(supportsNativePartUploads({ ...host, fileUploadVersion: undefined }), false);
	assert.equal(supportsNativePartUploads({ ...host, platform: 'android' }), false);
	const native = mobileFolderSource(
		'owner',
		rootId,
		f.entry,
		abort.signal,
		async (_owner, request) => {
			sent = request;
			return { roots: [], uploadedPart: { sha256: 'a'.repeat(64) } };
		},
		host
	);
	f.entry.version = 'changed';
	assert.deepEqual(await native.uploadPart!(f.upload), { sha256: 'a'.repeat(64) });
	assert.equal(sent?.action, 'upload-part');
	assert.equal((sent as Extract<FolderRequest, { action: 'upload-part' }>).upload.source.version, 'v1');
	const legacy = mobileFolderSource('owner', rootId, f.entry, abort.signal, undefined, { ...host, fileUploadVersion: undefined });
	assert.equal(legacy.uploadPart, undefined);
	abort.abort();
	await assert.rejects(native.uploadPart!(f.upload), { name: 'AbortError' });
});
test('native upload receipts reject another operation, part, source or malformed digest', async () => {
	const f = await fixture();
	assert.deepEqual(parseMobileFolderResult(f.result, expected, f.request)?.uploadedPart, { sha256: 'a'.repeat(64) });
	for (const [key, value] of [
		['uploadId', 'other'],
		['requestId', 'other'],
		['partNumber', 2],
		['offset', 1],
		['length', 3],
		['version', 'v2'],
		['size', 5],
		['sha256', 'bad']
	]) {
		const result = structuredClone(f.result);
		(result.payload.uploadedPart as any)[key] = value;
		assert.throws(() => parseMobileFolderResult(result, expected, f.request), /receipt/);
	}
	assert.throws(() => parseMobileFolderResult(f.result, expected, { ...f.request, upload: { ...f.upload, length: 3 } } as FolderRequest), /receipt/);
});

const approval = {
	id: 'connection',
	updatedAt: '2026-10-18T00:00:00Z',
	scope: { origin: expected.origin, ownerId: 'owner', dataPlane: 'home' as const, rootId: 'connection', deviceId: 'device' },
	configuration: {
		...newFileSyncConfiguration({ name: 'Backup', deviceId: 'device', localRootId: rootId, remoteFolderId: 'cloud' }),
		mode: 'backup' as const,
		paused: false
	}
};
test('whole-file capability binds the original operation and reviewed configuration without moving bytes through JS', async () => {
	const f = await fixture(),
		controller = new AbortController();
	const bridge = { ...host, fileUploadVersion: '1.2.0' };
	assert.equal(supportsNativeFileUploads(host), false);
	assert.equal(supportsNativeFileUploads(bridge), true);
	let sent: FolderRequest | undefined;
	const source = mobileFolderSource(
		'owner',
		rootId,
		f.entry,
		controller.signal,
		async (_owner, request) => {
			sent = request;
			return { roots: [], uploadedFile: { fingerprint: f.entry.fingerprint! } };
		},
		bridge
	);
	const request = { uploadId: 'upload', requestId: 'operation', authorization: approval };
	assert.deepEqual(await source.uploadFile!(request), { fingerprint: f.entry.fingerprint });
	assert.equal(sent?.action, 'upload-file');
	assert.deepEqual((sent as Extract<FolderRequest, { action: 'upload-file' }>).upload, { ...request, source: f.entry });
	controller.abort();
	await assert.rejects(source.uploadFile!(request), { name: 'AbortError' });
});
test('whole-file receipts and progress are fenced to identity, canonical boundaries and monotonic progress', async () => {
	const f = await fixture();
	const request: Extract<FolderRequest, { action: 'upload-file' }> = {
		action: 'upload-file',
		rootId,
		upload: { uploadId: 'upload', requestId: 'operation', source: f.entry, authorization: approval }
	};
	const file = { uploadId: 'upload', requestId: 'operation', version: 'v1', size: 4, fingerprint: f.entry.fingerprint };
	const response = { ...f.result, payload: { ...f.result.payload, uploadedFile: file } };
	assert.deepEqual(parseMobileFolderResult(response, expected, request)?.uploadedFile, { fingerprint: file.fingerprint });
	for (const patch of [
		{ uploadId: 'other' },
		{ requestId: 'other' },
		{ version: 'v2' },
		{ size: 5 },
		{ fingerprint: { ...file.fingerprint, sha256: 'a'.repeat(64) } }
	])
		assert.throws(
			() => parseMobileFolderResult({ ...response, payload: { ...response.payload, uploadedFile: { ...file, ...patch } } }, expected, request),
			/receipt/
		);
	const progress = {
		type: 'mobile-files-progress',
		payload: { ...expected, rootId, uploadId: 'upload', operationId: 'operation', version: 'v1', size: 4, received: 4 }
	};
	assert.equal(nativeFileUploadProgress(progress, expected, request, 0), 4);
	assert.equal(nativeFileUploadProgress(progress, expected, request, 4), null);
	for (const patch of [
		{ ownerId: 'other' },
		{ origin: 'https://other.test' },
		{ requestId: 'other' },
		{ rootId: 'other' },
		{ operationId: 'other' },
		{ uploadId: 'other' },
		{ version: 'v2' },
		{ size: 5 },
		{ received: 3 },
		{ received: 5 },
		{ received: NaN }
	])
		assert.equal(nativeFileUploadProgress({ ...progress, payload: { ...progress.payload, ...patch } }, expected, request, 0), null);
});

test('background acknowledgements require the exact upload and explicit compatible capability', async () => {
	const f = await fixture();
	const request: Extract<FolderRequest, { action: 'upload-file' }> = {
		action: 'upload-file',
		rootId,
		upload: { uploadId: 'upload', requestId: 'operation', source: f.entry, authorization: approval }
	};
	const started = {
		type: 'mobile-files-started',
		payload: { ...expected, rootId, uploadId: 'upload', operationId: 'operation', version: 'v1', size: 4, background: true }
	};
	assert.equal(supportsNativeBackgroundUploads({ ...host, fileUploadVersion: '1.2.0' }), false);
	assert.equal(supportsNativeBackgroundUploads({ ...host, fileUploadVersion: '1.3.0' }), true);
	assert.equal(nativeFileUploadStarted(started, expected, request), true);
	assert.equal(nativeFileUploadStarted({ ...started, payload: { ...started.payload, background: false } }, expected, request), false);
	for (const patch of [
		{ ownerId: 'other' },
		{ origin: 'https://other.test' },
		{ requestId: 'other' },
		{ rootId: 'other' },
		{ operationId: 'other' },
		{ uploadId: 'other' },
		{ version: 'v2' },
		{ size: 5 },
		{ background: 1 },
		{ background: undefined }
	])
		assert.equal(nativeFileUploadStarted({ ...started, payload: { ...started.payload, ...patch } }, expected, request), undefined);
});
test('accepted hidden uploads pause the JS deadline, foreground restores it and abort clears authority', async (t) => {
	const f = await fixture();
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'),
		previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
	const target = Object.assign(new EventTarget(), { location: { origin: expected.origin } }) as any;
	const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
	let payload: any;
	const authority: boolean[] = [];
	const requests: any[] = [];
	target.thingtimeNativeBridge = {
		...host,
		isNativeWebView: true,
		fileUploadVersion: '1.3.0',
		postMessage(m: any) {
			requests.push(m.payload);
			if (m.payload.action === 'upload-file') payload = m.payload;
		}
	};
	Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
	Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const dispatch = (background = true) =>
		target.dispatchEvent(
			new CustomEvent('thingtime:native-message', {
				detail: {
					type: 'mobile-files-started',
					payload: { ...payload, uploadId: 'upload', operationId: 'operation', version: 'v1', size: 4, background }
				}
			})
		);
	const visibility = (state: string) => {
		doc.visibilityState = state;
		doc.dispatchEvent(new Event('visibilitychange'));
	};
	try {
		const controller = new AbortController();
		const pending = requestMobileFolders(
			'owner',
			{ action: 'upload-file', rootId, upload: { uploadId: 'upload', requestId: 'operation', source: f.entry, authorization: approval } },
			controller.signal,
			undefined,
			(value) => authority.push(value)
		);
		const rejected = assert.rejects(pending, { name: 'AbortError' });
		dispatch();
		visibility('hidden');
		t.mock.timers.tick(1_800_000);
		assert.deepEqual(authority, [true]);
		assert.equal(requests.length, 1);
		visibility('visible');
		t.mock.timers.tick(899_999);
		dispatch(false);
		assert.deepEqual(authority, [true]);
		controller.abort();
		await rejected;
		assert.deepEqual(authority, [true, false]);
		assert.equal(requests.at(-1).action, 'suspend');
		visibility('hidden');
		dispatch();
		t.mock.timers.tick(1_800_000);
		assert.deepEqual(authority, [true, false]);
		const fallback = new AbortController();
		target.thingtimeNativeBridge.fileUploadVersion = '1.2.0';
		const old = requestMobileFolders(
			'owner',
			{ action: 'upload-file', rootId, upload: { uploadId: 'upload', requestId: 'operation', source: f.entry, authorization: approval } },
			fallback.signal,
			undefined,
			(value) => authority.push(value)
		);
		const timedOut = assert.rejects(old, /timed out/);
		dispatch();
		t.mock.timers.tick(900_000);
		await timedOut;
		assert.deepEqual(authority, [true, false, false]);
	} finally {
		t.mock.timers.reset();
		if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
		else delete (globalThis as any).window;
		if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
		else delete (globalThis as any).document;
	}
});
