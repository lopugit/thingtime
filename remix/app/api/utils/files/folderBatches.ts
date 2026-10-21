import { createHash } from 'node:crypto';
import {
	parseFolderBatchDescriptor,
	parseFolderBatchOrdinals,
	folderBatchCanonicalBytes,
	type FolderBatchDescriptor,
	type FolderBatchRequest,
	type FolderBatchFailure
} from '../../../fileSync/folderBatch';
import { UPLOAD_BATCH_METADATA_BYTES } from '../../../fileSync/uploadBatch';
import { parseCloudFolderCreate, type CloudFolderCreate, type CloudFolder } from '../../../fileSync/cloudFolder';
import { StorageMutationError } from '../storage/storageCore';
import { authorizeBatch, BatchAuthorityChanged } from './batchAuthority';
import { cloudFolders } from './folders';
import { createBatchObserveService } from './batchObserve';
import { chargeBatch, admitFolderRoot } from './batchAdmission';

export const FOLDER_BATCH_MAX_ROWS = 65_536;
const closed = (v: any, keys: string[]) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every((k) => keys.includes(k));
export function parseFolderBatchRequest(raw: any): FolderBatchRequest {
	if (
		!closed(raw, raw?.phase === 'folder-probe' ? ['phase', 'descriptor', 'digest'] : ['phase', 'descriptor', 'digest', 'ordinals']) ||
		!['folder-probe', 'folder-commit'].includes(raw.phase) ||
		!/^[a-f0-9]{64}$/.test(raw.digest) ||
		Buffer.byteLength(JSON.stringify(raw)) > UPLOAD_BATCH_METADATA_BYTES
	)
		throw Error('Invalid folder batch request');
	const descriptor = parseFolderBatchDescriptor(raw.descriptor);
	if (createHash('sha256').update(folderBatchCanonicalBytes(descriptor)).digest('hex') !== raw.digest) throw Error('Folder digest mismatch');
	return raw.phase === 'folder-probe'
		? { phase: raw.phase, descriptor, digest: raw.digest }
		: { phase: raw.phase, descriptor, digest: raw.digest, ordinals: parseFolderBatchOrdinals(raw.ordinals, descriptor.members.length) };
}
const inputFor = (d: FolderBatchDescriptor, ordinal: number) => {
	const w = d.members[ordinal].write;
	return parseCloudFolderCreate({
		kind: 'folder',
		id: w.operation.id,
		operationId: w.operation.id,
		name: w.operation.mutation.path.split('/').at(-1),
		folderId: w.folderId
	});
};
const exact = (folder: CloudFolder, input: CloudFolderCreate) =>
	folder.id === input.id && folder.name === input.name && folder.folderId === input.folderId;
const failure = (ordinal: number, code: FolderBatchFailure['code'], statusCode = 409, retryable = false): FolderBatchFailure => ({
	ordinal,
	status: 'failed',
	code,
	statusCode,
	retryable
});
const statusFailure = (ordinal: number, status: number) =>
	failure(
		ordinal,
		status === 401 || status === 403
			? 'authority-changed'
			: status === 404
			? 'dependency-unavailable'
			: status === 409 || status === 400
			? 'target-changed'
			: 'temporarily-unavailable',
		status,
		status >= 500 || status === 429
	);

export function createFolderBatchService(
	overrides: Partial<{
		authorize: typeof authorizeBatch;
		charge: typeof chargeBatch;
		folders: typeof cloudFolders;
		admit: typeof admitFolderRoot;
		now: () => number;
		observe: (
			things: any,
			session: any,
			owner: string,
			root: string,
			paths: string[],
			signal: AbortSignal,
			row: () => void
		) => ReturnType<ReturnType<typeof createBatchObserveService>>;
	}> = {}
) {
	const deps = {
		authorize: authorizeBatch,
		charge: chargeBatch,
		folders: cloudFolders,
		admit: admitFolderRoot,
		now: Date.now,
		observe: (things: any, session: any, owner: string, root: string, paths: string[], signal: AbortSignal, row: () => void) =>
			createBatchObserveService({ collection: async () => things, snapshot: async (work) => work(session), row })(owner, root, paths, signal),
		...overrides
	};
	return async (owner: string, origin: string, raw: unknown, signal: AbortSignal) => {
		let request: FolderBatchRequest;
		try {
			request = parseFolderBatchRequest(raw);
		} catch {
			return { ok: false as const, status: 400, error: 'Invalid immutable folder batch request' };
		}
		const d = request.descriptor,
			deadline = deps.now() + 30_000;
		const check = () => {
			signal.throwIfAborted();
			if (deps.now() >= deadline) throw new StorageMutationError(503, 'storage_conflict', 'Folder request deadline expired');
		};
		try {
			check();
			await deps.authorize(owner, origin, d, signal);
		} catch (error) {
			return {
				ok: false as const,
				status: error instanceof BatchAuthorityChanged ? 403 : 503,
				error: 'Folder authority observation unavailable or changed'
			};
		}
		const ordinals = request.phase === 'folder-probe' ? d.members.map((m) => m.ordinal) : request.ordinals;
		if (!(await deps.charge(owner, request.phase === 'folder-probe' ? 'probe' : 'folderCommit', ordinals.length, 0)))
			return { ok: false as const, status: 429, error: 'Folder metadata resource capacity unavailable' };
		const read = await deps.folders.readReceipts(
			owner,
			d.members.map((m) => ({ id: m.write.operation.id, operationId: m.write.operation.id })),
			signal
		);
		if (read.ok === false) return { ok: false as const, status: read.status, error: 'Canonical folder receipts unavailable' };
		const confirmed = new Map<number, CloudFolder>(),
			results = new Map<number, any>();
		for (const [i, folder] of read.receipts.entries())
			if (folder) {
				if (exact(folder, inputFor(d, i))) confirmed.set(i, folder);
				else results.set(i, failure(i, 'invalid-member'));
			}
		for (const i of ordinals) if (confirmed.has(i)) results.set(i, { ordinal: i, status: 'confirmed', folder: confirmed.get(i)!, replayed: true });
		const envelope = () => {
			const value = {
				ok: true as const,
				version: 1 as const,
				batchId: d.batchId,
				digest: request.digest,
				results: ordinals.map((i) => results.get(i))
			};
			if (Buffer.byteLength(JSON.stringify(value)) > UPLOAD_BATCH_METADATA_BYTES)
				return { ok: false as const, status: 503, error: 'Folder response exceeds bounded metadata' };
			return value;
		};
		if (request.phase === 'folder-probe') {
			for (const i of ordinals) if (!results.has(i)) results.set(i, { ordinal: i, status: 'source-required' });
			return envelope();
		}
		let rows = 0;
		const row = () => {
			check();
			if (++rows > FOLDER_BATCH_MAX_ROWS) throw new StorageMutationError(503, 'storage_conflict', 'Folder request work budget exhausted');
		};
		try {
			return await deps.admit(owner + '\0' + d.configuration.configuration.remoteFolderId, signal, deadline, async () => {
				const pending = new Set(ordinals.filter((i) => !results.has(i)));
				let stopped: FolderBatchFailure['code'] | null = null;
				while (pending.size) {
					const wave = [...pending]
						.filter((i) => {
							const p = d.members[i].parent;
							return p.kind !== 'member' || confirmed.has(p.ordinal);
						})
						.slice(0, 8);
					if (!wave.length) break;
					try {
						check();
						await deps.authorize(owner, origin, d, signal);
					} catch (error) {
						stopped = error instanceof BatchAuthorityChanged ? 'authority-changed' : signal.aborted ? 'cancelled' : 'temporarily-unavailable';
						break;
					}
					const value = await deps.folders.createWave(
						owner,
						wave.map((i) => inputFor(d, i)),
						{
							check,
							row,
							beforeWrite: async (things, session, inputs) => {
								const members = inputs.map((input) => d.members.find((m) => m.write.operation.id === input.id)!);
								const observed = await deps.observe(
									things,
									session,
									owner,
									d.configuration.configuration.remoteFolderId,
									members.map((m) => m.write.operation.mutation.path),
									signal,
									row
								);
								if (observed.ok === false)
									throw new StorageMutationError(observed.status, 'storage_conflict', 'Current folder namespace or authority unavailable');
								const denied = new Map<string, { status: number; error: string }>();
								for (const [j, m] of members.entries()) {
									const observation = observed.observations[j],
										w = m.write,
										prefix = w.operation.mutation.path.split('/').slice(0, -1).join('/');
									if (
										observation.path !== w.operation.mutation.path ||
										observation.node ||
										(!prefix && w.folderId !== d.configuration.configuration.remoteFolderId) ||
										(prefix && (observation.parent?.kind !== 'folder' || observation.parent.id !== w.folderId))
									)
										denied.set(w.operation.id, { status: 409, error: 'Folder target or current parent path changed' });
									if (m.parent.kind === 'member' && (!confirmed.has(m.parent.ordinal) || confirmed.get(m.parent.ordinal)!.id !== w.folderId))
										denied.set(w.operation.id, { status: 404, error: 'Canonical parent receipt unavailable' });
								}
								return denied;
							}
						}
					);
					for (const [j, i] of wave.entries()) {
						pending.delete(i);
						if (value.ok === false) {
							results.set(i, statusFailure(i, value.status));
							continue;
						}
						const item = value.results[j];
						if (item.ok === false) {
							results.set(i, statusFailure(i, item.status));
							continue;
						}
						if (!exact(item.folder, inputFor(d, i))) {
							results.set(i, failure(i, 'invalid-member'));
							continue;
						}
						confirmed.set(i, item.folder);
						results.set(i, { ordinal: i, status: 'confirmed', folder: item.folder, replayed: item.replayed });
					}
					if (value.ok === false && (value.status >= 500 || value.status === 401 || value.status === 403)) {
						stopped = value.status === 401 || value.status === 403 ? 'authority-changed' : 'temporarily-unavailable';
						break;
					}
				}
				for (const i of pending)
					results.set(
						i,
						stopped
							? failure(i, stopped, stopped === 'authority-changed' ? 403 : 503, stopped === 'temporarily-unavailable')
							: failure(i, 'dependency-unavailable')
					);
				return envelope();
			});
		} catch {
			return { ok: false as const, status: 503, error: 'Folder request capacity, cancellation or deadline; retry original operations' };
		}
	};
}
export const folderBatches = createFolderBatchService();
