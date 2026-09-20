import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	LOCAL_ATTACHMENT_STORAGE_PATH,
	createLocalAttachmentStorage,
	fetchStoredObject,
	handleLocalAttachmentStorageRequest,
	isLocalAttachmentStorageUrl,
	resolveLocalAttachmentStorageConfig
} from './localAttachmentStorage';

const sha256Base64 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('base64');
const ORIGIN = 'http://local-attachments.invalid';
// A real PNG signature so content detection has something to sniff.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 0x1f, 0x15, 0xc4, 0x89]);

const withStorage = async (run: (storage: ReturnType<typeof createLocalAttachmentStorage>, directory: string) => Promise<void>, clock?: { now: number }) => {
	const directory = mkdtempSync(path.join(tmpdir(), 'tt-local-attachments-'));
	try {
		await run(createLocalAttachmentStorage({ directory }, clock ? () => clock.now : undefined), directory);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
};

const putPart = (storage: ReturnType<typeof createLocalAttachmentStorage>, signed: { url: string; headers: Record<string, string> }, bytes: Uint8Array, extraHeaders: Record<string, string> = {}) =>
	storage.handleRequest(new Request(`${ORIGIN}${signed.url}`, { method: 'PUT', headers: { ...signed.headers, 'content-length': String(bytes.byteLength), ...extraHeaders }, body: bytes }));

test('the stand-in only activates through its env variable and never on Vercel', () => {
	assert.equal(resolveLocalAttachmentStorageConfig({}), null);
	assert.equal(resolveLocalAttachmentStorageConfig({ THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: '   ' }), null);
	assert.deepEqual(resolveLocalAttachmentStorageConfig({ THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: '.local-attachments' }), { directory: path.resolve('.local-attachments') });
	assert.throws(() => resolveLocalAttachmentStorageConfig({ THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: '/tmp/x', VERCEL: '1' }), /must not run on Vercel/);
	assert.throws(() => resolveLocalAttachmentStorageConfig({ THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: '/tmp/x', VERCEL_ENV: 'preview' }), /must not run on Vercel/);
});

test('an unconfigured route answers 404 for every operation and URL detection is exact', async () => {
	const response = await handleLocalAttachmentStorageRequest(new Request(`${ORIGIN}${LOCAL_ATTACHMENT_STORAGE_PATH}?op=get`), null);
	assert.equal(response.status, 404);
	assert.deepEqual(await response.json(), { ok: false, error: 'Local attachment storage is not configured' });
	assert.equal(isLocalAttachmentStorageUrl(`${LOCAL_ATTACHMENT_STORAGE_PATH}?op=get&sig=x`), true);
	assert.equal(isLocalAttachmentStorageUrl('https://bucket.s3.amazonaws.com/objects/x?X-Amz-Signature=1'), false);
	assert.equal(isLocalAttachmentStorageUrl('/api/v1/attachments/content?id=x'), false);
});

test('multipart upload, completion, head, detection, download and delete round-trip through the filesystem', async () => {
	await withStorage(async (storage, directory) => {
		const objectKey = 'objects/att_round_trip';
		const { uploadId } = await storage.createMultipartUpload({ objectKey, attachmentId: 'att_round_trip' });
		const first = PNG;
		const second = new Uint8Array(3000).fill(7);
		const parts = [first, second];
		for (const [index, bytes] of parts.entries()) {
			const checksum = sha256Base64(bytes);
			const signed = await storage.signUploadPart({ objectKey, uploadId, partNumber: index + 1, checksumSha256: checksum, contentLength: bytes.byteLength });
			assert.ok(isLocalAttachmentStorageUrl(signed.url));
			assert.deepEqual(signed.headers, { 'x-amz-checksum-sha256': checksum });
			const response = await putPart(storage, signed, bytes);
			assert.equal(response.status, 200, await response.text());
			assert.match(response.headers.get('ETag') || '', /^"[0-9a-f]{32}"$/);
		}
		const listed = await storage.listParts({ objectKey, uploadId });
		assert.deepEqual(
			listed.map((part) => ({ partNumber: part.partNumber, sizeBytes: part.sizeBytes, checksumSha256: part.checksumSha256 })),
			parts.map((bytes, index) => ({ partNumber: index + 1, sizeBytes: bytes.byteLength, checksumSha256: sha256Base64(bytes) }))
		);
		const { versionId } = await storage.completeMultipartUpload({ objectKey, uploadId, parts: listed });
		assert.match(versionId, /^v[0-9a-z]+-[0-9a-f]{16}$/);
		// the upload directory is gone, the object lives under objects/<id>
		assert.throws(() => statSync(path.join(directory, 'uploads', uploadId)));
		assert.equal(statSync(path.join(directory, 'objects', 'att_round_trip', `${versionId}.bin`)).size, first.byteLength + second.byteLength);
		const head = await storage.headObject({ objectKey, versionId });
		assert.equal(head.sizeBytes, first.byteLength + second.byteLength);
		assert.equal(head.attachmentId, 'att_round_trip');
		assert.equal(head.versionId, versionId);
		assert.equal(head.checksumType, 'COMPOSITE');
		assert.match(head.checksumSha256, /^[A-Za-z0-9+/]+=*-2$/);
		assert.deepEqual(await storage.headObject({ objectKey }), head, 'latest version resolves without an explicit id');
		assert.equal(await storage.detectContentType({ objectKey, versionId }), 'image/png');
		await storage.markObjectReady({ objectKey, versionId });

		const signed = await storage.signDownload({ objectKey, versionId, contentDisposition: 'inline; filename="a.png"', contentType: 'image/png' });
		const full = await fetchStoredObject(signed.url);
		assert.equal(full.status, 404, 'fetchStoredObject uses process.env, which does not configure the stand-in here');
		const served = await storage.handleRequest(new Request(`${ORIGIN}${signed.url}`));
		assert.equal(served.status, 200);
		assert.equal(served.headers.get('Content-Type'), 'image/png');
		assert.equal(served.headers.get('Content-Disposition'), 'inline; filename="a.png"');
		assert.equal(served.headers.get('Content-Length'), String(head.sizeBytes));
		assert.equal(served.headers.get('Accept-Ranges'), 'bytes');
		const bytes = new Uint8Array(await served.arrayBuffer());
		assert.deepEqual(bytes.subarray(0, first.byteLength), first);
		assert.equal(bytes.byteLength, head.sizeBytes);
		const ranged = await storage.handleRequest(new Request(`${ORIGIN}${signed.url}`, { headers: { Range: 'bytes=2-5' } }));
		assert.equal(ranged.status, 206);
		assert.equal(ranged.headers.get('Content-Range'), `bytes 2-5/${head.sizeBytes}`);
		assert.deepEqual(new Uint8Array(await ranged.arrayBuffer()), first.subarray(2, 6));
		const tail = await storage.handleRequest(new Request(`${ORIGIN}${signed.url}`, { headers: { Range: 'bytes=-3' } }));
		assert.equal(tail.status, 206);
		assert.deepEqual(new Uint8Array(await tail.arrayBuffer()), second.subarray(second.byteLength - 3));
		const beyond = await storage.handleRequest(new Request(`${ORIGIN}${signed.url}`, { headers: { Range: 'bytes=999999-' } }));
		assert.equal(beyond.status, 416);
		const headOnly = await storage.handleRequest(new Request(`${ORIGIN}${signed.url}`, { method: 'HEAD' }));
		assert.equal(headOnly.status, 200);
		assert.equal(headOnly.body, null);

		await storage.deleteObject({ objectKey, versionId });
		await assert.rejects(storage.headObject({ objectKey, versionId }), (error: unknown) => storage.isNotFound(error));
		await storage.deleteObject({ objectKey, versionId }); // idempotent like S3
		assert.equal((await storage.handleRequest(new Request(`${ORIGIN}${signed.url}`))).status, 404);
	});
});

test('parts must match their signed length and checksum, and completion rejects tampered part lists', async () => {
	await withStorage(async (storage) => {
		const objectKey = 'objects/att_integrity';
		const { uploadId } = await storage.createMultipartUpload({ objectKey, attachmentId: 'att_integrity' });
		const bytes = new Uint8Array(64).fill(1);
		const signed = await storage.signUploadPart({ objectKey, uploadId, partNumber: 1, checksumSha256: sha256Base64(bytes), contentLength: 64 });
		// wrong bytes for the signed checksum
		const mismatched = await putPart(storage, signed, new Uint8Array(64).fill(2));
		assert.equal(mismatched.status, 400);
		assert.equal((await storage.listParts({ objectKey, uploadId })).length, 0);
		// too many bytes
		const overrun = await storage.handleRequest(new Request(`${ORIGIN}${signed.url}`, { method: 'PUT', headers: signed.headers, body: new Uint8Array(65).fill(1) }));
		assert.equal(overrun.status, 400);
		// a checksum header that disagrees with the signed one is refused before reading
		const badHeader = await putPart(storage, signed, bytes, { 'x-amz-checksum-sha256': sha256Base64(new Uint8Array(1)) });
		assert.equal(badHeader.status, 400);
		// wrong method on a part URL
		assert.equal((await storage.handleRequest(new Request(`${ORIGIN}${signed.url}`))).status, 405);
		// the genuine bytes land
		assert.equal((await putPart(storage, signed, bytes)).status, 200);
		const [part] = await storage.listParts({ objectKey, uploadId });
		await assert.rejects(storage.completeMultipartUpload({ objectKey, uploadId, parts: [{ ...part, etag: '"deadbeef"' }] }), /could not be found or did not match/);
		await assert.rejects(storage.completeMultipartUpload({ objectKey, uploadId, parts: [{ ...part, partNumber: 2 }] }), /could not be found or did not match/);
		await assert.rejects(storage.completeMultipartUpload({ objectKey: 'objects/att_other', uploadId, parts: [part] }), /different object/);
		const { versionId } = await storage.completeMultipartUpload({ objectKey, uploadId, parts: [part] });
		assert.equal((await storage.headObject({ objectKey, versionId })).sizeBytes, 64);
	});
});

test('signatures expire, cover every parameter, and unknown or hostile keys never touch the filesystem', async () => {
	const clock = { now: 1_800_000_000_000 };
	await withStorage(async (storage, directory) => {
		const objectKey = 'objects/att_signed';
		const { uploadId } = await storage.createMultipartUpload({ objectKey, attachmentId: 'att_signed' });
		const bytes = new Uint8Array(8).fill(3);
		const signed = await storage.signUploadPart({ objectKey, uploadId, partNumber: 1, checksumSha256: sha256Base64(bytes), contentLength: 8 });
		assert.equal((await putPart(storage, signed, bytes)).status, 200);
		const { versionId } = await storage.completeMultipartUpload({ objectKey, uploadId, parts: await storage.listParts({ objectKey, uploadId }) });
		const download = await storage.signDownload({ objectKey, versionId, contentDisposition: 'attachment', contentType: 'application/octet-stream' });
		const tampered = new URL(`${ORIGIN}${download.url}`);
		tampered.searchParams.set('type', Buffer.from('text/html').toString('base64url'));
		assert.equal((await storage.handleRequest(new Request(tampered))).status, 403);
		const otherVersion = new URL(`${ORIGIN}${download.url}`);
		otherVersion.searchParams.set('version', 'v1-0123456789abcdef');
		assert.equal((await storage.handleRequest(new Request(otherVersion))).status, 403);
		const noSignature = new URL(`${ORIGIN}${download.url}`);
		noSignature.searchParams.delete('sig');
		assert.equal((await storage.handleRequest(new Request(noSignature))).status, 403);
		assert.equal((await storage.handleRequest(new Request(`${ORIGIN}${download.url}`))).status, 200);
		clock.now += 11 * 60 * 1000;
		assert.equal((await storage.handleRequest(new Request(`${ORIGIN}${download.url}`))).status, 403, 'expired');
		assert.equal((await storage.handleRequest(new Request(`${ORIGIN}${LOCAL_ATTACHMENT_STORAGE_PATH}?op=nope&exp=99999999999`))).status, 403);

		for (const key of ['objects/../secret', 'objects/', 'other/att', 'objects/a/b', '']) {
			await assert.rejects(storage.headObject({ objectKey: key }), /Invalid local object key/);
			await assert.rejects(storage.signDownload({ objectKey: key, versionId: 'v1-0123456789abcdef', contentDisposition: 'attachment', contentType: 'x' }), /Invalid local object key/);
		}
		await assert.rejects(storage.headObject({ objectKey: 'objects/absent' }), (error: unknown) => storage.isNotFound(error));
		await assert.rejects(storage.deleteObject({ objectKey, versionId: '../../escape' }), /not found/);
		await assert.rejects(storage.listParts({ objectKey, uploadId: '../uploads' }), (error: unknown) => storage.isNoSuchUpload(error));
		await assert.rejects(storage.abortMultipartUpload({ objectKey, uploadId: '00000000-0000-0000-0000-000000000000' }), (error: unknown) => storage.isNoSuchUpload(error));
		assert.equal(statSync(path.join(directory, '.signing-secret')).mode & 0o777, 0o600);
	}, clock);
});

test('copyUploadPart clones exact byte ranges of a stored version into a new upload', async () => {
	await withStorage(async (storage) => {
		const source = 'objects/att_source';
		const { uploadId: sourceUpload } = await storage.createMultipartUpload({ objectKey: source, attachmentId: 'att_source' });
		const bytes = Uint8Array.from({ length: 1000 }, (_, index) => index % 251);
		const signed = await storage.signUploadPart({ objectKey: source, uploadId: sourceUpload, partNumber: 1, checksumSha256: sha256Base64(bytes), contentLength: bytes.byteLength });
		assert.equal((await putPart(storage, signed, bytes)).status, 200);
		const { versionId } = await storage.completeMultipartUpload({ objectKey: source, uploadId: sourceUpload, parts: await storage.listParts({ objectKey: source, uploadId: sourceUpload }) });

		const destination = 'objects/att_copy';
		const { uploadId } = await storage.createMultipartUpload({ objectKey: destination, attachmentId: 'att_copy' });
		await storage.copyUploadPart({ objectKey: destination, uploadId, partNumber: 1, sourceObjectKey: source, sourceVersionId: versionId, range: { start: 0, end: 599 } });
		await storage.copyUploadPart({ objectKey: destination, uploadId, partNumber: 2, sourceObjectKey: source, sourceVersionId: versionId, range: { start: 600, end: 999 } });
		const parts = await storage.listParts({ objectKey: destination, uploadId });
		assert.deepEqual(parts.map((part) => part.sizeBytes), [600, 400]);
		assert.equal(parts[0].checksumSha256, sha256Base64(bytes.subarray(0, 600)));
		const copied = await storage.completeMultipartUpload({ objectKey: destination, uploadId, parts });
		const download = await storage.signDownload({ objectKey: destination, versionId: copied.versionId, contentDisposition: 'attachment', contentType: 'application/octet-stream' });
		assert.deepEqual(new Uint8Array(await (await storage.handleRequest(new Request(`${ORIGIN}${download.url}`))).arrayBuffer()), bytes);
		// completion consumed the upload, exactly like S3
		await assert.rejects(storage.listParts({ objectKey: destination, uploadId }), (error: unknown) => storage.isNoSuchUpload(error));
		const { uploadId: abandoned } = await storage.createMultipartUpload({ objectKey: 'objects/att_abandoned', attachmentId: 'att_abandoned' });
		await assert.rejects(storage.copyUploadPart({ objectKey: 'objects/att_abandoned', uploadId: abandoned, partNumber: 1, sourceObjectKey: source, sourceVersionId: versionId, range: { start: 900, end: 1000 } }), /Invalid copy range/);
		await storage.abortMultipartUpload({ objectKey: 'objects/att_abandoned', uploadId: abandoned });
		await assert.rejects(storage.listParts({ objectKey: 'objects/att_abandoned', uploadId: abandoned }), (error: unknown) => storage.isNoSuchUpload(error));
	});
});

// The stand-in's signed URLs are RELATIVE (`/api/v1/attachments/local-object?...`)
// so the browser PUTs to the same origin without CORS. Node's global fetch()
// cannot parse a relative URL, so every server-side reader of a signed object
// URL must go through fetchStoredObject(). Missing one degrades silently on a
// developer machine (an empty social card, an unreadable recording), which is
// exactly the kind of gap a scan catches and review does not.
test('every server-side reader of a signed object URL goes through fetchStoredObject', () => {
	const remixRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
	// Every server-only tree, not just app/api: route loaders/actions read signed
	// URLs too (content?cache=bytes). Client components are excluded on purpose —
	// a browser resolves a relative URL that Node's fetch() cannot.
	const roots = ['app/api', 'app/routes/api', 'server'].map((relative) => path.join(remixRoot, relative));
	// `deps.fetch(x.url)` is an injected seam whose default is fetchStoredObject.
	const bareFetch = /(?<![\w.])fetch\(\s*[A-Za-z_$][\w$]*\.url\b/;
	const offenders: string[] = [];
	for (const root of roots) {
		for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
			if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue;
			const file = path.join(entry.parentPath ?? entry.path, entry.name);
			if (bareFetch.test(readFileSync(file, 'utf8'))) offenders.push(path.relative(remixRoot, file));
		}
	}
	assert.deepEqual(offenders, [], `use fetchStoredObject() for signed object URLs: ${offenders.join(', ')}`);
});
