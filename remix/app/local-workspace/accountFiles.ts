import { isStandaloneAttachmentPurpose, sanitizeAttachmentPublicMetadata } from '../api/utils/attachments/attachmentCore';
import { AccountFileMetadata, fileMetadata, type FileMetadataTransport } from './accountFileMetadata';
import { normalizePublicAttachment, multipartPartRange, attachmentCompleteRetryPhase } from '../components/Attachments/attachmentUiCore';
import type { PublicAttachment, SignedUploadPart } from '../components/Attachments/attachmentTypes';
import { transferChecksum } from '../utils/thingTransfer/archive';
import { compositionAttachmentIds } from '../api/utils/actions/compositionMediaCore';
import { rewriteTransferMedia } from '../api/utils/things/transferMediaCore';
import { LocalThings, type LocalThing } from './things';
import { createLocalAttachment, isLocalAttachment, type LocalAttachment } from './attachments';
import { WORKSPACE_LIMITS, WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import { accountReadRefusals, forgetAccountConversation } from './accountReadRevocation';
import { accountSyncDeadline, type SyncState } from './accountSync';

const COLLECTION = 'account-files';
const CLAIM_MS = 60_000;
const ATTEMPT_MS = 45_000;
type RetainedBinding = { targetId: string; purpose: 'post' | 'comment'; order: number };
type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
export type AccountFileRequest = {
	requestId: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
	purpose: 'file' | 'recording' | 'post' | 'comment';
};
export type AccountFilePlan = { id: string; partSizeBytes: number; partCount: number; state?: 'ready' };
type FileRecord = {
	id: string;
	request: Omit<AccountFileRequest, 'requestId'> & { requestId?: string };
	source?: 'account';
	retainedKey?: string;
	retainedVersion?: string;
	retainedObservedAt?: number;
	sha256: string;
	controlReserve?: string;
	started?: boolean;
	deleteRequested?: true;
	deleteVersion?: string;
	deletingLocal?: LocalAttachment;
	cancelRequested?: true;
	cancelled?: true;
	state: SyncState;
	phase: 'start' | 'upload' | 'complete';
	plan?: AccountFilePlan;
	uploaded: number[];
	remote?: PublicAttachment;
	attempts: number;
	retryAt: number;
	error?: string;
	claim?: { token: string; expiresAt: number };
};
const libraryFileVisible = (row: LocalAttachment | null, record: FileRecord | undefined | null): boolean => !!row && isLocalAttachment(row) && isStandaloneAttachmentPurpose(row.localAttachment.purpose) && !row.targetId && !row.localAttachment.draftId && !row.localAttachment.expiresAt && !!record && !record.cancelled && !record.cancelRequested && !record.deleteRequested;
export type AccountFileRetentionTransport = {
	retention(id: string, signal: AbortSignal, bound?: boolean): Promise<unknown>;
	bytes(id: string, cacheKey: string, size: number, signal: AbortSignal): Promise<Uint8Array>;
};
export type AccountFileTransport = {
	remove?(input: { id: string; expectedUpdatedAt: string } & ({ requestId: string; targetId?: string; retainReceipt?: never } | { retainReceipt: true; targetId?: string; requestId?: never }), signal: AbortSignal): Promise<{ deleted: true; deferred: boolean; retryAt?: string }>;
	cancel?(requestId: string, signal: AbortSignal): Promise<{ cancelled: true; deferred: boolean; retryAt?: string }>;
	start(request: Readonly<AccountFileRequest>, signal: AbortSignal): Promise<AccountFilePlan>;
	parts(id: string, parts: { partNumber: number; checksumSha256: string }[], signal: AbortSignal): Promise<SignedUploadPart[]>;
	put(part: SignedUploadPart, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
	complete(id: string, signal: AbortSignal): Promise<PublicAttachment>;
};
const checksumBase64 = async (bytes: Uint8Array) => {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
	let binary = '';
	for (const byte of digest) binary += String.fromCharCode(byte);
	return btoa(binary);
};
/** Device bytes and immutable upload intent commit together. This adapter never
 * publishes a post or authenticates an offline identity. Its transport must pin
 * the verified account and data plane for every request, including signed PUTs. */
export class AccountFileSync {
	readonly things: LocalThings;
	readonly metadata: AccountFileMetadata;
	private retaining = new Map<string, Promise<{ row: LocalAttachment; changed: boolean }>>();
	constructor(
		private db: WorkspaceDatabase,
		readonly scope: AccountScope,
		private lease: WorkspaceLease,
		private now = () => Date.now(),
		private uuid = () => crypto.randomUUID()
	) {
		if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous files never synchronize', 403);
		this.metadata = new AccountFileMetadata(db, scope, lease, now, uuid);
		this.things = new LocalThings(
			db,
			scope,
			lease,
			[],
			() => new Date(now()).toISOString(),
			uuid,
			undefined,
			(tx, row, previous) => this.enqueue(tx, row, previous)
		);
	}
	private tx<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>, signal?: AbortSignal) {
		const lease = !signal ? this.lease : {
			assertCurrent: () => { this.lease.assertCurrent(); signal.throwIfAborted(); },
			onInvalidate: (callback: () => void) => { const off = this.lease.onInvalidate(callback); signal.addEventListener('abort', callback, { once: true }); if (signal.aborted) callback(); return () => { off(); signal.removeEventListener('abort', callback); }; }
		};
		return this.db.transaction(this.scope, mode, lease, run);
	}
	private putRecord(tx: WorkspaceTransaction, row: FileRecord) {
		// Reserve bounded control space at admission, so a full workspace can
		// still record cancellation, claim it, retry and acknowledge it. Account
		// response/part data remain separately charged at their actual size.
		const { state, phase, started, deleteRequested, deleteVersion, cancelRequested, cancelled, attempts, retryAt, error, claim } = row;
		const controls = JSON.stringify({ state, phase, started, deleteRequested, deleteVersion, cancelRequested, cancelled, attempts, retryAt, error, claim, ...(row.deletingLocal ? { deletingLocal: null } : {}) });
		const controlReserve = ' '.repeat(Math.max(0, 1024 - new TextEncoder().encode(controls).length));
		return tx.put(COLLECTION, row.id, { ...row, controlReserve });
	}
	/** Both writers participate in the importer's existing transaction. Only
	 * confirmed upload receipts can rewrite a device file to an account ID. */
	readonly contentHooks = {
		mutate: (tx: WorkspaceTransaction, row: LocalAttachment, previous?: LocalAttachment) => this.enqueue(tx, row, previous),
		prepare: async (tx: WorkspaceTransaction, row: LocalThing): Promise<(LocalThing & { attachmentIds?: string[] }) | null> => {
			this.lease.assertCurrent();
			const records = new Map((await tx.list<FileRecord>(COLLECTION)).map(({ value }) => [value.id, value]));
			const isPost = row.thingtime.includes('post');
			if (isPost && [...records.values()].some(file => file.deleteRequested && !file.cancelled && file.deletingLocal?.targetId === row.id)) return null;
			const bound = isPost ? (await tx.list<LocalAttachment>('things')).map(item => item.value).filter(file => isLocalAttachment(file) && file.targetId === row.id).sort((a,b) => a.localAttachment.order - b.localAttachment.order) : [];
			for (const file of bound) if (!records.has(file.id)) throw new WorkspaceError('MISSING_UPLOAD', 'A post file has no matching account upload intent.', 409);
			const used = new Set([...bound.map(file => file.id), ...[...compositionAttachmentIds(row.thingtime, row.crystal)].filter(id => records.has(id))]);
			// Track canonical rewriter lookups in saved args, CSS, authored HTML
			// and late-bound templates. Only confirmed IDs enter the copy map.
			class FileReferences extends Map<string, string> {
				get(id: string) { if (records.has(id)) used.add(id); return super.get(id); }
				has(id: string) { if (records.has(id)) used.add(id); return super.has(id); }
			}
			const copies = new FileReferences([...records.values()].flatMap(file => file.remote ? [[file.id, file.remote.id] as const] : []));
			const crystal = rewriteTransferMedia([row], copies).get(row.id)!;
			const targetId = row.targetId ? copies.get(row.targetId) || row.targetId : row.targetId;
			for (const id of used) {
				const file = records.get(id)!;
				if (file.cancelled || file.cancelRequested || file.deleteRequested) throw new WorkspaceError('FILE_REFERENCE_DELETED', 'A referenced device file was removed. Edit this Thing before retrying account sync.', 409);
				if (!file.remote) return null;
			}
			return { ...row, crystal, ...(targetId ? { targetId } : {}), ...(isPost ? { attachmentIds: bound.map(file => records.get(file.id)!.remote!.id) } : {}) };
		},
		restore: async <T extends LocalThing>(tx: WorkspaceTransaction, row: T): Promise<T> => {
			const copies = new Map((await tx.list<FileRecord>(COLLECTION)).flatMap(({value}) => value.remote && !value.cancelled && !value.deleteRequested ? [[value.remote.id, value.id] as const] : []));
			return { ...row, crystal: rewriteTransferMedia([row], copies).get(row.id)! };
		}
	};
	private async enqueue(tx: WorkspaceTransaction, row: LocalAttachment, previous?: LocalAttachment) {
		const existing = await tx.get<FileRecord>(COLLECTION, row.id);
		if (existing?.deleteRequested || existing?.cancelRequested || existing?.cancelled) throw new WorkspaceError('UPLOAD_CANCELLED', 'This upload request was cancelled. Choose the file again with a new request.', 409);
		await this.metadata.enqueue(tx, row, previous);
		if (existing) return;
		const purpose = row.localAttachment.purpose,
			requestId = row.localAttachment.requestId;
		if (!requestId || !['file', 'recording', 'post', 'comment'].includes(purpose))
			throw new WorkspaceError('INVALID_UPLOAD', 'Unsupported account file selection');
		const record: FileRecord = {
			id: row.id,
			request: {
				requestId,
				filename: String(row.crystal.name),
				contentType: String(row.crystal.contentType),
				sizeBytes: Number(row.crystal.size),
				purpose: purpose as AccountFileRequest['purpose']
			},
			sha256: row.localAttachment.sha256,
			started: false,
			state: 'pending',
			phase: 'start',
			uploaded: [],
			attempts: 0,
			retryAt: 0
		};
		await this.putRecord(tx, record);
	}
	private checkedRetention(raw: any, id: string, binding?: RetainedBinding) {
		const file = raw?.file, attachment = normalizePublicAttachment(file?.attachment);
		const purpose = file?.purpose;
		if (!(binding ? purpose === binding.purpose && file?.targetId === binding.targetId : isStandaloneAttachmentPurpose(purpose) && !file?.targetId) || !attachment || attachment.id !== id || file?.ownerId !== this.scope.ownerId || 'url' in file.attachment ||
			!Number.isSafeInteger(raw.size) || raw.size < 1 || raw.size !== attachment.size || raw.size > WORKSPACE_LIMITS.binaryBytes ||
			!(/^[a-f0-9]{64}:original$/).test(raw.cacheKey || ''))
			throw new WorkspaceError('INVALID_FILE_RETENTION', 'The account returned an invalid owned file descriptor.', 502);
		const metadata = this.metadata.checked({ id, author: { id: file.ownerId }, thingtime: ['attachment'], crystal: attachment, updatedAt: file.updatedAt, folderId: file.folderId }, id);
		const crystal = sanitizeAttachmentPublicMetadata(attachment);
		if (!crystal.ok) throw new WorkspaceError('INVALID_FILE_RETENTION', 'The account returned invalid file metadata.', 502);
		return { purpose: purpose as LocalAttachment['localAttachment']['purpose'], attachment, crystal: crystal.crystal, metadata, cacheKey: raw.cacheKey as string };
	}
	private accessRefused() { return new WorkspaceError('FILE_ACCESS_REFUSED', 'Account access to this retained file is no longer available. Reopen it online before using its saved bytes. Device edits are preserved.', 409); }
	private async loadRetention(transport: AccountFileRetentionTransport, id: string, signal: AbortSignal, binding?: RetainedBinding) {
		this.lease.assertCurrent(); signal.throwIfAborted();
		if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id) || id.startsWith('local-file-')) throw new WorkspaceError('INVALID_FILE_ID', 'A canonical account file ID is required.');
		const observedAt = this.now();
		const descriptor = async () => {
			try { return await transport.retention(id, signal, !!binding); }
			catch (error) {
				this.lease.assertCurrent(); signal.throwIfAborted();
				// Only the canonical owned descriptor is an access decision. A
				// failed byte fetch or expired session does not revoke device work.
				if ([403,404,410].includes(Number((error as any)?.status))) {
					await this.tx('readwrite', tx => forgetAccountConversation(tx, id, this.now()), signal);
					throw this.accessRefused();
				}
				throw error;
			}
		};
		const snapshot = this.checkedRetention(await descriptor(), id, binding);
		const known = await this.tx('readonly', async tx => (await tx.list<FileRecord>(COLLECTION)).find(row => row.value.remote?.id === id)?.value);
		if (known?.deleteRequested || known?.cancelled || known?.cancelRequested) throw new WorkspaceError('FILE_DELETED', 'This file was deleted in this workspace.', 404);
		// Fresh descriptors reauthorize reuse of immutable stored bytes. The final
		// transaction rejects newer refusals before these bytes become readable.
		const bytes = known?.retainedKey === snapshot.cacheKey ? (await this.things.readFile(known.id, signal)).bytes : await transport.bytes(id, snapshot.cacheKey, snapshot.attachment.size, signal);
		if (!(bytes instanceof Uint8Array) || bytes.length !== snapshot.attachment.size) throw new WorkspaceError('INVALID_FILE_BYTES', 'File bytes were incomplete. Retry while online.', 502);
		const copy = Uint8Array.from(bytes), sha256 = await transferChecksum(copy);
		const final = this.checkedRetention(await descriptor(), id, binding);
		if (JSON.stringify(final) !== JSON.stringify(snapshot)) throw new WorkspaceError('FILE_CHANGED', 'The account file changed while being retained. Retry while online.', 409);
		this.lease.assertCurrent(); signal.throwIfAborted();
		const fallbackId = `local-file-account-${await transferChecksum(new TextEncoder().encode(id))}`;
		return { id, snapshot, copy, sha256, observedAt, fallbackId, binding };
	}
	private async commitRetention(tx: WorkspaceTransaction, prepared: Awaited<ReturnType<AccountFileSync['loadRetention']>>, signal: AbortSignal) {
		const { id, snapshot, copy, sha256, observedAt, fallbackId, binding } = prepared;
		signal.throwIfAborted();
		const refusals = await accountReadRefusals(tx);
		if ([id, binding?.targetId].some(target => target && (refusals.get(target)?.at ?? -1) >= observedAt)) throw this.accessRefused();
		// Upload completion or another tab can establish an alias while bytes are in flight.
		const alias = (await tx.list<FileRecord>(COLLECTION)).find(record => record.value.remote?.id === id)?.value;
		const localId = alias?.id || fallbackId;
		const prior = alias || await tx.get<FileRecord>(COLLECTION, localId), local = await tx.get<LocalAttachment>('things', localId);
		if (prior?.deleteRequested || prior?.cancelRequested || prior?.cancelled) throw new WorkspaceError('FILE_DELETED', 'This file was deleted in this workspace.', 404);
		if (prior && (!local || prior.remote?.id !== id || prior.request.purpose !== snapshot.purpose || local.localAttachment.purpose !== snapshot.purpose || prior.sha256 !== sha256 || (local.targetId || undefined) !== binding?.targetId || (prior.retainedKey && prior.retainedKey !== snapshot.cacheKey)))
			throw new WorkspaceError('FILE_CHANGED', 'Retained file bytes or identity changed. The device copy has been preserved.', 409);
		if (prior && local && ((prior.retainedObservedAt ?? -1) >= observedAt || (prior.retainedVersion && Date.parse(prior.retainedVersion) > Date.parse(snapshot.metadata.updatedAt)))) return { row: local, changed: false };
		let row = local || createLocalAttachment(localId, { id: 'bytes', targetId: localId, path: 'files/000000', name: snapshot.attachment.name, mime: snapshot.attachment.contentType, bytes: copy.length, sha256 }, new Date(this.now()).toISOString(), snapshot.purpose, binding?.order || 0, binding ? { targetId: binding.targetId } : snapshot.metadata.metadata.folderId ? { folderId: snapshot.metadata.metadata.folderId } : {});
		if (!local) row = { ...row, crystal: { ...snapshot.crystal } };
		const flagsChanged = (binding && row.localAttachment.order !== binding.order) || row.localAttachment.nsfw !== snapshot.attachment.nsfw || row.localAttachment.pending !== snapshot.attachment.pending;
		row = { ...row, localAttachment: { ...row.localAttachment, accountFileId: id, ...(binding ? { order: binding.order } : {}), nsfw: snapshot.attachment.nsfw ? true : undefined, pending: snapshot.attachment.pending }, ...(flagsChanged && local ? { revision: row.revision + 1, updatedAt: new Date(Math.max(this.now(), Date.parse(row.updatedAt) + 1)).toISOString() } : {}) };
		if (!local || flagsChanged || local.localAttachment.accountFileId !== id) await tx.put('things', row.id, row);
		if (!local) await tx.putBytes(row.id, copy);
		await this.metadata.remember(tx, row, snapshot.metadata);
		await this.putRecord(tx, { ...(prior || { id: row.id, source: 'account' as const, request: { filename: snapshot.attachment.name, contentType: snapshot.attachment.contentType, sizeBytes: copy.length, purpose: snapshot.purpose }, sha256, state: 'synced' as const, phase: 'complete' as const, uploaded: [], attempts: 0, retryAt: 0 }), remote: snapshot.attachment, retainedKey: snapshot.cacheKey, retainedVersion: snapshot.metadata.updatedAt, retainedObservedAt: observedAt });
		const next = (await tx.get<LocalAttachment>('things', row.id))!;
		return { row: next, changed: !local || next.revision !== local.revision || [id, binding?.targetId].some(target => !!target && (refusals.get(target)?.at ?? -1) >= (prior?.retainedObservedAt ?? 0)) };
	}
	/** Retain only bytes disclosed by the verified owned-file transport. The
	 * descriptor is checked again after reading; no upload intent is invented. */
	async retain(transport: AccountFileRetentionTransport, id: string, signal = new AbortController().signal) {
		this.lease.assertCurrent(); signal.throwIfAborted();
		let operation = this.retaining.get(id);
		if (!operation) {
			if (this.retaining.size >= 3) throw new WorkspaceError('FILE_RETENTION_BUSY', 'Other files are being saved on this device. Retry shortly.', 503);
			operation = accountSyncDeadline(async child => {
				const prepared = await this.loadRetention(transport, id, child);
				return this.tx('readwrite', tx => this.commitRetention(tx, prepared, child), child);
			}, signal).finally(() => { this.retaining.delete(id); });
			this.retaining.set(id, operation);
		}
		const result = await operation; this.lease.assertCurrent(); signal.throwIfAborted(); return result;
	}
	private retainingPost = false;
	/** Fetch a complete owned binding before admitting anything. The admission
	 * callback runs inside the parent's conditional cache transaction. */
	async retainPost<T>(transport: AccountFileRetentionTransport, input: { id: string; thingtime: string[]; attachments?: unknown[] }, commitParent: (admit: (tx: WorkspaceTransaction) => Promise<void>) => Promise<T>, signal = new AbortController().signal) {
		if (this.retainingPost) throw new WorkspaceError('FILE_RETENTION_BUSY', 'Another post is being saved on this device. Retry shortly.', 503);
		const attachments = input.attachments?.map(normalizePublicAttachment);
		if (!input.thingtime.some(kind => ['post','comment'].includes(kind)) || !attachments || attachments.length > 200 || attachments.some(file => !file || file.url) || new Set(attachments.map(file => file?.id)).size !== attachments.length || attachments.reduce((sum, file) => sum + (file?.size || 0), 0) > WORKSPACE_LIMITS.bytes)
			throw new WorkspaceError('INVALID_POST_RETENTION', 'This post needs its complete stored-file binding.', 409);
		this.retainingPost = true;
		try {
			const prepared = await accountSyncDeadline(async child => {
				const result: Awaited<ReturnType<AccountFileSync['loadRetention']>>[] = [];
				let total = 0;
				for (const [order, file] of attachments.entries()) {
					const retained = await this.loadRetention(transport, file!.id, child, { targetId: input.id, purpose: input.thingtime.includes('comment') ? 'comment' : 'post', order });
					total += retained.copy.length;
					if (total > WORKSPACE_LIMITS.bytes) throw new WorkspaceError('LOCAL_QUOTA', 'The post files exceed this device workspace limit.', 413);
					result.push(retained);
				}
				return result;
			}, signal);
			return await commitParent(async (tx: WorkspaceTransaction) => {
				this.lease.assertCurrent(); signal.throwIfAborted();
				const ids = new Set(prepared.map(file => file.id));
				const records = new Map((await tx.list<FileRecord>(COLLECTION)).map(row => [row.value.id, row.value]));
				for (const { value: row } of await tx.list<LocalThing>('things')) if (isLocalAttachment(row) && row.targetId === input.id && !ids.has(records.get(row.id)?.remote?.id || '')) {
					const record = records.get(row.id), metadata = await tx.get<{ state: string }>('account-file-metadata', row.id);
					if (!record?.remote || record.state !== 'synced' || record.deleteRequested || record.cancelRequested || (metadata && metadata.state !== 'synced')) throw new WorkspaceError('FILE_CHANGED', 'Device file changes must finish or be reviewed before refreshing the post.', 409);
					await tx.deleteBytes(row.id); await tx.delete('things', row.id); await tx.delete(COLLECTION, row.id); await this.metadata.discardUnuploaded(tx, row.id);
				}
				for (const file of prepared) await this.commitRetention(tx, file, signal);
			});
		} finally { this.retainingPost = false; }
	}

	/** Device library and upload aliases come from one scoped snapshot. Closed
	 * receipts suppress their remote alias without revealing recovery bytes. */
	async library(includeBound = false) {
		return this.tx('readonly', async tx => {
			const records = new Map((await tx.list<FileRecord>(COLLECTION)).map(({value}) => [value.id, value]));
			const things = (await tx.list<LocalAttachment>('things')).map(({value}) => value).filter(row => {
				const record = records.get(row.id);
				return libraryFileVisible(row, record) || (includeBound && isLocalAttachment(row) && !!row.targetId && ['post','comment'].includes(row.localAttachment.purpose) && !!record && !record.cancelled && !record.cancelRequested && !record.deleteRequested);
			});
			const visible = new Set(things.map(row => row.id));
			const aliases = new Map<string, string | null>();
			for (const record of records.values()) if ((isStandaloneAttachmentPurpose(record.request.purpose) || (includeBound && ['post','comment'].includes(record.request.purpose))) && record.remote) aliases.set(record.remote.id, visible.has(record.id) ? record.id : null);
			return { things, aliases };
		});
	}

	async views(ids: string[]) {
		if (ids.length > 200) throw new WorkspaceError('INVALID_IDS', 'Choose up to 200 files.');
		return this.tx('readonly', async tx => {
			const result: LocalAttachment[] = [];
			for (const id of ids) {
				if (!id.startsWith('local-file-')) continue;
				const row = await tx.get<LocalAttachment>('things', id), record = await tx.get<FileRecord>(COLLECTION, id);
				if (row && libraryFileVisible(row, record)) result.push(row);
			}
			return result;
		});
	}

	async assertFileReadable(id: string, signal?: AbortSignal) {
		this.lease.assertCurrent(); signal?.throwIfAborted();
		const readable = await this.tx('readonly', async tx => {
			const row = await tx.get<LocalAttachment>('things', id), record = await tx.get<FileRecord>(COLLECTION, id);
			if (!row || !isLocalAttachment(row) || !record || record.cancelled || record.cancelRequested || record.deleteRequested) return false;
			if (record.source === 'account') {
				const refusals = await accountReadRefusals(tx);
				if ([record.remote?.id, row.targetId].some(target => target && (refusals.get(target)?.at ?? -1) >= (record.retainedObservedAt ?? 0))) throw this.accessRefused();
			}
			if (libraryFileVisible(row, record)) return true;
			// Editor drafts and bound post files use the same scoped bytes. A
			// refused/deleted parent must not leave its files readable through a URL.
			return ['post','comment'].includes(record.request.purpose) && (!row.targetId || !!await tx.get('things', row.targetId));
		});
		if (!readable) throw new WorkspaceError('NOT_FOUND', 'File is not in this workspace.', 404);
		this.lease.assertCurrent(); signal?.throwIfAborted();
	}

	async readFile(id: string, signal?: AbortSignal) {
		await this.assertFileReadable(id, signal);
		const result = await this.things.readFile(id, signal);
		await this.assertFileReadable(id, signal);
		this.lease.assertCurrent(); signal?.throwIfAborted(); return result;
	}

	async status() {
		const metadata = new Map((await this.metadata.status()).map(row => [row.id, row]));
		return this.tx('readonly', async (tx) =>
			(await tx.list<FileRecord>(COLLECTION)).filter(({ value }) => !value.cancelled).map(({ value }) => ({
				id: value.id,
				name: value.request.filename,
				state: value.state === 'synced' ? metadata.get(value.id)?.state || value.state : value.state,
				phase: value.deleteRequested ? 'delete' as const : value.cancelRequested ? 'cancel' as const : value.phase,
				error: value.state === 'synced' ? metadata.get(value.id)?.error : value.error,
				retryAt: value.state === 'synced' ? metadata.get(value.id)?.retryAt || 0 : value.retryAt,
				canCancel: isStandaloneAttachmentPurpose(value.request.purpose) && !value.remote && !value.cancelRequested && !value.deleteRequested,
				remoteId: value.remote?.id
			}))
		);
	}
	private async finishCancellation(tx: WorkspaceTransaction, row: FileRecord) {
		await tx.deleteBytes(row.id);
		await tx.delete('things', row.id);
		await this.metadata.discardUnuploaded(tx, row.id);
		await this.putRecord(tx, { ...row, deletingLocal: undefined, deleteVersion: undefined, cancelled: true, cancelRequested: true, state: 'synced', claim: undefined, error: undefined, retryAt: 0 });
	}
	/** Discard an unsubmitted editor selection only while no remote request can exist. */
	async discardSelection(id: string) {
		return this.tx('readwrite', async tx => {
			const record = await tx.get<FileRecord>(COLLECTION, id), local = await tx.get<LocalAttachment>('things', id);
			if (!record || record.cancelled) return;
			if (!local || !isLocalAttachment(local) || !['post','comment'].includes(record.request.purpose) || local.targetId || local.localAttachment.draftId || record.started !== false || record.remote || record.claim)
				throw new WorkspaceError('BOUND_UPLOAD', 'Remove this file through its owning editor.', 409);
			await this.finishCancellation(tx, record);
		});
	}
	/** Records intent offline. Ambiguous uploads keep device bytes until the
	 * account acknowledges a durable fence; finalized files require review. */
	async cancel(id: string) {
		return this.tx('readwrite', async tx => {
			const row = await tx.get<FileRecord>(COLLECTION, id);
			if (!row) throw new WorkspaceError('MISSING_UPLOAD', 'This workspace has no matching upload.', 404);
			if (row.cancelled) return;
			const local = await tx.get<LocalAttachment>('things', id);
			if (!isStandaloneAttachmentPurpose(row.request.purpose) || local?.targetId || local?.localAttachment.draftId) throw new WorkspaceError('BOUND_UPLOAD', 'Remove this upload through its owning editor.', 409);
			if (row.remote) throw new WorkspaceError('UPLOAD_FINALIZED', 'This file finished uploading. Review it before deleting.', 409);
			if (row.started === false) return this.finishCancellation(tx, row);
			await this.putRecord(tx, { ...row, cancelRequested: true, state: 'pending', claim: undefined, error: undefined, retryAt: 0 });
		});
	}
	/** Commit deletion on the device immediately. Bytes and the removed snapshot
	 * remain private recovery data until the server's replay fence is confirmed. */
	async remove(id: string) {
		await this.tx('readwrite', async tx => {
			const row = await tx.get<FileRecord>(COLLECTION, id);
			if (!row) throw new WorkspaceError('MISSING_UPLOAD', 'This workspace has no matching file.', 404);
			if (row.cancelled || row.deleteRequested) return;
			const local = await tx.get<LocalAttachment>('things', id);
			if (!local || !isStandaloneAttachmentPurpose(row.request.purpose) || local.targetId || local.localAttachment.draftId)
				throw new WorkspaceError('BOUND_UPLOAD', 'Remove this file through its owning editor.', 409);
			if (!row.remote) throw new WorkspaceError('UPLOAD_UNFINISHED', 'Cancel the unfinished upload instead.', 409);
			await tx.delete('things', id);
			await this.putRecord(tx, { ...row, deleteRequested: true, deletingLocal: local, state: 'pending', claim: undefined, error: undefined, retryAt: 0 });
		});
	}
	/** Removing bound content finishes on this device. A pending immutable post
	 * write may still mention the file, so the upload/deletion worker settles
	 * that write before deleting the account object and releasing recovery bytes. */
	async removeBound(id: string, targetId: string) {
		await this.tx('readwrite', async tx => {
			const record = await tx.get<FileRecord>(COLLECTION, id);
			if (!record || !['post','comment'].includes(record.request.purpose)) throw new WorkspaceError('MISSING_UPLOAD', 'This workspace has no matching post file.', 404);
			if (record.cancelled) return;
			if (record.deleteRequested) { if (record.deletingLocal?.targetId !== targetId) throw new WorkspaceError('BOUND_UPLOAD', 'Select the file in its owning editor.', 409); return; }
			const local = await tx.get<LocalAttachment>('things', id), parent = await tx.get<LocalThing>('things', targetId);
			if (!local || local.targetId !== targetId || local.localAttachment.draftId || !parent?.thingtime.includes('post')) throw new WorkspaceError('BOUND_UPLOAD', 'Select the file in its owning editor.', 409);
			if (record.started === false && !record.remote && !record.claim) return this.finishCancellation(tx, record);
			await tx.delete('things', id);
			await this.putRecord(tx, { ...record, deleteRequested: true, deletingLocal: local, state: record.claim ? record.state : 'pending', error: undefined, retryAt: 0 });
		});
	}
	async inspectDeletion(transport: FileMetadataTransport, id: string, signal = new AbortController().signal) {
		const row = await this.tx('readonly', tx => tx.get<FileRecord>(COLLECTION, id));
		if (!row?.deleteRequested || row.state !== 'conflict' || !row.remote || !row.deletingLocal)
			throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'Review this deletion again.', 409);
		const remote = this.metadata.checked(await accountSyncDeadline(child => transport.get(row.remote!.id, child), signal), row.remote.id);
		this.lease.assertCurrent(); signal.throwIfAborted();
		return { id, remote, local: fileMetadata(row.deletingLocal), localRevision: row.deletingLocal.revision, operationVersion: row.deleteVersion || null };
	}
	async resolveDeletion(transport: FileMetadataTransport, choice: { id: string; remoteUpdatedAt: string; localRevision: number; operationVersion: string | null; keep: 'file' | 'delete' }, signal = new AbortController().signal) {
		if (!['file', 'delete'].includes(choice.keep)) throw new WorkspaceError('INVALID_CONFLICT_CHOICE', 'Choose whether to keep or delete this file.');
		const review = await this.inspectDeletion(transport, choice.id, signal);
		if (review.remote.updatedAt !== choice.remoteUpdatedAt || review.localRevision !== choice.localRevision || review.operationVersion !== choice.operationVersion)
			throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'The file changed. Review it again.', 409);
		await this.tx('readwrite', async tx => {
			signal.throwIfAborted();
			const row = await tx.get<FileRecord>(COLLECTION, choice.id);
			if (!row?.deleteRequested || row.state !== 'conflict' || !row.deletingLocal || row.deletingLocal.revision !== choice.localRevision || (row.deleteVersion || null) !== choice.operationVersion)
				throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'The deletion changed. Review it again.', 409);
			if (choice.keep === 'delete') {
				await this.putRecord(tx, { ...row, deleteVersion: choice.remoteUpdatedAt, state: 'pending', claim: undefined, retryAt: 0, error: undefined });
			} else {
				const local = row.deletingLocal;
				if (local.targetId && !await tx.get('things', local.targetId)) throw new WorkspaceError('MISSING_PARENT', 'Restore the owning post before keeping this file.', 409);
				await this.putRecord(tx, { ...row, deleteRequested: undefined, deletingLocal: undefined, deleteVersion: undefined, state: 'synced', claim: undefined, retryAt: 0, error: undefined });
				await tx.put('things', row.id, local);
			}
		});
	}
	async remoteId(id: string) {
		return this.tx('readonly', async (tx) => { const row = await tx.get<FileRecord>(COLLECTION, id); return row && !row.deleteRequested && !row.cancelled ? row.remote?.id || null : null; });
	}
	async retry(id: string) {
		const deleting = await this.tx('readonly', async tx => (await tx.get<FileRecord>(COLLECTION, id))?.deleteRequested);
		if (!deleting) await this.metadata.retry(id);
		return this.tx('readwrite', async (tx) => {
			const row = await tx.get<FileRecord>(COLLECTION, id);
			if (!row || row.state === 'synced' || (row.claim && row.claim.expiresAt > this.now())) return;
			if (row.state === 'conflict') throw new WorkspaceError('SYNC_CONFLICT', 'Review this deletion before retrying.', 409);
			await this.putRecord(tx, { ...row, state: 'pending', retryAt: 0, error: undefined });
		});
	}
	private async update(id: string, token: string, change: (row: FileRecord) => FileRecord) {
		return this.tx('readwrite', async (tx) => {
			const row = await tx.get<FileRecord>(COLLECTION, id);
			if (!row || row.claim?.token !== token)
				throw new WorkspaceError('SYNC_CLAIM', 'File synchronization changed; the device file is preserved.', 409);
			const next = change(row);
			await this.putRecord(tx, next);
			return next;
		});
	}
	async sync(transport: AccountFileTransport & Partial<FileMetadataTransport>, signal = new AbortController().signal, maxFiles = 3, folderReady: (id: string) => Promise<boolean> = async () => false) {
		let completed = 0;
		for (let attempt = 0; attempt < Math.min(10, Math.max(0, maxFiles)); attempt++) {
			this.lease.assertCurrent();
			signal.throwIfAborted();
			const claimed = await this.tx('readwrite', async (tx) => {
				let row: FileRecord | undefined;
				for (const { value } of await tx.list<FileRecord>(COLLECTION)) {
					if (!['pending','syncing'].includes(value.state) || value.retryAt > this.now() || (value.claim && value.claim.expiresAt > this.now())) continue;
					// Editor selections are device drafts. Submission binds them locally;
					// only then may this queue create an account upload. Once started,
					// finish the same request even if a newer editor removes the file.
					if (value.deleteRequested && value.deletingLocal?.targetId && (await tx.get<any>('thing-sync', value.deletingLocal.targetId))?.pending) continue;
					if (!value.deleteRequested && value.started === false && ['post','comment'].includes(value.request.purpose)) {
						const local = await tx.get<LocalAttachment>('things', value.id);
						if (!local?.targetId) continue;
					}
					row = value; break;
				}
				if (!row) return null;
				const next = { ...row, state: 'syncing' as const, claim: { token: this.uuid(), expiresAt: this.now() + CLAIM_MS } };
				await this.putRecord(tx, next);
				return next;
			});
			if (!claimed) break;
			const controller = new AbortController(),
				abort = () => controller.abort(),
				off = this.lease.onInvalidate(abort);
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort();
			const timer = setTimeout(abort, ATTEMPT_MS),
				token = claimed.claim.token;
			// A deadline races even a broken transport which ignores AbortSignal. Late
			// results can never change this attempt's durable state or another tab's claim.
			const run = async <T>(task: () => Promise<T>): Promise<T> => {
				controller.signal.throwIfAborted();
				this.lease.assertCurrent();
				let stop: () => void = () => {};
				const cancelled = new Promise<never>((_, reject) => {
					stop = () => reject(new WorkspaceError('UPLOAD_INTERRUPTED', 'File upload interrupted; device bytes are preserved.', 503));
					controller.signal.addEventListener('abort', stop, { once: true });
				});
				try {
					const result = await Promise.race([Promise.resolve().then(async () => {
						await this.tx('readonly', async tx => {
							if ((await tx.get<FileRecord>(COLLECTION, claimed.id))?.claim?.token !== token) throw new WorkspaceError('SYNC_CLAIM', 'File synchronization changed.', 409);
						});
						controller.signal.throwIfAborted(); this.lease.assertCurrent();
						return task();
					}), cancelled]);
					controller.signal.throwIfAborted();
					this.lease.assertCurrent();
					return result;
				} finally {
					controller.signal.removeEventListener('abort', stop);
				}
			};
			let phase = claimed.phase;
			try {
				if (claimed.deleteRequested && claimed.remote) {
					if (!transport.remove || !transport.get || !claimed.remote || !claimed.deletingLocal)
						throw new WorkspaceError('DELETION_UNAVAILABLE', 'The account cannot confirm file deletion yet.', 503);
					let expectedUpdatedAt = claimed.deleteVersion;
					if (!expectedUpdatedAt) {
						try {
							const remote = this.metadata.checked(await run(() => transport.get!(claimed.remote!.id, controller.signal)), claimed.remote.id);
							const known = await this.tx('readonly', tx => this.metadata.matchesDeletion(tx, claimed.deletingLocal!, remote));
							if (!known)
								throw new WorkspaceError('FILE_DELETE_CONFLICT', 'File details changed. Review before deleting.', 409);
							expectedUpdatedAt = remote.updatedAt;
						} catch (error) {
							if ((error as any)?.status !== 404) throw error;
							// Absence is not an acknowledgement. The durable DELETE must
							// still fence the original request; any live version refuses.
							expectedUpdatedAt = new Date(0).toISOString();
						}
						await this.update(claimed.id, token, row => ({ ...row, deleteVersion: expectedUpdatedAt }));
					}
					if (claimed.source !== 'account' && !claimed.request.requestId) throw new WorkspaceError('INVALID_DELETION', 'The file deletion identity is missing.', 409);
					const deletion: Parameters<NonNullable<AccountFileTransport['remove']>>[0] = claimed.source === 'account'
						? { id: claimed.remote.id, expectedUpdatedAt, retainReceipt: true, ...(claimed.deletingLocal.targetId ? { targetId: claimed.deletingLocal.targetId } : {}) }
						: { id: claimed.remote.id, expectedUpdatedAt, requestId: claimed.request.requestId!, ...(claimed.deletingLocal.targetId ? { targetId: claimed.deletingLocal.targetId } : {}) };
					const result = await run(() => transport.remove!(deletion, controller.signal));
					if (result?.deleted !== true || typeof result.deferred !== 'boolean') throw new WorkspaceError('INVALID_DELETION', 'The account did not confirm durable deletion.', 502);
					await this.tx('readwrite', async tx => {
						const row = await tx.get<FileRecord>(COLLECTION, claimed.id);
						if (!row || row.claim?.token !== token) throw new WorkspaceError('SYNC_CLAIM', 'File synchronization changed.', 409);
						await this.finishCancellation(tx, row);
					});
					completed++; continue;
				}
				if (claimed.source === 'account' || !claimed.request.requestId) throw new WorkspaceError('INVALID_UPLOAD', 'An existing account file cannot be uploaded again.', 409);
				const requestId = claimed.request.requestId;
				if (claimed.cancelRequested) {
					if (!transport.cancel) throw new WorkspaceError('CANCELLATION_UNAVAILABLE', 'The account cannot confirm upload cancellation yet.', 503);
					const result = await run(() => transport.cancel!(requestId, controller.signal));
					if (result?.cancelled !== true || typeof result.deferred !== 'boolean') throw new WorkspaceError('INVALID_CANCELLATION', 'The account did not confirm durable cancellation.', 502);
					await this.tx('readwrite', async tx => {
						const row = await tx.get<FileRecord>(COLLECTION, claimed.id);
						if (!row || row.claim?.token !== token) throw new WorkspaceError('SYNC_CLAIM', 'File synchronization changed.', 409);
						await this.finishCancellation(tx, row);
					});
					completed++; continue;
				}
				const { row, bytes } = claimed.deleteRequested && claimed.deletingLocal
					? await this.tx('readonly', async tx => { const bytes = await tx.getBytes(claimed.id); if (!bytes) throw new WorkspaceError('MISSING_LOCAL_FILE', 'Recovery bytes are missing.', 404); return { row: claimed.deletingLocal!, bytes }; }, controller.signal)
					: await this.things.readFile(claimed.id, controller.signal);
				if (
					row.localAttachment.sha256 !== claimed.sha256 ||
					bytes.length !== claimed.request.sizeBytes ||
					(await transferChecksum(bytes)) !== claimed.sha256
				)
					throw new WorkspaceError('FILE_CHANGED', 'Device file bytes changed. Choose the file again.', 409);
				let current: FileRecord = claimed;
				if (phase === 'start') {
					current = await this.update(current.id, token, row => ({ ...row, started: true }));
					const plan = await run(() => transport.start({ ...current.request, requestId }, controller.signal));
					if (
						!plan ||
						typeof plan.id !== 'string' ||
						!plan.id ||
						plan.id.length > 200 ||
						!Number.isSafeInteger(plan.partSizeBytes) ||
						plan.partSizeBytes < 1 ||
						!Number.isSafeInteger(plan.partCount) ||
						plan.partCount < 1 ||
						plan.partCount > 100 ||
						Math.ceil(bytes.length / plan.partSizeBytes) !== plan.partCount
					)
						throw new WorkspaceError('INVALID_UPLOAD_PLAN', 'The account returned an invalid upload plan.', 502);
					// Persist identity before sending any bytes or attempting completion.
					current = await this.update(current.id, token, (row) => ({
						...row,
						plan: { id: plan.id, partSizeBytes: plan.partSizeBytes, partCount: plan.partCount },
						phase: plan.state === 'ready' ? 'complete' : 'upload'
					}));
					phase = current.phase;
				}
				if (!current.plan) throw new WorkspaceError('MISSING_UPLOAD_PLAN', 'Upload details are missing. Device bytes are preserved.', 409);
				if (phase === 'upload') {
					const plan = current.plan;
					for (let first = 1; first <= plan.partCount; first += 3) {
						const uploaded = new Set(current.uploaded);
						const numbers = Array.from({ length: Math.min(3, plan.partCount - first + 1) }, (_, i) => first + i).filter((n) => !uploaded.has(n));
						if (!numbers.length) continue;
						const parts = await Promise.all(
							numbers.map(async (partNumber) => {
								const range = multipartPartRange(partNumber, plan.partSizeBytes, bytes.length);
								const body = bytes.slice(range.start, range.end);
								return { partNumber, body, checksumSha256: await checksumBase64(body) };
							})
						);
						const signed = await run(() =>
							transport.parts(
								plan.id,
								parts.map(({ partNumber, checksumSha256 }) => ({ partNumber, checksumSha256 })),
								controller.signal
							)
						);
						if (
							!Array.isArray(signed) ||
							signed.length !== numbers.length ||
							new Set(signed.map((part) => part.partNumber)).size !== numbers.length ||
							signed.some((part) => !numbers.includes(part.partNumber))
						)
							throw new WorkspaceError('INVALID_UPLOAD_PARTS', 'The account returned invalid upload parts.', 502);
						// Sequential PUTs bound memory/network use. Each acknowledged part survives
						// restart; a lost acknowledgement may only resend the identical bytes.
						for (const part of parts) {
							await run(() => transport.put(signed.find((s) => s.partNumber === part.partNumber)!, part.body, controller.signal));
							current = await this.update(current.id, token, (row) => ({ ...row, uploaded: [...new Set([...row.uploaded, part.partNumber])] }));
						}
					}
					current = await this.update(current.id, token, (row) => ({ ...row, phase: 'complete' }));
					phase = 'complete';
				}
				const response = await run(() => transport.complete(current.plan!.id, controller.signal));
				const remote = normalizePublicAttachment(response);
				if (!remote || remote.id !== current.plan!.id || remote.size !== current.request.sizeBytes || remote.name !== current.request.filename)
					throw new WorkspaceError('UPLOAD_IDENTITY', 'The completed file did not match this upload.', 409);
				await this.update(current.id, token, (row) => ({
					...row,
					state: row.deleteRequested ? 'pending' : 'synced',
					remote,
					claim: undefined,
					attempts: 0,
					retryAt: 0,
					error: undefined
				}));
				completed++;
			} catch (error) {
				this.lease.assertCurrent();
				const status = Number((error as any)?.status),
					retryPhase = phase === 'complete' ? attachmentCompleteRetryPhase(error) : null;
				await this.update(claimed.id, token, (row) => ({
					...row,
					state: row.deleteRequested && !!row.remote && status === 409 ? 'conflict' : [400, 401, 403, 404, 410, 413, 422].includes(status) || (status === 409 && (error as any)?.retryable !== true) ? 'error' : 'pending',
					claim: undefined,
					attempts: row.attempts + 1,
					retryAt: this.now() + Math.max(Math.min(60_000, 1000 * 2 ** Math.min(row.attempts, 6)), Number((error as any)?.retryAfterMs) || 0),
					error: row.deleteRequested ? 'Deletion needs review or retry; recovery bytes remain on this device.' : row.cancelRequested ? 'Cancellation needs attention; device bytes are retained. A completed account file requires reviewed deletion.' : 'File is saved on this device; account upload needs attention.',
					...(!row.cancelRequested && !row.deleteRequested && retryPhase === 'upload' ? { phase: 'upload' as const, uploaded: [] } : {})
				})).catch((failure) => {
					if ((failure as any)?.code !== 'SYNC_CLAIM') throw failure;
				});
			} finally {
				clearTimeout(timer);
				off();
				signal.removeEventListener('abort', abort);
			}
		}
		if (transport.get && transport.annotate && transport.move) {
			completed += (await this.metadata.sync(transport as AccountFileTransport & FileMetadataTransport, id => this.remoteId(id), folderReady, signal)).completed;
		}
		return { completed };
	}
}
