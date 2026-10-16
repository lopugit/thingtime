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
	constructor(
		private db: WorkspaceDatabase,
		readonly scope: AccountScope,
		private lease: WorkspaceLease,
		private now = () => Date.now(),
		private uuid = () => crypto.randomUUID()
	) {
		if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous files never synchronize', 403);
		this.things = new LocalThings(
			db,
			scope,
			lease,
			[],
			() => new Date(now()).toISOString(),
			uuid,
			undefined,
			(tx, row) => this.enqueue(tx, row)
		);
	}
	private tx<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) {
		return this.db.transaction(this.scope, mode, this.lease, run);
	}
	private async enqueue(tx: WorkspaceTransaction, row: LocalAttachment) {
		// Upload completion creates a root file. Refuse placement until the file
		// adapter can also synchronize that relationship instead of dropping it.
		if (row.folderId) throw new WorkspaceError('LOCAL_OPERATION_UNAVAILABLE', 'Account file folder placement is not available in this adapter yet.');
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
			state: 'pending',
			phase: 'start',
			uploaded: [],
			attempts: 0,
			retryAt: 0
		};
		await tx.put(COLLECTION, row.id, record);
	}
	async status() {
		return this.tx('readonly', async (tx) =>
			(await tx.list<FileRecord>(COLLECTION)).map(({ value }) => ({
				id: value.id,
				name: value.request.filename,
				state: value.state,
				phase: value.phase,
				error: value.error,
				retryAt: value.retryAt,
				remoteId: value.remote?.id
			}))
		);
	}
	async remoteId(id: string) {
		return this.tx('readonly', async (tx) => (await tx.get<FileRecord>(COLLECTION, id))?.remote?.id || null);
	}
	async retry(id: string) {
		return this.tx('readwrite', async (tx) => {
			const row = await tx.get<FileRecord>(COLLECTION, id);
			if (!row || row.state === 'synced' || (row.claim && row.claim.expiresAt > this.now())) return;
			await tx.put(COLLECTION, id, { ...row, state: 'pending', retryAt: 0, error: undefined });
		});
	}
	private async update(id: string, token: string, change: (row: FileRecord) => FileRecord) {
		return this.tx('readwrite', async (tx) => {
			const row = await tx.get<FileRecord>(COLLECTION, id);
			if (!row || row.claim?.token !== token)
				throw new WorkspaceError('SYNC_CLAIM', 'File synchronization changed; the device file is preserved.', 409);
			const next = change(row);
			await tx.put(COLLECTION, id, next);
			return next;
		});
	}
	async sync(transport: AccountFileTransport, signal = new AbortController().signal, maxFiles = 3) {
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
				await tx.put(COLLECTION, row.id, next);
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
					const result = await Promise.race([Promise.resolve().then(task), cancelled]);
					controller.signal.throwIfAborted();
					this.lease.assertCurrent();
					return result;
				} finally {
					controller.signal.removeEventListener('abort', stop);
				}
			};
			let phase = claimed.phase;
			try {
				const { row, bytes } = await this.things.readFile(claimed.id, controller.signal);
				if (
					row.localAttachment.sha256 !== claimed.sha256 ||
					bytes.length !== claimed.request.sizeBytes ||
					(await transferChecksum(bytes)) !== claimed.sha256
				)
					throw new WorkspaceError('FILE_CHANGED', 'Device file bytes changed. Choose the file again.', 409);
				let current: FileRecord = claimed;
				if (phase === 'start') {
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
					error: 'File is saved on this device; account upload needs attention.',
					...(retryPhase === 'upload' ? { phase: 'upload' as const, uploaded: [] } : {})
				})).catch((failure) => {
					if ((failure as any)?.code !== 'SYNC_CLAIM') throw failure;
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
