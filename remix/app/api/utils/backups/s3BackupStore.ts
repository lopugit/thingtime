import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { BACKUP_CHUNK_BYTES } from '../../../backups/manifest';
import { timelineScopeKey } from '../../../timeline/contract';
import { assertBackupObjectKey } from './backupObjectKey';
import type { BackupAccess, BackupObjectStore } from './portableBackup';

export type S3BackupDestination = {
	endpoint: string;
	region: string;
	bucket: string;
	prefix: string;
	/** Required for AWS; null explicitly selects a provider without this header. */
	expectedBucketOwner: string | null;
};
export type S3BackupRuntime = BackupAccess & {
	/** Explicit owning-app/vault provider. Never use the SDK default credential chain. */
	credentials: NonNullable<S3ClientConfig['credentials']>;
	/** Only disposable loopback protocol fixtures may opt into cleartext HTTP. */
	allowLoopbackHttp?: boolean;
};
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
class BackupStoreError extends Error {}
const fail = (message: string): never => {
	throw new BackupStoreError(message);
};

export function validateS3BackupDestination(input: S3BackupDestination, allowLoopbackHttp = false): S3BackupDestination {
	if (!input || Object.keys(input).sort().join(',') !== 'bucket,endpoint,expectedBucketOwner,prefix,region') fail('Invalid backup destination');
	let endpoint: URL;
	try {
		endpoint = new URL(input.endpoint);
	} catch {
		fail('Invalid backup endpoint');
	}
	if (
		endpoint.origin !== input.endpoint ||
		endpoint.username ||
		endpoint.password ||
		(endpoint.protocol !== 'https:' && !(allowLoopbackHttp && endpoint.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(endpoint.hostname)))
	)
		fail('Backup endpoint must use HTTPS');
	if (/(^|\.)amazonaws\.com(\.cn)?$/.test(endpoint.hostname) && input.expectedBucketOwner === null)
		fail('AWS backup destinations require the expected bucket owner');
	if (
		typeof input.bucket !== 'string' ||
		!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.bucket) ||
		typeof input.region !== 'string' ||
		!/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.region) ||
		typeof input.prefix !== 'string' ||
		input.prefix.length > 256 ||
		!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(input.prefix) ||
		(input.expectedBucketOwner !== null && (typeof input.expectedBucketOwner !== 'string' || !/^[0-9]{12}$/.test(input.expectedBucketOwner)))
	)
		fail('Invalid backup destination');
	return { ...input };
}

/** Independent private S3 destination using the exact portable v1 format.
 * No bucket creation, ACL changes, deletes, live attachment configuration, or
 * alternate endpoints. The owning app supplies quota/consent and revocation.
 * A provider must support atomic If-None-Match writes and strong read-after-write.
 * IAM must enforce this namespace; hashing a scope is not an access grant. */
export function openS3BackupStore(input: S3BackupDestination, runtime: S3BackupRuntime): BackupObjectStore & { close(): void } {
	const config = validateS3BackupDestination(input, runtime.allowLoopbackHttp);
	if (!runtime.credentials) fail('Explicit backup credentials are required');
	const scope = timelineScopeKey(runtime.scope);
	const root = `${config.prefix}/scopes/${hash(scope)}/v1/`;
	// The AWS SDK annotates credential objects with telemetry. Detach each result
	// so a vault-owned credential or later strict handoff is never mutated.
	const suppliedCredentials = runtime.credentials;
	const credentials = async () => {
		const value = typeof suppliedCredentials === 'function' ? await suppliedCredentials() : suppliedCredentials;
		// Vault resolution may await user presence or refresh; reauthorize before
		// the SDK can transmit anything using the resulting identity.
		await check();
		if (value.expiration && (!Number.isFinite(value.expiration.getTime()) || value.expiration.getTime() <= Date.now()))
			fail('Backup credentials expired');
		return { ...value };
	};
	const client = new S3Client({
		endpoint: config.endpoint,
		region: config.region,
		credentials,
		forcePathStyle: true,
		followRegionRedirects: false,
		maxAttempts: 3,
		requestChecksumCalculation: 'WHEN_REQUIRED',
		responseChecksumValidation: 'WHEN_REQUIRED'
	});
	let closed = false;
	const check = async () => {
		if (closed) fail('Backup destination is closed');
		runtime.signal?.throwIfAborted();
		if (timelineScopeKey(runtime.scope) !== scope) fail('Backup account or origin changed');
		await runtime.authorize();
		runtime.signal?.throwIfAborted();
		if (closed || timelineScopeKey(runtime.scope) !== scope) fail('Backup account or origin changed');
	};
	const object = (key: string) => {
		assertBackupObjectKey(key);
		return { Bucket: config.bucket, Key: root + key, ExpectedBucketOwner: config.expectedBucketOwner ?? undefined };
	};
	const signal = () => AbortSignal.any([...(runtime.signal ? [runtime.signal] : []), AbortSignal.timeout(60_000)]);
	const verifyChunk = (key: string, data: Uint8Array) => {
		if (key.startsWith('chunks/') && key !== `chunks/${hash(data)}`) fail('Backup chunk checksum mismatch');
	};
	const read: BackupObjectStore['read'] = async (key, maxBytes) => {
		const target = object(key);
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > BACKUP_CHUNK_BYTES) fail('Invalid backup read bound');
		await check();
		const abortSignal = signal();
		let body: Readable | undefined;
		const cancel = () => body?.destroy(Error('Backup read cancelled'));
		try {
			let response;
			try {
				response = await client.send(new GetObjectCommand(target), { abortSignal });
			} catch (error: any) {
				await check();
				if (error?.name === 'NoSuchKey' && error?.$metadata?.httpStatusCode === 404) return null;
				// Do not print provider bodies, credential errors, endpoint URLs or keys.
				throw Error('Backup object read failed');
			}
			body = response.Body as Readable;
			abortSignal.addEventListener('abort', cancel, { once: true });
			abortSignal.throwIfAborted();
			const length = response.ContentLength;
			if (!body || typeof body.destroy !== 'function' || !Number.isSafeInteger(length) || length < 0 || length > maxBytes || response.ContentEncoding)
				fail('Invalid backup object response');
			const data = Buffer.alloc(length);
			let offset = 0;
			for await (const chunk of body) {
				await check();
				abortSignal.throwIfAborted();
				if (!(chunk instanceof Uint8Array) || offset + chunk.byteLength > length) fail('Backup object exceeds its bound');
				data.set(chunk, offset);
				offset += chunk.byteLength;
			}
			if (offset !== length) fail('Backup object was truncated');
			if (response.ChecksumSHA256 && response.ChecksumSHA256 !== createHash('sha256').update(data).digest('base64'))
				fail('Backup object checksum mismatch');
			verifyChunk(key, data);
			await check();
			return data;
		} catch (error) {
			if (error instanceof BackupStoreError) throw error;
			throw Error('Backup object read failed');
		} finally {
			abortSignal.removeEventListener('abort', cancel);
			body?.destroy();
		}
	};
	return {
		read,
		close() {
			closed = true;
			client.destroy();
		},
		async put(key, bytes) {
			const target = object(key);
			if (!(bytes instanceof Uint8Array) || bytes.byteLength > BACKUP_CHUNK_BYTES) fail('Invalid backup object size');
			const data = Buffer.from(bytes);
			verifyChunk(key, data);
			for (let attempt = 0; attempt < 3; attempt++) {
				await check();
				try {
					await client.send(
						new PutObjectCommand({
							...target,
							Body: data,
							ContentLength: data.length,
							IfNoneMatch: '*',
							ContentType: 'application/octet-stream',
							CacheControl: 'private, no-store',
							ChecksumSHA256: createHash('sha256').update(data).digest('base64'),
							ServerSideEncryption: 'AES256'
						}),
						{ abortSignal: signal() }
					);
				} catch (error: any) {
					await check();
					if (error?.$metadata?.httpStatusCode === 409 && attempt < 2) continue;
					if (error?.$metadata?.httpStatusCode !== 412) throw Error('Backup object write failed; retry the same snapshot');
				}
				// A duplicate is success only for identical retained bytes. A lost reply
				// can be retried under the same key without overwriting a newer object.
				const saved = await read(key, BACKUP_CHUNK_BYTES);
				if (!saved || !Buffer.from(saved).equals(data)) fail('Immutable backup object changed');
				await check();
				return;
			}
			fail('Backup object write failed; retry the same snapshot');
		}
	};
}
