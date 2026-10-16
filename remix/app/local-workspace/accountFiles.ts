import { AccountFileMetadata, type FileMetadataTransport } from './accountFileMetadata';
import { normalizePublicAttachment, multipartPartRange, attachmentCompleteRetryPhase } from '../components/Attachments/attachmentUiCore';
import type { PublicAttachment, SignedUploadPart } from '../components/Attachments/attachmentTypes';
import { transferChecksum } from '../utils/thingTransfer/archive';
import { LocalThings } from './things';
import type { LocalAttachment } from './attachments';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import type { SyncState } from './accountSync';

const COLLECTION = 'account-files';
const CLAIM_MS = 60_000;
const ATTEMPT_MS = 45_000;
type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
export type AccountFileRequest = {
	requestId: string;
	filename: string;
	contentType: string;
	sizeBytes: number;
	purpose: 'file' | 'post' | 'comment';
};
export type AccountFilePlan = { id: string; partSizeBytes: number; partCount: number; state?: 'ready' };
type FileRecord = {
	id: string;
	request: AccountFileRequest;
	sha256: string;
	controlReserve?: string;
	started?: boolean;
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
export type AccountFileTransport = {
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
	private tx<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) {
		return this.db.transaction(this.scope, mode, this.lease, run);
	}
	private putRecord(tx: WorkspaceTransaction, row: FileRecord) {
		// Reserve bounded control space at admission, so a full workspace can
		// still record cancellation, claim it, retry and acknowledge it. Account
		// response/part data remain separately charged at their actual size.
		const { state, phase, started, cancelRequested, cancelled, attempts, retryAt, error, claim } = row;
		const controls = JSON.stringify({ state, phase, started, cancelRequested, cancelled, attempts, retryAt, error, claim });
		const controlReserve = ' '.repeat(Math.max(0, 1024 - new TextEncoder().encode(controls).length));
		return tx.put(COLLECTION, row.id, { ...row, controlReserve });
	}
	private async enqueue(tx: WorkspaceTransaction, row: LocalAttachment, previous?: LocalAttachment) {
		const existing = await tx.get<FileRecord>(COLLECTION, row.id);
		if (existing?.cancelRequested || existing?.cancelled) throw new WorkspaceError('UPLOAD_CANCELLED', 'This upload request was cancelled. Choose the file again with a new request.', 409);
		await this.metadata.enqueue(tx, row, previous);
		if (existing) return;
		const purpose = row.localAttachment.purpose,
			requestId = row.localAttachment.requestId;
		if (!requestId || !['file', 'post', 'comment'].includes(purpose))
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
	async status() {
		const metadata = new Map((await this.metadata.status()).map(row => [row.id, row]));
		return this.tx('readonly', async (tx) =>
			(await tx.list<FileRecord>(COLLECTION)).filter(({ value }) => !value.cancelled).map(({ value }) => ({
				id: value.id,
				name: value.request.filename,
				state: value.state === 'synced' ? metadata.get(value.id)?.state || value.state : value.state,
				phase: value.cancelRequested ? 'cancel' as const : value.phase,
				error: value.state === 'synced' ? metadata.get(value.id)?.error : value.error,
				retryAt: value.state === 'synced' ? metadata.get(value.id)?.retryAt || 0 : value.retryAt,
				canCancel: value.request.purpose === 'file' && !value.remote && !value.cancelRequested,
				remoteId: value.remote?.id
			}))
		);
	}
	private async finishCancellation(tx: WorkspaceTransaction, row: FileRecord) {
		await tx.deleteBytes(row.id);
		await tx.delete('things', row.id);
		await this.metadata.discardUnuploaded(tx, row.id);
		await this.putRecord(tx, { ...row, cancelled: true, cancelRequested: true, state: 'synced', claim: undefined, error: undefined, retryAt: 0 });
	}
	/** Records intent offline. Ambiguous uploads keep device bytes until the
	 * account acknowledges a durable fence; finalized files require review. */
	async cancel(id: string) {
		return this.tx('readwrite', async tx => {
			const row = await tx.get<FileRecord>(COLLECTION, id);
			if (!row) throw new WorkspaceError('MISSING_UPLOAD', 'This workspace has no matching upload.', 404);
			if (row.cancelled) return;
			const local = await tx.get<LocalAttachment>('things', id);
			if (row.request.purpose !== 'file' || local?.targetId || local?.localAttachment.draftId) throw new WorkspaceError('BOUND_UPLOAD', 'Remove this upload through its owning editor.', 409);
			if (row.remote) throw new WorkspaceError('UPLOAD_FINALIZED', 'This file finished uploading. Review it before deleting.', 409);
			if (row.started === false) return this.finishCancellation(tx, row);
			await this.putRecord(tx, { ...row, cancelRequested: true, state: 'pending', claim: undefined, error: undefined, retryAt: 0 });
		});
	}
	async remoteId(id: string) {
		return this.tx('readonly', async (tx) => (await tx.get<FileRecord>(COLLECTION, id))?.remote?.id || null);
	}
	async retry(id: string) {
		await this.metadata.retry(id);
		return this.tx('readwrite', async (tx) => {
			const row = await tx.get<FileRecord>(COLLECTION, id);
			if (!row || row.state === 'synced' || (row.claim && row.claim.expiresAt > this.now())) return;
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
				const row = (await tx.list<FileRecord>(COLLECTION))
					.map((item) => item.value)
					.find(
						(row) => ['pending', 'syncing'].includes(row.state) && row.retryAt <= this.now() && (!row.claim || row.claim.expiresAt <= this.now())
					);
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
				if (claimed.cancelRequested) {
					if (!transport.cancel) throw new WorkspaceError('CANCELLATION_UNAVAILABLE', 'The account cannot confirm upload cancellation yet.', 503);
					const result = await run(() => transport.cancel!(claimed.request.requestId, controller.signal));
					if (result?.cancelled !== true || typeof result.deferred !== 'boolean') throw new WorkspaceError('INVALID_CANCELLATION', 'The account did not confirm durable cancellation.', 502);
					await this.tx('readwrite', async tx => {
						const row = await tx.get<FileRecord>(COLLECTION, claimed.id);
						if (!row || row.claim?.token !== token) throw new WorkspaceError('SYNC_CLAIM', 'File synchronization changed.', 409);
						await this.finishCancellation(tx, row);
					});
					completed++; continue;
				}
				const { row, bytes } = await this.things.readFile(claimed.id, controller.signal);
				if (
					row.localAttachment.sha256 !== claimed.sha256 ||
					bytes.length !== claimed.request.sizeBytes ||
					(await transferChecksum(bytes)) !== claimed.sha256
				)
					throw new WorkspaceError('FILE_CHANGED', 'Device file bytes changed. Choose the file again.', 409);
				let current: FileRecord = claimed;
				if (phase === 'start') {
					current = await this.update(current.id, token, row => ({ ...row, started: true }));
					const plan = await run(() => transport.start({ ...current.request }, controller.signal));
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
					state: 'synced',
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
					state: [400, 401, 403, 404, 410, 413, 422].includes(status) || (status === 409 && (error as any)?.retryable !== true) ? 'error' : 'pending',
					claim: undefined,
					attempts: row.attempts + 1,
					retryAt: this.now() + Math.max(Math.min(60_000, 1000 * 2 ** Math.min(row.attempts, 6)), Number((error as any)?.retryAfterMs) || 0),
					error: row.cancelRequested ? 'Cancellation needs attention; device bytes are retained. A completed account file requires reviewed deletion.' : 'File is saved on this device; account upload needs attention.',
					...(!row.cancelRequested && retryPhase === 'upload' ? { phase: 'upload' as const, uploaded: [] } : {})
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
