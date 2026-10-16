import { isStandaloneAttachmentPurpose, applyAttachmentAnnotationPatch, sanitizeAttachmentPublicMetadata } from '../api/utils/attachments/attachmentCore';
import { accountSyncDeadline, type SyncState } from './accountSync';
import { isLocalAttachment, type LocalAttachment } from './attachments';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';

const COLLECTION = 'account-file-metadata';
const keys = ['filenamePreview', 'title', 'description', 'folderId'] as const;
export type FileMetadata = Record<(typeof keys)[number], string | null>;
type Snapshot = { id: string; updatedAt: string; metadata: FileMetadata };
type Operation = { kind: 'annotate' | 'move'; expectedUpdatedAt: string; after: FileMetadata };
type MetadataRecord = {
	id: string;
	remoteId?: string;
	base: FileMetadata;
	state: SyncState;
	pending?: Operation;
	claim?: { token: string; expiresAt: number };
	retryAt: number;
	attempts: number;
	error?: string;
};
export type FileMetadataTransport = {
	get(id: string, signal: AbortSignal): Promise<unknown>;
	annotate(
		input: { id: string; expectedUpdatedAt: string; filenamePreview?: string | null; title?: string | null; description?: string | null },
		signal?: AbortSignal
	): Promise<unknown>;
	move(id: string, folderId: string | null, expectedUpdatedAt: string, signal?: AbortSignal): Promise<void>;
};
export const fileMetadata = (row: { crystal: any; folderId?: unknown }): FileMetadata => ({
	filenamePreview: row.crystal.filenamePreview ?? null,
	title: row.crystal.title ?? null,
	description: row.crystal.description ?? null,
	folderId: typeof row.folderId === 'string' && row.folderId ? row.folderId : null
});
const empty: FileMetadata = { filenamePreview: null, title: null, description: null, folderId: null };
const same = (a: FileMetadata, b: FileMetadata) => keys.every((key) => a[key] === b[key]);
/** Metadata is independent of byte upload. Only the upload adapter's verified
 * receipt can resolve a device file to a remote ID; neither local ownership nor
 * caller-supplied IDs authorize an account read/write. */
export class AccountFileMetadata {
	constructor(
		private db: WorkspaceDatabase,
		private scope: Extract<WorkspaceScope, { kind: 'account' }>,
		private lease: WorkspaceLease,
		private now = () => Date.now(),
		private uuid = () => crypto.randomUUID()
	) {
		if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous files never synchronize', 403);
	}
	private tx<T>(mode: IDBTransactionMode, work: (tx: WorkspaceTransaction) => Promise<T>) {
		return this.db.transaction(this.scope, mode, this.lease, work);
	}
	async enqueue(tx: WorkspaceTransaction, row: LocalAttachment, previous?: LocalAttachment) {
		const before = previous ? fileMetadata(previous) : empty,
			after = fileMetadata(row);
		if (same(before, after)) return;
		if (!isStandaloneAttachmentPurpose(row.localAttachment.purpose) || row.targetId)
			throw new WorkspaceError('LOCAL_OPERATION_UNAVAILABLE', 'Bound account media requires its dedicated reconciliation adapter.');
		const prior = await tx.get<MetadataRecord>(COLLECTION, row.id);
		await tx.put(
			COLLECTION,
			row.id,
			prior
				? { ...prior, state: prior.state === 'conflict' || prior.state === 'error' ? prior.state : 'pending' }
				: ({ id: row.id, base: before, state: 'pending', attempts: 0, retryAt: 0 } satisfies MetadataRecord)
		);
	}
	/** An authorized observation may refresh clean details, never replace local
	 * edits or an immutable operation whose account receipt is still unknown. */
	async remember(tx: WorkspaceTransaction, local: LocalAttachment, remote: Snapshot) {
		const prior = await tx.get<MetadataRecord>(COLLECTION, local.id);
		if (prior && (prior.state !== 'synced' || prior.pending)) return;
		await this.writeLocal(tx, local, remote.metadata);
		await tx.put(COLLECTION, local.id, { id: local.id, remoteId: remote.id, base: remote.metadata, state: 'synced', attempts: 0, retryAt: 0 } satisfies MetadataRecord);
	}
	/** Deleting after an offline edit must not depend on that edit syncing first.
	 * Accept only a complete known snapshot; unrelated account edits still need
	 * review, and the delete request independently fences the observed version. */
	async matchesDeletion(tx: WorkspaceTransaction, local: LocalAttachment, remote: Snapshot) {
		if (same(fileMetadata(local), remote.metadata)) return true;
		const known = await tx.get<MetadataRecord>(COLLECTION, local.id);
		return !!known && (!known.remoteId || known.remoteId === remote.id) && same(known.base, remote.metadata);
	}
	async discardUnuploaded(tx: WorkspaceTransaction, id: string) { await tx.delete(COLLECTION, id); }
	async status() {
		return this.tx('readonly', async (tx) => (await tx.list<MetadataRecord>(COLLECTION)).map((row) => row.value));
	}
	async retry(id: string) {
		await this.tx('readwrite', async (tx) => {
			const row = await tx.get<MetadataRecord>(COLLECTION, id);
			if (!row || row.state === 'synced' || (row.claim && row.claim.expiresAt > this.now())) return;
			if (row.state === 'conflict') throw new WorkspaceError('SYNC_CONFLICT', 'Compare the file versions before retrying.', 409);
			await tx.put(COLLECTION, id, { ...row, state: 'pending', retryAt: 0, error: undefined });
		});
	}
	checked(raw: any, id: string): Snapshot {
		if (
			!raw ||
			raw.id !== id ||
			raw.author?.id !== this.scope.ownerId ||
			raw.thingtime?.length !== 1 ||
			raw.thingtime[0] !== 'attachment' ||
			!Number.isFinite(Date.parse(raw.updatedAt)) ||
			(raw.folderId != null && (typeof raw.folderId !== 'string' || raw.folderId.length > 200))
		)
			throw new WorkspaceError('FILE_IDENTITY', 'The account file did not match this workspace.', 409);
		const checked = sanitizeAttachmentPublicMetadata(raw.crystal);
		if (!checked.ok) throw new WorkspaceError('INVALID_FILE_METADATA', 'The account returned invalid file metadata.', 502);
		return { id, updatedAt: raw.updatedAt, metadata: fileMetadata({ crystal: checked.crystal, folderId: raw.folderId }) };
	}
	private async writeLocal(tx: WorkspaceTransaction, local: LocalAttachment, next: FileMetadata) {
		if (same(fileMetadata(local), next)) return;
		const patch = applyAttachmentAnnotationPatch(local.crystal, next);
		if (patch.ok === false) throw new WorkspaceError('INVALID_FILE_METADATA', patch.error);
		await tx.put('things', local.id, {
			...local,
			crystal: patch.crystal,
			folderId: next.folderId,
			revision: local.revision + 1,
			updatedAt: new Date(Math.max(this.now(), Date.parse(local.updatedAt) + 1)).toISOString()
		});
	}
	private async prepare(id: string, token: string, remote: Snapshot): Promise<Operation | null> {
		return this.tx('readwrite', async (tx) => {
			const row = await tx.get<MetadataRecord>(COLLECTION, id),
				local = await tx.get<LocalAttachment>('things', id);
			if (!row || row.claim?.token !== token || (await tx.get<any>('account-files', id))?.deleteRequested) throw new WorkspaceError('SYNC_CLAIM', 'File synchronization changed.', 409);
			if (!local || !isLocalAttachment(local)) throw new WorkspaceError('MISSING_LOCAL_FILE', 'The device file is missing.', 404);
			let base = row.base;
			if (row.pending) {
				const written = row.pending.kind === 'move' ? (['folderId'] as const) : (['filenamePreview', 'title', 'description'] as const);
				const acknowledged = written.every((key) => remote.metadata[key] === row.pending!.after[key]);
				if (acknowledged) base = row.pending.after;
				else if (remote.updatedAt === row.pending.expectedUpdatedAt) return row.pending;
			}
			const desired = fileMetadata(local),
				merged = { ...remote.metadata };
			for (const key of keys) {
				if (desired[key] !== base[key] && remote.metadata[key] !== base[key] && desired[key] !== remote.metadata[key])
					throw new WorkspaceError('FILE_METADATA_CONFLICT', 'File details changed on your account. Compare both versions.', 409);
				if (desired[key] !== base[key]) merged[key] = desired[key];
			}
			await this.writeLocal(tx, local, merged);
			const annotation = keys.some((key) => key !== 'folderId' && merged[key] !== remote.metadata[key]);
			const kind = annotation ? 'annotate' : merged.folderId !== remote.metadata.folderId ? 'move' : null;
			const after = annotation ? { ...merged, folderId: remote.metadata.folderId } : { ...remote.metadata, folderId: merged.folderId };
			const pending: Operation | undefined = kind ? { kind, expectedUpdatedAt: remote.updatedAt, after } : undefined;
			await tx.put(COLLECTION, id, {
				...row,
				base: remote.metadata,
				pending,
				state: kind ? 'syncing' : 'synced',
				claim: kind ? row.claim : undefined,
				error: undefined,
				retryAt: 0,
				attempts: 0
			});
			return pending || null;
		});
	}
	async inspect(transport: FileMetadataTransport, id: string, signal = new AbortController().signal) {
		const known = await this.tx('readonly', (tx) => tx.get<MetadataRecord>(COLLECTION, id));
		if (known?.state !== 'conflict' || !known.remoteId) throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'Review this file again.', 409);
		const remoteId = known.remoteId;
		const remote = this.checked(await accountSyncDeadline((child) => transport.get(remoteId, child), signal), remoteId);
		return this.tx('readonly', async (tx) => {
			const state = await tx.get<MetadataRecord>(COLLECTION, id),
				local = await tx.get<LocalAttachment>('things', id);
			if (state?.state !== 'conflict' || state.remoteId !== remoteId || !local)
				throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'Review this file again.', 409);
			return { id, remoteId, local: fileMetadata(local), remote, localRevision: local.revision };
		});
	}
	async resolve(
		transport: FileMetadataTransport,
		choice: { id: string; remoteId: string; localRevision: number; remoteUpdatedAt: string; keep: 'local' | 'remote' },
		signal = new AbortController().signal
	) {
		if (!['local', 'remote'].includes(choice.keep)) throw new WorkspaceError('INVALID_CONFLICT_CHOICE', 'Choose the file version to keep.');
		const known = await this.tx('readonly', (tx) => tx.get<MetadataRecord>(COLLECTION, choice.id));
		if (known?.state !== 'conflict' || known.remoteId !== choice.remoteId)
			throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'Review this file again.', 409);
		const remote = this.checked(await accountSyncDeadline((child) => transport.get(choice.remoteId, child), signal), choice.remoteId);
		if (remote.updatedAt !== choice.remoteUpdatedAt)
			throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'The account file changed. Review it again.', 409);
		await this.tx('readwrite', async (tx) => {
			const row = await tx.get<MetadataRecord>(COLLECTION, choice.id),
				local = await tx.get<LocalAttachment>('things', choice.id);
			if (row?.state !== 'conflict' || row.remoteId !== choice.remoteId || !local || local.revision !== choice.localRevision)
				throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'The device file changed. Review it again.', 409);
			if (choice.keep === 'remote') await this.writeLocal(tx, local, remote.metadata);
			await tx.put(COLLECTION, choice.id, {
				id: choice.id,
				remoteId: choice.remoteId,
				base: remote.metadata,
				state: choice.keep === 'remote' ? 'synced' : 'pending',
				attempts: 0,
				retryAt: 0
			} satisfies MetadataRecord);
		});
	}
	async sync(
		transport: FileMetadataTransport,
		remoteId: (id: string) => Promise<string | null>,
		folderReady: (id: string) => Promise<boolean>,
		signal = new AbortController().signal
	) {
		let completed = 0,
			attempted = 0;
		for (const candidate of await this.status()) {
			if (
				!['pending', 'syncing'].includes(candidate.state) ||
				candidate.retryAt > this.now() ||
				(candidate.claim && candidate.claim.expiresAt > this.now())
			)
				continue;
			const remote = await remoteId(candidate.id);
			if (!remote) continue;
			if (++attempted > 3) break;
			const token = this.uuid();
			const claimed = await this.tx('readwrite', async (tx) => {
				const row = await tx.get<MetadataRecord>(COLLECTION, candidate.id);
				if (!row || (await tx.get<any>('account-files', candidate.id))?.deleteRequested || !['pending', 'syncing'].includes(row.state) || row.retryAt > this.now() || (row.claim && row.claim.expiresAt > this.now()))
					return false;
				await tx.put(COLLECTION, row.id, { ...row, remoteId: remote, state: 'syncing', claim: { token, expiresAt: this.now() + 60_000 } });
				return true;
			});
			if (!claimed) continue;
			const controller = new AbortController(),
				abort = () => controller.abort(),
				off = this.lease.onInvalidate(abort);
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort();
			const timer = setTimeout(abort, 45_000);
			try {
				for (let step = 0; step < 4; step++) {
					this.lease.assertCurrent();
					controller.signal.throwIfAborted();
					const snapshot = this.checked(await accountSyncDeadline((child) => transport.get(remote, child), controller.signal), remote);
					controller.signal.throwIfAborted();
					this.lease.assertCurrent();
					const operation = await this.prepare(candidate.id, token, snapshot);
					if (!operation) {
						completed++;
						break;
					}
					if (operation.kind === 'move' && operation.after.folderId && !(await folderReady(operation.after.folderId))) break;
					controller.signal.throwIfAborted();
					this.lease.assertCurrent();
					await accountSyncDeadline(
						(child) =>
							operation.kind === 'move'
								? transport.move(remote, operation.after.folderId, operation.expectedUpdatedAt, child)
								: transport.annotate(
										{
											id: remote,
											expectedUpdatedAt: operation.expectedUpdatedAt,
											title: operation.after.title,
											description: operation.after.description,
											filenamePreview: operation.after.filenamePreview
										},
										child
								  ),
						controller.signal
					);
				}
				await this.tx('readwrite', async (tx) => {
					const row = await tx.get<MetadataRecord>(COLLECTION, candidate.id);
					if (row?.claim?.token === token) await tx.put(COLLECTION, row.id, { ...row, claim: undefined, state: 'pending' });
				});
			} catch (error: any) {
				this.lease.assertCurrent();
				await this.tx('readwrite', async (tx) => {
					const row = await tx.get<MetadataRecord>(COLLECTION, candidate.id);
					if (row?.claim?.token !== token || (await tx.get<any>('account-files', candidate.id))?.deleteRequested) return;
					const conflict = error?.code === 'FILE_METADATA_CONFLICT';
					const state = conflict
						? 'conflict'
						: [400, 401, 403, 404, 410, 413, 422].includes(error?.status) || error?.code === 'FILE_IDENTITY'
						? 'error'
						: 'pending';
					await tx.put(COLLECTION, row.id, {
						...row,
						state,
						claim: undefined,
						attempts: row.attempts + 1,
						retryAt: this.now() + Math.max(Math.min(60_000, 1000 * 2 ** Math.min(row.attempts, 6)), Number(error?.retryAfterMs) || 0),
						error: conflict
							? 'File details changed on your account. Compare both versions.'
							: 'File details are saved on this device; account sync needs attention.'
					});
				});
			} finally {
				clearTimeout(timer);
				off();
				signal.removeEventListener('abort', abort);
			}
		}
		return { completed };
	}
}
