import { fileRetentionEventId } from './fileVersions';
import { CLOUD_FOLDER_REQUIREMENTS, parseCloudFolder, parseCloudFolderCreate, cloudFolderSyncEntry } from './cloudFolder';
import {
	CLOUD_FILE_RETENTION_REQUIREMENTS,
	parseCloudFileRetention,
	CLOUD_FILE_REQUIREMENTS,
	cloudFileSyncEntry,
	parseCloudFile,
	type CloudFile
} from './cloudFile';
import { cloudWriteCommit, parseCloudWrite, isCloudFolderWrite, type CloudWrite } from './cloudWrite';
import { contentPartPlan, equalContentFingerprints, type FingerprintSource } from './contentFingerprint';
import { sameSyncContent, sameSyncScope, type SyncScope } from './reconcile';
import type { SyncReceipt, SyncReceiptLookup } from './execute';
import { EXPECTED_ACTOR_HEADER } from '../api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../utils/dataPlane';

export const CLOUD_TRANSFER_REQUIREMENTS = {
	...CLOUD_FILE_REQUIREMENTS,
	'api.attachment-uploads': '1.5.0',
	'api.attachment-upload-parts': '1.1.0',
	'api.attachment-upload-complete': '1.4.0',
	'api.actions-run': '1.7.0'
} as const;
export type CloudTransportRuntime = {
	currentScope(): SyncScope;
	origin(): string;
	fetch: typeof fetch;
	/** Live native/configuration approval can wait for consent or cooldown. Run
	 * it before starting the network deadline, then recheck cancellation/scope. */
	authorizeMutation?(signal?: AbortSignal): Promise<void>;
	requireCapability(feature: string, minimumVersion: string): Promise<void>;
};
const hash = async (bytes: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = (bytes: Uint8Array) => [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const identifier = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id);

/** Authenticated JSON stays on one origin with server-enforced expected actor
 * and data-plane headers. Signed part requests carry no account credentials. */
export function cloudRequests(runtime: CloudTransportRuntime, scope: SyncScope, signal?: AbortSignal) {
	const check = () => {
		signal?.throwIfAborted();
		if (runtime.origin() !== scope.origin || !sameSyncScope(scope, runtime.currentScope())) throw Error('Sync context changed.');
	};
	const json = async (path: string, body?: unknown, missing = false): Promise<any> => {
		check();
		const url = new URL(path, scope.origin),
			bodyText = body === undefined ? undefined : JSON.stringify(body);
		if (body !== undefined) await runtime.authorizeMutation?.(signal);
		check();
		const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000);
		const response = await runtime.fetch(url, {
			method: body === undefined ? 'GET' : 'POST',
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			signal: requestSignal,
			headers: {
				Accept: 'application/json',
				[EXPECTED_ACTOR_HEADER]: scope.ownerId,
				[EXPECTED_DATA_PLANE_HEADER]: scope.dataPlane,
				...(body === undefined ? {} : { 'Content-Type': 'application/json' })
			},
			...(bodyText === undefined ? {} : { body: bodyText })
		});
		check();
		if (missing && response.status === 404) {
			await response.body?.cancel();
			return null;
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw Error(`Cloud sync request failed (${response.status}); retain this run for retry or reconciliation.`);
		}
		if (!response.body) throw Error('Missing cloud sync response.');
		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let total = 0;
		try {
			for (;;) {
				const next = await reader.read();
				check();
				if (next.done) break;
				total += next.value.length;
				if (total > 64 * 1024) throw Error('Cloud sync response is too large.');
				chunks.push(next.value);
			}
		} finally {
			await reader.cancel();
			reader.releaseLock();
		}
		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.length;
		}
		const value = JSON.parse(new TextDecoder().decode(bytes));
		check();
		if (value?.ok !== true) throw Error('Invalid cloud sync response.');
		return value;
	};
	const negotiate = async (requirements: Record<string, string>) => {
		check();
		for (const [feature, version] of Object.entries(requirements)) {
			await runtime.requireCapability(feature, version);
			check();
		}
	};
	return { check, json, negotiate };
}
function cloudFileTransport(runtime: CloudTransportRuntime, saved: CloudWrite, signal: AbortSignal | undefined, retained: boolean) {
	const write = parseCloudWrite(saved),
		scope = write.scope,
		m = write.operation.mutation;
	if (isCloudFolderWrite(write) || (m.kind === 'copy' ? m.from !== 'local' : m.side !== 'remote'))
		throw Error('Use the matching cloud folder or download transport.');
	if (retained && (!write.before || m.kind !== 'copy' || m.from !== 'local' || m.source.kind !== 'file' || m.expectedTarget?.kind !== 'file'))
		throw Error('Retaining conflicts requires two existing file versions.');
	const { check, json, negotiate: negotiateRequirements } = cloudRequests(runtime, scope, signal);
	const negotiate = () => negotiateRequirements({ ...CLOUD_TRANSFER_REQUIREMENTS, ...(retained ? CLOUD_FILE_RETENTION_REQUIREMENTS : {}) });
	const fileId = write.before?.id ?? write.operation.id;
	const receipt = (value: unknown): SyncReceipt => {
		const file = parseCloudFile(value);
		if (
			file.id !== fileId ||
			file.name !== m.path.split('/').at(-1) ||
			file.folderId !== write.folderId ||
			file.trashed !== (m.kind === 'trash') ||
			file.revision === write.before?.revision ||
			!sameSyncContent({ ...cloudFileSyncEntry({ ...file, trashed: false }, m.path) }, m.kind === 'copy' ? m.source : m.expected)
		)
			throw Error('Cloud receipt does not match the requested file.');
		return { operationId: write.operation.id, scope: { ...scope }, entry: file.trashed ? null : cloudFileSyncEntry(file, m.path) };
	};
	const commit = async (content: CloudFile['content'], replayOnly = false) => {
		const command = cloudWriteCommit(write, content);
		const result = await json('/api/v1/files', retained ? parseCloudFileRetention({ ...command, kind: 'retained-version' }) : command);
		if (retained && result.retained !== true) throw Error('The server did not confirm version retention.');
		if (replayOnly && result.replayed !== true) throw Error('Cloud operation receipt was not an exact replay.');
		const file = parseCloudFile(result.file);
		if (retained && file.revision !== (await fileRetentionEventId(scope.ownerId, fileId, write.operation.id)))
			throw Error('Retention receipt changed operation identity.');
		if (file.content.attachmentId !== content.attachmentId || file.content.version !== content.version)
			throw Error('Cloud commit changed the attachment identity.');
		return receipt(file);
	};
	const lookup = async (): Promise<SyncReceiptLookup> => {
		await negotiate();
		const result = await json(
			'/api/v1/files?' + new URLSearchParams({ id: fileId, operationId: write.operation.id, ...(retained ? { kind: 'retained-version' } : {}) })
		);
		if (result.receipt === null) return { status: 'missing' };
		const file = parseCloudFile(result.receipt?.file);
		receipt(file);
		// Re-submit the original metadata with the retained receipt's byte identity.
		// The server checks its immutable request hash before touching storage. This
		// rejects reuse with a different expected revision/folder/name, and never
		// uploads again after an accepted-write/lost-response interruption.
		return { status: 'complete', receipt: await commit(file.content, true) };
	};
	return {
		lookup,
		async read() {
			await negotiate();
			const result = await json('/api/v1/files?' + new URLSearchParams({ id: fileId }), undefined, true);
			if (!result) return null;
			const file = parseCloudFile(result.file);
			if (file.id !== fileId || file.name !== m.path.split('/').at(-1) || file.folderId !== write.folderId)
				throw Error('Cloud path changed; reconcile this run.');
			return file.trashed ? null : cloudFileSyncEntry(file, m.path);
		},
		async apply(source?: FingerprintSource, progress?: (bytes: number, total: number) => void): Promise<SyncReceipt> {
			const previous = await lookup();
			if (previous.status === 'complete') return previous.receipt;
			if (m.kind === 'trash') return commit(write.before!.content);
			if (!source || source.size !== m.source.size) throw Error('Pinned source bytes are unavailable.');
			const plan = contentPartPlan(source.size);
			if (plan.partSizeBytes > 32 * 1024 * 1024) throw Error('This file requires native streaming upload support.');
			const sourceCheck = async () => {
				check();
				await source.check();
				check();
				if (source.size !== m.source.size) throw Error('Source file changed.');
			};
			await sourceCheck();
			const started = await json('/api/v1/attachments/uploads', {
				requestId: write.operation.id,
				filename: m.path.split('/').at(-1),
				contentType: 'application/octet-stream',
				sizeBytes: source.size,
				purpose: 'file'
			});
			const upload = started.upload;
			if (!identifier(upload?.id) || upload.partSizeBytes !== plan.partSizeBytes || upload.partCount !== plan.partCount)
				throw Error('Invalid cloud upload plan.');
			if (upload.state !== 'ready') {
				const digests = new Uint8Array(plan.partCount * 32);
				for (let i = 0; i < plan.partCount; i++) {
					await sourceCheck();
					const offset = i * plan.partSizeBytes,
						length = Math.min(plan.partSizeBytes, source.size - offset);
					const read = await source.read(offset, length, signal);
					await sourceCheck();
					if (!(read instanceof Uint8Array) || read.length !== length) throw Error('Source read was incomplete.');
					const bytes = new Uint8Array(read);
					const digest = await hash(bytes);
					digests.set(digest, i * 32);
					await sourceCheck();
					const checksum = base64(digest),
						partNumber = i + 1;
					const signed = await json('/api/v1/attachments/uploads/parts', { uploadId: upload.id, parts: [{ partNumber, checksumSha256: checksum }] });
					const part = signed.parts?.[0];
					if (
						!Array.isArray(signed.parts) ||
						signed.parts.length !== 1 ||
						part.partNumber !== partNumber ||
						typeof part.url !== 'string' ||
						!part.headers ||
						Object.keys(part.headers).some((key) => key.toLowerCase() !== 'x-amz-checksum-sha256') ||
						part.headers['x-amz-checksum-sha256'] !== checksum
					)
						throw Error('Invalid signed cloud upload part.');
					const target = new URL(part.url, scope.origin);
					if (target.username || target.password || (target.protocol !== 'https:' && target.origin !== scope.origin))
						throw Error('Invalid cloud upload destination.');
					await sourceCheck();
					await runtime.authorizeMutation?.(signal);
					await sourceCheck();
					const response = await runtime.fetch(target, {
						method: 'PUT',
						credentials: 'omit',
						redirect: 'error',
						referrerPolicy: 'no-referrer',
						headers: part.headers,
						body: bytes,
						signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000)
					});
					await response.body?.cancel();
					await sourceCheck();
					if (!response.ok) throw Error(`Cloud upload part failed (${response.status}); retain this run.`);
					progress?.(offset + length, source.size);
				}
				if (!equalContentFingerprints({ algorithm: 'sha256-parts-v1', ...plan, sha256: hex(await hash(digests)) }, m.source.fingerprint!))
					throw Error('Source bytes do not match the planned fingerprint.');
				await sourceCheck();
				await json('/api/v1/attachments/uploads/complete', { uploadId: upload.id });
			}
			const fingerprint = await json('/api/v1/attachments/content?' + new URLSearchParams({ id: upload.id, fingerprint: '1' }));
			const content = { attachmentId: upload.id, version: fingerprint.version, size: fingerprint.size, fingerprint: fingerprint.fingerprint };
			const candidate = parseCloudFile({
				id: fileId,
				revision: 'pending',
				name: m.path.split('/').at(-1),
				folderId: write.folderId,
				trashed: false,
				content
			});
			if (fingerprint.id !== upload.id || !sameSyncContent(cloudFileSyncEntry(candidate, m.path), m.source))
				throw Error('Uploaded bytes do not match the planned fingerprint.');
			await sourceCheck();
			await source.verify?.();
			await sourceCheck();
			return commit(content);
		}
	};
}

export const createCloudFileTransport = (runtime: CloudTransportRuntime, saved: CloudWrite, signal?: AbortSignal) =>
	cloudFileTransport(runtime, saved, signal, false);
export const createCloudRetentionTransport = (runtime: CloudTransportRuntime, saved: CloudWrite, signal?: AbortSignal) =>
	cloudFileTransport(runtime, saved, signal, true);

export function createCloudFolderTransport(runtime: CloudTransportRuntime, saved: CloudWrite, signal?: AbortSignal) {
	const write = parseCloudWrite(saved),
		scope = write.scope,
		m = write.operation.mutation;
	if (!isCloudFolderWrite(write) || m.kind !== 'copy' || m.from !== 'local') throw Error('A cloud folder creation operation is required.');
	const input = parseCloudFolderCreate({
		kind: 'folder',
		id: write.operation.id,
		operationId: write.operation.id,
		name: m.path.split('/').at(-1),
		folderId: write.folderId
	});
	const { json, negotiate } = cloudRequests(runtime, scope, signal);
	const ready = () => negotiate({ ...CLOUD_FOLDER_REQUIREMENTS, 'api.actions-run': '1.7.0', 'api.mongodb-endpoint': '1.1.0' });
	const receipt = (value: unknown): SyncReceipt => {
		const folder = parseCloudFolder(value);
		if (folder.id !== input.id || folder.name !== input.name || folder.folderId !== input.folderId)
			throw Error('Folder receipt changed destination.');
		return { operationId: input.operationId, scope: { ...scope }, entry: cloudFolderSyncEntry(folder, m.path) };
	};
	const lookup = async (): Promise<SyncReceiptLookup> => {
		await ready();
		const result = await json('/api/v1/files?' + new URLSearchParams({ folderId: input.id, operationId: input.operationId }));
		if (result.receipt === null) return { status: 'missing' };
		receipt(result.receipt);
		const replay = await json('/api/v1/files', input);
		if (replay.replayed !== true) throw Error('Folder receipt was not an exact replay.');
		return { status: 'complete', receipt: receipt(replay.folder) };
	};
	return {
		lookup,
		async read() {
			await ready();
			const result = await json('/api/v1/files?' + new URLSearchParams({ folderId: input.id }), undefined, true);
			return result ? receipt(result.folder).entry : null;
		},
		async apply(): Promise<SyncReceipt> {
			const prior = await lookup();
			if (prior.status === 'complete') return prior.receipt;
			return receipt((await json('/api/v1/files', input)).folder);
		}
	};
}
