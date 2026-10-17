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
