import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileTypeFromBuffer } from 'file-type';

import { PrivateS3ConfigError } from './config';
import type { AttachmentObjectHead, AttachmentS3, AttachmentUploadedPart } from './privateS3';

// A laptop stand-in for the private S3 bucket.
//
// Production attachments live in a private, versioned S3 bucket reached through
// Vercel's OIDC role, so a checkout without that role cannot upload, preview or
// download a single byte. Setting THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR swaps
// the AttachmentS3 implementation for this module: objects, versions and
// multipart uploads live under one directory, and the "presigned URLs" become
// short-lived HMAC-signed links to /api/v1/attachments/local-object, which the
// same module serves. Every other layer (quota, moderation, ACL gates, copy,
// archive) is untouched — they only ever see the AttachmentS3 interface.
//
// It refuses to start on Vercel: this is a development convenience, never a
// storage tier.

export const LOCAL_ATTACHMENT_STORAGE_PATH = '/api/v1/attachments/local-object';
export const LOCAL_ATTACHMENT_STORAGE_DIR_ENV = 'THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR';
// Optional absolute origin for the signed URLs (for example http://127.0.0.1:19921).
// Browsers and server-side readers are happy with the default root-relative form;
// native uploaders (the Watch inbox), curl-driven smoke scripts and other API
// clients need an absolute URL exactly like a real presigned S3 URL.
export const LOCAL_ATTACHMENT_STORAGE_ORIGIN_ENV = 'THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN';

const PART_URL_TTL_SECONDS = 10 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;
const PREFIX_BYTES = 8 * 1024;
// Mirrors the bucket's key grammar (attachments.ts mints `objects/<id>`).
const OBJECT_KEY = /^objects\/[A-Za-z0-9_-]{1,200}$/;
const UPLOAD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION_ID = /^v[0-9a-z]{1,16}-[0-9a-f]{16}$/;
const PART_NUMBER_MAX = 10_000;

export type LocalAttachmentStorageConfig = { directory: string; origin?: string };

export class LocalAttachmentStorageError extends Error {
	readonly $metadata: { httpStatusCode: number };
	constructor(
		readonly code: 'NotFound' | 'NoSuchUpload' | 'InvalidRequest' | 'IntegrityFailure' | 'Forbidden',
		message: string,
		status: number
	) {
		super(message);
		this.name = code;
		this.$metadata = { httpStatusCode: status };
	}
}

// A misconfigured stand-in is a configuration failure, not a transient outage:
// the attachment service reports it as non-retryable `storage_unconfigured`
// exactly like a missing bucket role, instead of telling clients to retry.
export class LocalAttachmentStorageConfigError extends PrivateS3ConfigError {
	constructor(message: string) {
		super();
		this.message = message;
		this.name = 'LocalAttachmentStorageConfigError';
	}
}

const expandHome = (value: string): string => (value === '~' ? homedir() : value.startsWith('~/') ? path.join(homedir(), value.slice(2)) : value);

// Fail closed anywhere that looks like a deployment. Vercel always sets VERCEL
// (and VERCEL_ENV / VERCEL_TARGET_ENV in builds and functions).
export const resolveLocalAttachmentStorageConfig = (env: NodeJS.ProcessEnv = process.env): LocalAttachmentStorageConfig | null => {
	const raw = String(env[LOCAL_ATTACHMENT_STORAGE_DIR_ENV] || '').trim();
	if (!raw) return null;
	if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_TARGET_ENV) {
		throw new LocalAttachmentStorageConfigError('Local attachment storage is a local-development stand-in and must not run on Vercel');
	}
	// Relative paths resolve against the process working directory (the remix
	// directory for the dev server); `~` is expanded because dotenv never does.
	const directory = path.resolve(expandHome(raw));
	const originRaw = String(env[LOCAL_ATTACHMENT_STORAGE_ORIGIN_ENV] || '').trim();
	if (!originRaw) return { directory };
	let origin: URL;
	try {
		origin = new URL(originRaw);
	} catch {
		throw new LocalAttachmentStorageConfigError(`${LOCAL_ATTACHMENT_STORAGE_ORIGIN_ENV} must be an absolute http(s) origin`);
	}
	if ((origin.protocol !== 'http:' && origin.protocol !== 'https:') || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
		throw new LocalAttachmentStorageConfigError(`${LOCAL_ATTACHMENT_STORAGE_ORIGIN_ENV} must be an absolute http(s) origin without a path, query or credentials`);
	}
	return { directory, origin: origin.origin };
};

const notFound = (what: string) => new LocalAttachmentStorageError('NotFound', `${what} not found`, 404);
const noSuchUpload = () => new LocalAttachmentStorageError('NoSuchUpload', 'The specified upload does not exist', 404);
const invalid = (message: string) => new LocalAttachmentStorageError('InvalidRequest', message, 400);

const assertObjectKey = (objectKey: string): string => {
	if (!OBJECT_KEY.test(objectKey)) throw invalid('Invalid local object key');
	return objectKey.slice('objects/'.length);
};
const assertUploadId = (uploadId: string): string => {
	if (!UPLOAD_ID.test(uploadId)) throw noSuchUpload();
	return uploadId;
};
const assertVersionId = (versionId: string): string => {
	if (!VERSION_ID.test(versionId)) throw notFound('Object version');
	return versionId;
};
const assertPartNumber = (value: number): number => {
	if (!Number.isInteger(value) || value < 1 || value > PART_NUMBER_MAX) throw invalid('Invalid part number');
	return value;
};

const newVersionId = () => `v${Date.now().toString(36)}-${randomBytes(8).toString('hex')}`;
const sha256Base64 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('base64');
const etagFor = (checksumSha256: string) => `"${createHash('md5').update(checksumSha256).digest('hex')}"`;
const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const isEnoent = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';

type UploadRecord = { objectKey: string; attachmentId: string; createdAt: string };
type PartRecord = AttachmentUploadedPart;
type ObjectRecord = {
	versionId: string;
	sizeBytes: number;
	checksumSha256: string;
	checksumType: 'COMPOSITE';
	attachmentId: string;
	tags: Record<string, string>;
	createdAt: string;
};

const readJson = async <T>(file: string): Promise<T | null> => {
	try {
		return JSON.parse(await readFile(file, 'utf8')) as T;
	} catch (error) {
		if (isEnoent(error)) return null;
		throw error;
	}
};

const writeJsonAtomic = async (file: string, value: unknown) => {
	const temporary = `${file}.${randomUUID()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, 1)}\n`, { mode: 0o600 });
	await rename(temporary, file);
};

const encodeParam = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const decodeParam = (value: string) => Buffer.from(value, 'base64url').toString('utf8');

const isAbortLike = (error: unknown): boolean => {
	const value = error as { name?: unknown; code?: unknown; message?: unknown } | null;
	return value?.name === 'AbortError' || value?.code === 'ABORT_ERR' || value?.code === 'ECONNRESET' || value?.message === 'aborted';
};

const abortError = (signal: AbortSignal): unknown => signal.reason ?? new DOMException('This operation was aborted', 'AbortError');

const notConfiguredResponse = () =>
	new Response(JSON.stringify({ ok: false, error: 'Local attachment storage is not configured' }), {
		status: 404,
		headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0' }
	});

export const createLocalAttachmentStorage = (config: LocalAttachmentStorageConfig, now: () => number = Date.now) => {
	const root = config.directory;
	const urlPrefix = `${config.origin || ''}${LOCAL_ATTACHMENT_STORAGE_PATH}`;
	const uploadsRoot = path.join(root, 'uploads');
	const objectsRoot = path.join(root, 'objects');
	let secretPromise: Promise<Buffer> | null = null;

	// One signing secret per storage directory (0600) so signed URLs survive dev
	// server restarts but never leave the machine. A failed read/create is not
	// memoised: the next call retries instead of poisoning every later signature.
	const secret = () => {
		if (secretPromise) return secretPromise;
		const attempt = (async () => {
			await mkdir(root, { recursive: true });
			const file = path.join(root, '.signing-secret');
			try {
				const existing = (await readFile(file, 'utf8')).trim();
				if (/^[0-9a-f]{64}$/.test(existing)) return Buffer.from(existing, 'hex');
			} catch (error) {
				if (!isEnoent(error)) throw error;
			}
			const fresh = randomBytes(32).toString('hex');
			await writeFile(file, `${fresh}\n`, { mode: 0o600 });
			return Buffer.from(fresh, 'hex');
		})();
		secretPromise = attempt;
		attempt.catch(() => {
			if (secretPromise === attempt) secretPromise = null;
		});
		return attempt;
	};

	const sign = async (fields: readonly string[]) => createHmac('sha256', await secret()).update(fields.join('\n')).digest('hex');
	const verify = async (fields: readonly string[], signature: string | null) => {
		if (!signature || !/^[0-9a-f]{64}$/.test(signature)) return false;
		const expected = Buffer.from(await sign(fields), 'hex');
		const presented = Buffer.from(signature, 'hex');
		return expected.length === presented.length && timingSafeEqual(expected, presented);
	};

	const uploadDir = (uploadId: string) => path.join(uploadsRoot, uploadId);
	const partFile = (uploadId: string, partNumber: number) => path.join(uploadDir(uploadId), 'parts', `${partNumber}.bin`);
	const partMeta = (uploadId: string, partNumber: number) => path.join(uploadDir(uploadId), 'parts', `${partNumber}.json`);
	const objectDir = (id: string) => path.join(objectsRoot, id);
	const objectFile = (id: string, versionId: string) => path.join(objectDir(id), `${versionId}.bin`);
	const objectMeta = (id: string, versionId: string) => path.join(objectDir(id), `${versionId}.json`);

	const readUpload = async (uploadId: string): Promise<UploadRecord> => {
		const record = await readJson<UploadRecord>(path.join(uploadDir(assertUploadId(uploadId)), 'upload.json'));
		if (!record) throw noSuchUpload();
		return record;
	};

	const readObject = async (objectKey: string, versionId?: string): Promise<ObjectRecord> => {
		const id = assertObjectKey(objectKey);
		if (versionId) {
			const record = await readJson<ObjectRecord>(objectMeta(id, assertVersionId(versionId)));
			if (!record) throw notFound('Object');
			return record;
		}
		let names: string[];
		try {
			names = await readdir(objectDir(id));
		} catch (error) {
			if (isEnoent(error)) throw notFound('Object');
			throw error;
		}
		const records = (await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => readJson<ObjectRecord>(path.join(objectDir(id), name))))).filter(
			(record): record is ObjectRecord => !!record
		);
		if (!records.length) throw notFound('Object');
		records.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
		return records[records.length - 1];
	};

	// Store one part from any byte source, hashing as it lands. The declared
	// length is a hard cap: a body that overruns or falls short is rejected, so a
	// stale reservation can never be completed with different bytes.
	const storePart = async (uploadId: string, partNumber: number, source: AsyncIterable<Uint8Array>, expected: { checksumSha256?: string; contentLength?: number }) => {
		await readUpload(uploadId);
		assertPartNumber(partNumber);
		const directory = path.join(uploadDir(uploadId), 'parts');
		await mkdir(directory, { recursive: true });
		const temporary = `${partFile(uploadId, partNumber)}.${randomUUID()}.tmp`;
		const hash = createHash('sha256');
		let size = 0;
		const cap = expected.contentLength;
		try {
			await pipeline(
				Readable.from(
					(async function* () {
						for await (const chunk of source) {
							const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike);
							size += bytes.byteLength;
							if (cap !== undefined && size > cap) throw invalid('Upload part exceeds its declared length');
							hash.update(bytes);
							yield bytes;
						}
					})()
				),
				createWriteStream(temporary, { mode: 0o600 })
			);
			if (cap !== undefined && size !== cap) throw invalid('Upload part is shorter than its declared length');
			const checksumSha256 = hash.digest('base64');
			if (expected.checksumSha256 && expected.checksumSha256 !== checksumSha256) {
				throw new LocalAttachmentStorageError('IntegrityFailure', 'The SHA-256 you specified did not match the calculated checksum', 400);
			}
			const record: PartRecord = { partNumber, etag: etagFor(checksumSha256), sizeBytes: size, checksumSha256 };
			await rename(temporary, partFile(uploadId, partNumber));
			await writeJsonAtomic(partMeta(uploadId, partNumber), record);
			return record;
		} finally {
			await rm(temporary, { force: true });
		}
	};

	const storage: AttachmentS3 = {
		async createMultipartUpload({ objectKey, attachmentId }) {
			assertObjectKey(objectKey);
			if (!attachmentId || /[\p{Cc}]/u.test(attachmentId)) throw invalid('Invalid attachment id');
			const uploadId = randomUUID();
			await mkdir(path.join(uploadDir(uploadId), 'parts'), { recursive: true });
			await writeJsonAtomic(path.join(uploadDir(uploadId), 'upload.json'), { objectKey, attachmentId, createdAt: new Date(now()).toISOString() } satisfies UploadRecord);
			return { uploadId };
		},

		async signUploadPart({ objectKey, uploadId, partNumber, checksumSha256, contentLength }) {
			assertObjectKey(objectKey);
			await readUpload(uploadId);
			assertPartNumber(partNumber);
			if (!Number.isSafeInteger(contentLength) || contentLength < 0) throw invalid('Invalid part length');
			const exp = String(Math.floor(now() / 1000) + PART_URL_TTL_SECONDS);
			const fields = ['part', objectKey, uploadId, String(partNumber), checksumSha256, String(contentLength), exp];
			const params = new URLSearchParams({ op: 'part', key: objectKey, upload: uploadId, part: String(partNumber), checksum: checksumSha256, length: String(contentLength), exp, sig: await sign(fields) });
			return { url: `${urlPrefix}?${params}`, expiresAt: expiresAt(PART_URL_TTL_SECONDS), headers: { 'x-amz-checksum-sha256': checksumSha256 } };
		},

		async listParts({ objectKey, uploadId }) {
			assertObjectKey(objectKey);
			await readUpload(uploadId);
			let names: string[] = [];
			try {
				names = await readdir(path.join(uploadDir(uploadId), 'parts'));
			} catch (error) {
				if (!isEnoent(error)) throw error;
			}
			const parts = (await Promise.all(names.filter((name) => name.endsWith('.json')).map((name) => readJson<PartRecord>(path.join(uploadDir(uploadId), 'parts', name))))).filter(
				(part): part is PartRecord => !!part
			);
			return parts.sort((left, right) => left.partNumber - right.partNumber);
		},

		async completeMultipartUpload({ objectKey, uploadId, parts }) {
			const id = assertObjectKey(objectKey);
			const upload = await readUpload(uploadId);
			if (upload.objectKey !== objectKey) throw invalid('Upload belongs to a different object');
			const stored = await storage.listParts({ objectKey, uploadId });
			const byNumber = new Map(stored.map((part) => [part.partNumber, part]));
			const ordered = [...parts].sort((left, right) => left.partNumber - right.partNumber);
			if (!ordered.length) throw invalid('Multipart upload has no parts');
			const digests = createHash('sha256');
			let sizeBytes = 0;
			for (const [index, part] of ordered.entries()) {
				const known = byNumber.get(part.partNumber);
				if (part.partNumber !== index + 1 || !known || known.etag !== part.etag || known.checksumSha256 !== part.checksumSha256) {
					throw new LocalAttachmentStorageError('IntegrityFailure', 'One or more of the specified parts could not be found or did not match', 400);
				}
				digests.update(Buffer.from(known.checksumSha256, 'base64'));
				sizeBytes += known.sizeBytes;
			}
			const versionId = newVersionId();
			await mkdir(objectDir(id), { recursive: true });
			// A concurrent complete of the same upload removes the part files under
			// us; S3 reports that as NoSuchUpload, which the service already settles.
			const raced = async (error: unknown) => {
				if (isEnoent(error) && !(await readJson<UploadRecord>(path.join(uploadDir(uploadId), 'upload.json')))) return noSuchUpload();
				return error;
			};
			if (ordered.length === 1) {
				// One part IS the object: move it instead of copying it a second time.
				try {
					await rename(partFile(uploadId, ordered[0].partNumber), objectFile(id, versionId));
				} catch (error) {
					throw await raced(error);
				}
			} else {
				const temporary = `${objectFile(id, versionId)}.tmp`;
				try {
					// One pipeline over every part in order: backpressure, error propagation
					// and listener cleanup in one place (a pipeline per part with end:false
					// leaves its listeners on the shared sink).
					await pipeline(
						(async function* () {
							for (const part of ordered) yield* createReadStream(partFile(uploadId, part.partNumber));
						})(),
						createWriteStream(temporary, { mode: 0o600 })
					);
					await rename(temporary, objectFile(id, versionId));
				} catch (error) {
					await rm(temporary, { force: true });
					throw await raced(error);
				}
			}
			const record: ObjectRecord = {
				versionId,
				sizeBytes,
				checksumSha256: `${digests.digest('base64')}-${ordered.length}`,
				checksumType: 'COMPOSITE',
				attachmentId: upload.attachmentId,
				tags: { 'thingtime-state': 'pending' },
				createdAt: new Date(now()).toISOString()
			};
			await writeJsonAtomic(objectMeta(id, versionId), record);
			await rm(uploadDir(uploadId), { recursive: true, force: true });
			return { versionId };
		},

		async headObject({ objectKey, versionId }) {
			const record = await readObject(objectKey, versionId);
			const head: AttachmentObjectHead = {
				sizeBytes: record.sizeBytes,
				checksumSha256: record.checksumSha256,
				checksumType: record.checksumType,
				attachmentId: record.attachmentId,
				versionId: record.versionId
			};
			return head;
		},

		async detectContentType({ objectKey, versionId }) {
			const id = assertObjectKey(objectKey);
			const record = await readObject(objectKey, versionId);
			const handle = await open(objectFile(id, record.versionId), 'r');
			try {
				const buffer = Buffer.alloc(Math.min(PREFIX_BYTES, record.sizeBytes));
				const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0);
				if (!bytesRead) return undefined;
				return (await fileTypeFromBuffer(buffer.subarray(0, bytesRead)))?.mime;
			} finally {
				await handle.close();
			}
		},

		async markObjectReady({ objectKey, versionId }) {
			const id = assertObjectKey(objectKey);
			const record = await readObject(objectKey, versionId);
			await writeJsonAtomic(objectMeta(id, record.versionId), { ...record, tags: { ...record.tags, 'thingtime-state': 'ready' } });
		},

		async abortMultipartUpload({ objectKey, uploadId }) {
			assertObjectKey(objectKey);
			await readUpload(uploadId);
			await rm(uploadDir(uploadId), { recursive: true, force: true });
		},

		// S3 semantics: deleting an absent version is a success — including a
		// version id this stand-in never minted (rows left over from a bucket).
		async deleteObject({ objectKey, versionId }) {
			const id = assertObjectKey(objectKey);
			if (!VERSION_ID.test(versionId)) return;
			await rm(objectFile(id, versionId), { force: true });
			await rm(objectMeta(id, versionId), { force: true });
			try {
				if (!(await readdir(objectDir(id))).length) await rm(objectDir(id), { recursive: true, force: true });
			} catch (error) {
				if (!isEnoent(error)) throw error;
			}
		},

		async copyUploadPart({ objectKey, uploadId, partNumber, sourceObjectKey, sourceVersionId, range, signal }) {
			assertObjectKey(objectKey);
			const sourceId = assertObjectKey(sourceObjectKey);
			const source = await readObject(sourceObjectKey, sourceVersionId);
			signal?.throwIfAborted();
			const start = range ? range.start : 0;
			const end = range ? range.end : source.sizeBytes - 1;
			if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= source.sizeBytes) throw invalid('Invalid copy range');
			await storePart(uploadId, partNumber, createReadStream(objectFile(sourceId, source.versionId), { start, end, signal }), { contentLength: end - start + 1 });
		},

		// Presigning never touches storage (S3 semantics): an unknown version id
		// yields a URL whose GET answers 404, not a signing failure.
		async signDownload({ objectKey, versionId, contentDisposition, contentType }) {
			assertObjectKey(objectKey);
			if (typeof versionId !== 'string' || !versionId || /[\p{Cc}]/u.test(versionId)) throw invalid('Invalid object version');
			const exp = String(Math.floor(now() / 1000) + DOWNLOAD_URL_TTL_SECONDS);
			const disposition = encodeParam(contentDisposition);
			const type = encodeParam(contentType);
			const fields = ['get', objectKey, versionId, disposition, type, exp];
			const params = new URLSearchParams({ op: 'get', key: objectKey, version: versionId, disposition, type, exp, sig: await sign(fields) });
			return { url: `${urlPrefix}?${params}`, expiresAt: expiresAt(DOWNLOAD_URL_TTL_SECONDS) };
		},

		isNoSuchUpload(error) {
			return (error as { code?: string } | null)?.code === 'NoSuchUpload';
		},

		isNotFound(error) {
			const code = (error as { code?: string } | null)?.code;
			return code === 'NotFound' || (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode === 404;
		}
	};

	const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
		new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', ...headers } });

	// Serves the signed URLs above. Reached through the dev-only route AND
	// directly (no network) by server-side readers via fetchStoredObject().
	const handleRequest = async (request: Request): Promise<Response> => {
		// fetch() semantics for in-process readers: an already-aborted signal
		// rejects instead of serving bytes nobody is waiting for.
		if (request.signal?.aborted) throw abortError(request.signal);
		const url = new URL(request.url);
		const op = url.searchParams.get('op');
		const exp = url.searchParams.get('exp') || '';
		const signature = url.searchParams.get('sig');
		if (!/^\d{1,12}$/.test(exp) || Number(exp) < Math.floor(now() / 1000)) return jsonResponse(403, { ok: false, error: 'Request has expired' });
		try {
			if (op === 'part') {
				const key = url.searchParams.get('key') || '';
				const upload = url.searchParams.get('upload') || '';
				const part = url.searchParams.get('part') || '';
				const checksum = url.searchParams.get('checksum') || '';
				const length = url.searchParams.get('length') || '';
				if (!(await verify(['part', key, upload, part, checksum, length, exp], signature))) return jsonResponse(403, { ok: false, error: 'Signature does not match' });
				if (request.method !== 'PUT') return jsonResponse(405, { ok: false, error: 'Method not allowed' }, { Allow: 'PUT' });
				const header = request.headers.get('x-amz-checksum-sha256');
				if (header !== null && header !== checksum) return jsonResponse(400, { ok: false, error: 'Checksum header does not match the signed request' });
				const declared = request.headers.get('content-length');
				if (declared !== null && declared !== length) return jsonResponse(400, { ok: false, error: 'Content-Length does not match the signed request' });
				if (!request.body) return jsonResponse(400, { ok: false, error: 'Missing upload body' });
				const record = await storePart(upload, Number(part), request.body as unknown as AsyncIterable<Uint8Array>, { checksumSha256: checksum, contentLength: Number(length) });
				return new Response(null, { status: 200, headers: { ETag: record.etag, 'x-amz-checksum-sha256': record.checksumSha256, 'Cache-Control': 'private, no-store, max-age=0' } });
			}
			if (op === 'get') {
				const key = url.searchParams.get('key') || '';
				const version = url.searchParams.get('version') || '';
				const disposition = url.searchParams.get('disposition') || '';
				const type = url.searchParams.get('type') || '';
				if (!(await verify(['get', key, version, disposition, type, exp], signature))) return jsonResponse(403, { ok: false, error: 'Signature does not match' });
				if (request.method !== 'GET' && request.method !== 'HEAD') return jsonResponse(405, { ok: false, error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
				const id = assertObjectKey(key);
				const record = await readObject(key, version);
				const file = objectFile(id, record.versionId);
				await stat(file).catch((error) => {
					throw isEnoent(error) ? notFound('Object') : error;
				});
				// Exact versions are immutable, so validators are cheap and exact: the
				// browser revalidates a preview instead of refetching every byte.
				const headers: Record<string, string> = {
					'Content-Type': decodeParam(type) || 'application/octet-stream',
					'Content-Disposition': decodeParam(disposition) || 'attachment',
					'Cache-Control': 'private, max-age=0, must-revalidate',
					ETag: etagFor(record.checksumSha256),
					'Last-Modified': new Date(record.createdAt).toUTCString(),
					'Accept-Ranges': 'bytes',
					'X-Content-Type-Options': 'nosniff',
					'Referrer-Policy': 'no-referrer',
					'x-amz-version-id': record.versionId
				};
				if (request.headers.get('if-none-match') === headers.ETag) return new Response(null, { status: 304, headers: { ETag: headers.ETag, 'Cache-Control': headers['Cache-Control'] } });
				let start = 0;
				let end = record.sizeBytes - 1;
				let status = 200;
				const rangeHeader = request.headers.get('range');
				if (rangeHeader) {
					const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
					if (!match || (match[1] === '' && match[2] === '')) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${record.sizeBytes}` } });
					if (match[1] === '') {
						start = Math.max(0, record.sizeBytes - Number(match[2]));
					} else {
						start = Number(match[1]);
						if (match[2] !== '') end = Math.min(end, Number(match[2]));
					}
					if (start > end || start >= record.sizeBytes) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${record.sizeBytes}` } });
					status = 206;
					headers['Content-Range'] = `bytes ${start}-${end}/${record.sizeBytes}`;
				}
				headers['Content-Length'] = String(record.sizeBytes ? end - start + 1 : 0);
				if (request.method === 'HEAD' || !record.sizeBytes) return new Response(null, { status, headers });
				// The caller's signal (a reader timeout, a cancelled Lopu turn, a
				// disconnected client) destroys the file stream instead of being ignored.
				return new Response(Readable.toWeb(createReadStream(file, { start, end, signal: request.signal })) as ReadableStream<Uint8Array>, { status, headers });
			}
			// Unknown operations read exactly like a bad signature: nothing about the
			// stand-in's surface is discoverable without a server-minted URL.
			return jsonResponse(403, { ok: false, error: 'Signature does not match' });
		} catch (error) {
			if (error instanceof LocalAttachmentStorageError) return jsonResponse(error.$metadata.httpStatusCode, { ok: false, error: error.message });
			// A client that cancels its part PUT mid-body is a routine 400, never an
			// unhandled 500 that lands in the error log.
			if (request.signal?.aborted) throw abortError(request.signal);
			if (isAbortLike(error)) return jsonResponse(400, { ok: false, error: 'Upload body ended before its declared length' });
			throw error;
		}
	};

	return { ...storage, handleRequest, directory: root };
};

export type LocalAttachmentStorage = ReturnType<typeof createLocalAttachmentStorage>;

let cached: { directory: string; origin: string | undefined; value: LocalAttachmentStorage } | undefined;

export const getLocalAttachmentStorage = (config: LocalAttachmentStorageConfig): LocalAttachmentStorage => {
	if (cached?.directory === config.directory && cached.origin === config.origin) return cached.value;
	const value = createLocalAttachmentStorage(config);
	cached = { directory: config.directory, origin: config.origin, value };
	return value;
};

// The root-relative form the stand-in mints by default, or the absolute form
// minted under THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN. Real S3 URLs never
// carry this path.
const localStorageQuery = (url: string): string | null => {
	if (url.startsWith(`${LOCAL_ATTACHMENT_STORAGE_PATH}?`)) return url.slice(LOCAL_ATTACHMENT_STORAGE_PATH.length);
	if (!/^https?:\/\//i.test(url)) return null;
	try {
		const parsed = new URL(url);
		return parsed.pathname === LOCAL_ATTACHMENT_STORAGE_PATH && parsed.search ? parsed.search : null;
	} catch {
		return null;
	}
};

export const isLocalAttachmentStorageUrl = (url: string): boolean => localStorageQuery(url) !== null;

// Serve a signed local URL for a first-party request, or 404 when the
// stand-in is not configured (the route never exists in deployments).
export const handleLocalAttachmentStorageRequest = async (request: Request, config: LocalAttachmentStorageConfig | null = resolveLocalAttachmentStorageConfig()): Promise<Response> => {
	if (!config) return notConfiguredResponse();
	return getLocalAttachmentStorage(config).handleRequest(request);
};

// Server-side readers (image previews, byte proxying, archives, moderation)
// resolve signed URLs through this helper so a local URL is served in-process
// while real S3 URLs still go over the network. Abort signals and timeouts
// behave like fetch(): an aborted signal rejects, a later abort ends the body.
export const fetchStoredObject = (url: string, init: { method?: string; headers?: HeadersInit; signal?: AbortSignal | null; redirect?: RequestRedirect } = {}): Promise<Response> => {
	const query = localStorageQuery(url);
	if (query !== null) {
		if (init.signal?.aborted) return Promise.reject(abortError(init.signal));
		return handleLocalAttachmentStorageRequest(
			new Request(`http://local-attachments.invalid${LOCAL_ATTACHMENT_STORAGE_PATH}${query}`, { method: init.method || 'GET', headers: init.headers, signal: init.signal ?? undefined })
		);
	}
	return fetch(url, { method: init.method, headers: init.headers, signal: init.signal ?? undefined, redirect: init.redirect });
};
