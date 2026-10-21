import { folderBatches } from './folderBatches';
import { createHash } from 'node:crypto';
import {
	parseUploadBatchDescriptor,
	uploadBatchCanonicalBytes,
	UPLOAD_BATCH_METADATA_BYTES,
	UPLOAD_BATCH_RESPONSE_BYTES,
	type UploadBatchDescriptor,
	type UploadBatchFailure,
	type UploadBatchRequest,
	type UploadBatchObserveRequest
} from '../../../fileSync/uploadBatch';
import { equalContentFingerprints, validContentFingerprint } from '../../../fileSync/contentFingerprint';
import { cloudWriteCommit } from '../../../fileSync/cloudWrite';
import {
	attachmentIdForRequest,
	startAttachmentUpload,
	signAttachmentUploadParts,
	completeAttachmentUpload,
	getAttachmentFingerprint
} from '../attachments/attachments';
import { attachmentStore } from '../attachments/attachmentStore';
import { parseBatchObserveRequest, observeBatchPaths } from './batchObserve';
import { cloudFiles } from './files';
import { chargeBatch, admitBatchProvider } from './batchAdmission';

import { authorizeBatch, BatchAuthorityChanged } from './batchAuthority';

type MutationBatchRequest = Exclude<UploadBatchRequest, UploadBatchObserveRequest>;
export { authorizeBatch, BatchAuthorityChanged } from './batchAuthority';
class BatchObservationConflict extends Error {}
const authorityStatus = (error: unknown) => (error instanceof BatchAuthorityChanged ? 403 : 503);
const obj = (v: any): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const closed = (v: any, keys: string[]) => obj(v) && Object.keys(v).every((k) => keys.includes(k));
const invalid = () => {
	throw Error('Invalid upload batch request');
};
export function parseBatchRequest(value: any): MutationBatchRequest {
	if (!obj(value) || !['prepare', 'verify', 'commit'].includes(value.phase) || !/^[a-f0-9]{64}$/.test(value.digest)) return invalid();
	const phase = value.phase as MutationBatchRequest['phase'];
	const field = phase === 'prepare' ? 'checksums' : phase === 'verify' ? 'uploads' : 'contents';
	if (!closed(value, ['phase', 'descriptor', 'digest', field]) || Buffer.byteLength(JSON.stringify(value)) > UPLOAD_BATCH_METADATA_BYTES)
		return invalid();
	const descriptor = parseUploadBatchDescriptor(value.descriptor);
	if (createHash('sha256').update(uploadBatchCanonicalBytes(descriptor)).digest('hex') !== value.digest) return invalid();
	const rows = value[field];
	if (!Array.isArray(rows) || rows.length > descriptor.members.length) return invalid();
	const seen = new Set<number>();
	let previous = -1;
	for (const row of rows) {
		if (!obj(row) || !Number.isInteger(row.ordinal) || row.ordinal < 0 || row.ordinal >= descriptor.members.length || seen.has(row.ordinal))
			return invalid();
		if (phase !== 'prepare' && row.ordinal <= previous) return invalid();
		previous = row.ordinal;
		seen.add(row.ordinal);
		if (phase === 'prepare' && (!closed(row, ['ordinal', 'sha256']) || !/^[a-f0-9]{64}$/.test(row.sha256))) return invalid();
		if (
			phase !== 'prepare' &&
			(!/^att_[a-f0-9]{64}$/.test(row.uploadId) ||
				row.uploadId !== attachmentIdForRequest(descriptor.scope.ownerId, descriptor.members[row.ordinal].write.operation.id))
		)
			return invalid();
		if (phase === 'verify' && !closed(row, ['ordinal', 'uploadId'])) return invalid();
		if (
			phase === 'commit' &&
			(!closed(row, ['ordinal', 'uploadId', 'version', 'size', 'fingerprint']) ||
				!/^[a-f0-9]{64}$/.test(row.version) ||
				!validContentFingerprint(row.fingerprint, row.size))
		)
			return invalid();
	}
	return { ...value, descriptor } as MutationBatchRequest;
}

export function createFileBatchService(
	overrides: Partial<{
		authorize: typeof authorizeBatch;
		folder: typeof folderBatches;
		observe: typeof observeBatchPaths;
		charge: typeof chargeBatch;
		admit: typeof admitBatchProvider;
		start: typeof startAttachmentUpload;
		sign: typeof signAttachmentUploadParts;
		complete: typeof completeAttachmentUpload;
		fingerprint: typeof getAttachmentFingerprint;
		ownedUpload: typeof attachmentStore.getOwned;
		files: typeof cloudFiles;
	}> = {}
) {
	const deps = {
		authorize: authorizeBatch,
		folder: folderBatches,
		observe: observeBatchPaths,
		charge: chargeBatch,
		admit: admitBatchProvider,
		start: startAttachmentUpload,
		sign: signAttachmentUploadParts,
		complete: completeAttachmentUpload,
		fingerprint: getAttachmentFingerprint,
		ownedUpload: attachmentStore.getOwned,
		files: cloudFiles,
		...overrides
	};
	return async (owner: string, origin: string, raw: unknown, signal: AbortSignal) => {
		if ((raw as any)?.phase === 'folder-probe' || (raw as any)?.phase === 'folder-commit') return deps.folder(owner, origin, raw, signal);
		if ((raw as any)?.phase === 'observe') {
			let observation: ReturnType<typeof parseBatchObserveRequest>;
			try {
				observation = parseBatchObserveRequest(raw);
			} catch {
				return { ok: false as const, status: 400, error: 'Invalid batch observation request' };
			}
			try {
				await deps.authorize(owner, origin, observation, signal);
			} catch (error) {
				return {
					ok: false as const,
					status: authorityStatus(error),
					error: authorityStatus(error) === 403 ? 'Batch authority changed' : 'Batch authority observation unavailable'
				};
			}
			if (!(await deps.charge(owner, 'probe', observation.paths.length, 0)))
				return { ok: false as const, status: 429, error: 'Bulk observation resource capacity unavailable' };
			const result = await deps.observe(owner, observation.configuration.configuration.remoteFolderId, observation.paths, signal);
			return result.ok === false ? { ok: false as const, status: result.status, error: result.error } : result;
		}
		let input: MutationBatchRequest;
		try {
			input = parseBatchRequest(raw);
		} catch {
			return { ok: false as const, status: 400, error: 'Invalid upload batch request' };
		}
		const d = input.descriptor,
			deadline = Date.now() + 30_000;
		const dispatchCheck = () => {
			if (terminal) throw terminalError;
			signal.throwIfAborted();
			if (Date.now() >= deadline) throw Error('deadline');
		};
		try {
			await deps.authorize(owner, origin, d, signal);
		} catch (error) {
			return {
				ok: false as const,
				status: authorityStatus(error),
				error: authorityStatus(error) === 403 ? 'Batch authority changed' : 'Batch authority observation unavailable; retry original operations'
			};
		}
		const payload = d.members.reduce((n, m) => n + (m.write.operation.mutation as any).source.size, 0);
		const rows: any[] = input.phase === 'prepare' ? input.checksums : input.phase === 'verify' ? input.uploads : input.contents;
		const dispatchMembers = input.phase === 'prepare' ? d.members : rows.map((row) => d.members[row.ordinal]);
		const probe = input.phase === 'prepare' && input.checksums.length === 0;
		if (!(await deps.charge(owner, probe || dispatchMembers.length === 0 ? 'probe' : input.phase, dispatchMembers.length, payload)))
			return { ok: false as const, status: 429, error: 'Bulk resource capacity unavailable; retry original operations' };
		if (probe) {
			try {
				signal.throwIfAborted();
				const read = await deps.files.readReceipts(
					owner,
					d.members.map((m) => ({ id: m.write.operation.id, operationId: m.write.operation.id })),
					signal
				);
				if (read.ok === false) return read;
				const results = d.members.map(({ ordinal, write }, i) => {
					const receipt = read.receipts[i]?.file,
						source = (write.operation.mutation as any).source;
					if (!receipt) return { ordinal, status: 'source-required' };
					if (
						receipt.id !== write.operation.id ||
						receipt.folderId !== write.folderId ||
						receipt.name !== write.operation.mutation.path.split('/').at(-1) ||
						receipt.trashed ||
						receipt.content.attachmentId !== attachmentIdForRequest(owner, write.operation.id) ||
						receipt.content.size !== source.size ||
						!equalContentFingerprints(receipt.content.fingerprint, source.fingerprint)
					)
						return { ordinal, status: 'failed', statusCode: 409, code: 'conflict', retryable: false };
					return { ordinal, status: 'confirmed', file: receipt, replayed: true };
				});
				return { ok: true as const, version: 1 as const, batchId: d.batchId, digest: input.digest, results };
			} catch {
				return { ok: false as const, status: 503, error: 'Receipt observation unavailable; retry original operations' };
			}
		}
		const selected = new Map(rows.map((row) => [row.ordinal, row]));
		const results: any[] = new Array(d.members.length);
		let terminal = false;
		let terminalError: unknown = null;
		const failed = (ordinal: number, code: UploadBatchFailure['code'], statusCode = 409, retryable = false): UploadBatchFailure => ({
			ordinal,
			status: 'failed',
			code,
			statusCode,
			retryable
		});
		const failure = (ordinal: number, result: any) => {
			if (result.status === 401 || result.status === 403) {
				terminal = true;
				terminalError = new BatchAuthorityChanged();
				return failed(ordinal, 'authority-changed', 403);
			}
			return failed(
				ordinal,
				result.status === 409 && !result.retryable ? 'conflict' : 'temporarily-unavailable',
				result.status ?? 503,
				result.retryable ?? result.status >= 500
			);
		};

		for (let offset = 0; offset < dispatchMembers.length; offset += 8) {
			const wave = dispatchMembers.slice(offset, offset + 8);
			let waveError: unknown = terminalError;
			if (!terminal)
				try {
					dispatchCheck();
					await deps.authorize(owner, origin, d, signal);
				} catch (error) {
					waveError = error;
					terminal = true;
				}
			let observed: Awaited<ReturnType<typeof deps.observe>> | undefined;
			let recovered: Awaited<ReturnType<typeof deps.files.readReceipts>> | undefined;
			if (!terminal) {
				try {
					observed = await deps.observe(
						owner,
						d.configuration.configuration.remoteFolderId,
						wave.map((m) => m.write.operation.mutation.path),
						signal
					);
					if (observed.ok === false) {
						if (observed.authorityChanged) throw new BatchAuthorityChanged();
						if (observed.status === 409) throw new BatchObservationConflict();
						throw Error('Observation unavailable');
					}
					recovered = await deps.files.readReceipts(
						owner,
						wave.map((m) => ({ id: m.write.operation.id, operationId: m.write.operation.id })),
						signal
					);
					if (recovered.ok === false) throw Error('Receipt observation unavailable');
				} catch (error) {
					waveError = error;
					terminal = true;
				}
			}
			if (terminal) {
				terminalError = waveError;
				for (const m of wave)
					results[m.ordinal] = failed(
						m.ordinal,
						waveError instanceof BatchAuthorityChanged
							? 'authority-changed'
							: waveError instanceof BatchObservationConflict
							? 'conflict'
							: signal.aborted
							? 'cancelled'
							: 'temporarily-unavailable',
						waveError instanceof BatchAuthorityChanged ? 403 : waveError instanceof BatchObservationConflict ? 409 : 503,
						!(waveError instanceof BatchAuthorityChanged) && !(waveError instanceof BatchObservationConflict) && !signal.aborted
					);
				continue;
			}
			const observations = new Map((observed as any).observations.map((r: any) => [r.path, r]));
			await Promise.all(
				wave.map(async ({ ordinal, write }, waveIndex) => {
					const mutation = write.operation.mutation;
					try {
						results[ordinal] = await deps.admit(owner, signal, deadline, async () => {
							const row = selected.get(ordinal),
								source = (mutation as any).source;
							const receipt = (recovered as any).receipts[waveIndex]?.file;
							if (receipt && input.phase !== 'verify') {
								if (
									receipt.id !== write.operation.id ||
									receipt.folderId !== write.folderId ||
									receipt.name !== mutation.path.split('/').at(-1) ||
									receipt.trashed ||
									receipt.content.attachmentId !== attachmentIdForRequest(owner, write.operation.id) ||
									receipt.content.size !== source.size ||
									!equalContentFingerprints(receipt.content.fingerprint, source.fingerprint)
								)
									return failed(ordinal, 'conflict');
								return { ordinal, status: 'confirmed', file: receipt, replayed: true };
							}
							const observation: any = observations.get(mutation.path);
							if (!observation || observation.node) return failed(ordinal, 'conflict');
							const prefix = mutation.path.split('/').slice(0, -1).join('/');
							if (!prefix && write.folderId !== write.cloudRootId) return failed(ordinal, 'conflict');
							if (prefix && (observation.parent?.kind !== 'folder' || observation.parent.id !== write.folderId)) return failed(ordinal, 'conflict');
							const uploadId = attachmentIdForRequest(owner, write.operation.id);
							if (input.phase === 'prepare') {
								dispatchCheck();
								let existing = await deps.fingerprint({ id: owner }, uploadId);
								if (existing.ok === false && existing.status === 404 && row) {
									const rawDigest = Buffer.from(row.sha256, 'hex');
									if (createHash('sha256').update(rawDigest).digest('hex') !== source.fingerprint?.sha256) return failed(ordinal, 'source-changed');
									dispatchCheck();
									const pending = await deps.ownedUpload(owner, uploadId);
									if (pending?.attachmentState === 'finalizing') {
										if (
											pending.attachmentPurpose !== 'file' ||
											pending.objectSizeBytes !== source.size ||
											pending.crystal.name !== mutation.path.split('/').at(-1)
										)
											return failed(ordinal, 'conflict');
										// Recovery performs completion work, so it pays the existing verify
										// weight in addition to prepare, without altering canonical leases.
										if (!(await deps.charge(owner, 'verify', 1, 0))) return failed(ordinal, 'temporarily-unavailable', 429, true);
										dispatchCheck();
										const recovered = await deps.complete(owner, { uploadId });
										if (recovered.ok === false) return failure(ordinal, recovered);
										dispatchCheck();
										existing = await deps.fingerprint({ id: owner }, uploadId);
									}
								}
								if (existing.ok === true) {
									if (existing.size !== source.size || !equalContentFingerprints(existing.fingerprint, source.fingerprint))
										return failed(ordinal, 'source-changed');
									return {
										ordinal,
										status: 'verified',
										content: { ordinal, uploadId, version: existing.version, size: existing.size, fingerprint: existing.fingerprint }
									};
								}
								if (existing.status !== 404) return failure(ordinal, existing);
								if (!row) return { ordinal, status: 'source-required' };
								const checksum = Buffer.from(row.sha256, 'hex');
								if (createHash('sha256').update(checksum).digest('hex') !== source.fingerprint?.sha256) return failed(ordinal, 'source-changed');
								dispatchCheck();
								const started = await deps.start(owner, {
									filename: mutation.path.split('/').at(-1),
									contentType: 'application/octet-stream',
									sizeBytes: source.size,
									requestId: write.operation.id,
									purpose: 'file'
								});
								if (started.ok === false) return failure(ordinal, started);
								if (started.upload.id !== uploadId || started.upload.partCount !== 1) return failed(ordinal, 'invalid-member');
								// Ready/lost-verify uploads reconcile through verify, never sign another object.
								if (started.upload.state === 'ready') {
									dispatchCheck();
									const content = await deps.fingerprint({ id: owner }, uploadId);
									if (content.ok === false) return failure(ordinal, content);
									if (content.size !== source.size || !equalContentFingerprints(content.fingerprint, source.fingerprint))
										return failed(ordinal, 'source-changed');
									return {
										ordinal,
										status: 'verified',
										content: { ordinal, uploadId, version: content.version, size: content.size, fingerprint: content.fingerprint }
									};
								}
								dispatchCheck();
								const signed = await deps.sign(owner, { uploadId, parts: [{ partNumber: 1, checksumSha256: checksum.toString('base64') }] });
								if (signed.ok === false) return failure(ordinal, signed);
								if (Buffer.byteLength(JSON.stringify(signed.parts[0])) > 16 * 1024) return failed(ordinal, 'temporarily-unavailable', 503, true);
								return {
									ordinal,
									status: 'prepared',
									upload: { id: uploadId, partSizeBytes: started.upload.partSizeBytes, partCount: 1 },
									part: signed.parts[0]
								};
							}
							if (!row) return failed(ordinal, 'invalid-member');
							if (input.phase === 'verify') {
								dispatchCheck();
								const completed = await deps.complete(owner, { uploadId });
								if (completed.ok === false) return failure(ordinal, completed);
								dispatchCheck();
								const content = await deps.fingerprint({ id: owner }, uploadId);
								if (content.ok === false) return failure(ordinal, content);
								if (content.size !== source.size || !equalContentFingerprints(content.fingerprint, source.fingerprint))
									return failed(ordinal, 'source-changed');
								return {
									ordinal,
									status: 'verified',
									content: { ordinal, uploadId, version: content.version, size: content.size, fingerprint: content.fingerprint }
								};
							}
							if (row.size !== source.size || !equalContentFingerprints(row.fingerprint, source.fingerprint))
								return failed(ordinal, 'source-changed');
							// Canonical commit verifies owned immutable stored object, CAS, quota and Timeline receipt.
							dispatchCheck();
							const committed = await deps.files.commit(
								owner,
								cloudWriteCommit(write, { attachmentId: uploadId, version: row.version, size: row.size, fingerprint: row.fingerprint })
							);
							if (committed.ok === false) return failure(ordinal, committed);
							return { ordinal, status: 'confirmed', file: committed.file, replayed: committed.replayed };
						});
					} catch (error) {
						results[ordinal] =
							error instanceof BatchAuthorityChanged
								? failed(ordinal, 'authority-changed', 403)
								: failed(ordinal, signal.aborted ? 'cancelled' : 'temporarily-unavailable', 503, !signal.aborted);
					}
				})
			);
		}
		const envelope = {
			ok: true as const,
			version: 1 as const,
			batchId: d.batchId,
			digest: input.digest,
			results: input.phase === 'prepare' ? results : dispatchMembers.map((m) => results[m.ordinal])
		};
		const bytes = () => Buffer.byteLength(JSON.stringify(envelope));
		if (bytes() > UPLOAD_BATCH_RESPONSE_BYTES) {
			const prepared = results
				.filter((r) => r.status === 'prepared')
				.map((r) => ({ ordinal: r.ordinal, bytes: Buffer.byteLength(JSON.stringify(r)) }))
				.sort((a, b) => b.bytes - a.bytes);
			for (const item of prepared) {
				results[item.ordinal] = failed(item.ordinal, 'temporarily-unavailable', 503, true);
				if (bytes() <= UPLOAD_BATCH_RESPONSE_BYTES) break;
			}
			if (bytes() > UPLOAD_BATCH_RESPONSE_BYTES)
				return { ok: false as const, status: 503, error: 'Batch response exceeds bounded metadata; retry original operations' };
		}
		return envelope;
	};
}
export const fileBatches = createFileBatchService();
