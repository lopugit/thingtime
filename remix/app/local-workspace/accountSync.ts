import { isLocalAttachment } from './attachments';
import { normalizePublicAttachment } from '../components/Attachments/attachmentUiCore';
import { postThingReferences } from '../components/Feed/postThingReferences';
import { accountReadRefusals, ACCOUNT_READ_COLLECTIONS } from './accountReadRevocation';
import { LocalThings, type LocalThing, type ThingWrite, type LocalFileMutation } from './things';
import { type WorkspaceDatabase, WorkspaceError, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import { snapshotTransferValue } from '../utils/thingTransfer/value';
import { aclFromVisibility, sanitizeAcl, visibilityFromAcl, isProtectedThingtime, validateThingtimeCrystal } from '../schemas/registry';

const WRITE_FIELDS = new Set(['thingtime', 'crystal', 'extended', 'tags', 'folderId', 'targetId', 'acl', 'visibility']);
/** Unsupported fields must use their complete dedicated adapter. Never accept
 * a partial write and report success after dropping attachments or controls. */
export const accountWriteSupported = (input: unknown, update = false): boolean =>
	!!input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).every(key =>
		WRITE_FIELDS.has(key) || (update && ['id', 'expectedUpdatedAt', 'replaceCrystal'].includes(key)));

type AccountScope = Extract<WorkspaceScope, { kind: 'account' }>;
export type SyncState = 'pending' | 'syncing' | 'conflict' | 'error' | 'synced';
export type AccountThingWrite = ThingWrite & { acl?: string[]; visibility?: string };
export type AccountThing = LocalThing & { author: { id: string }; acl: string[]; visibility: string; accountAttachmentIds?: string[] };
const LOCAL_KINDS = new Set(['data', 'folder', 'webpage', 'component', 'schema', 'action', 'post', 'comment']);
export const accountThingCanCache = (row: any): row is AccountThing => (!Array.isArray(row?.attachments) || row.attachments.length === 0) && Array.isArray(row?.thingtime) && row.thingtime.length > 0 && row.thingtime.every((kind: string) => LOCAL_KINDS.has(kind));
type FrozenWrite = { id: string; operationId: string; version: number; method: 'create' | 'update'; body: Record<string, unknown> };
type FrozenDelete = Omit<FrozenWrite, 'method'> & { method: 'delete' };
type SyncRecord = {
	id: string; state: SyncState; base: AccountThing | null; audience: { acl: string[]; visibility: string };
	/** Set only by atomic full-file retention or a confirmed local binding write. */
	postAttachmentIds?: string[];
	pending?: FrozenWrite | FrozenDelete; deleted?: Pick<LocalThing, 'id' | 'revision' | 'updatedAt'>; claim?: { token: string; expiresAt: number }; attempts: number; retryAt: number; error?: string;
};
export type AccountSyncTransport = {
	/** Must pin expected actor + data plane on every request, including reads. */
	get(id: string, signal: AbortSignal): Promise<AccountThing>;
	write(operation: Readonly<FrozenWrite>, signal: AbortSignal): Promise<AccountThing>;
	remove?(operation: Readonly<FrozenDelete>, signal: AbortSignal): Promise<void>;
};
type AccountContentFiles = {
	mutate: LocalFileMutation;
	prepare(tx: WorkspaceTransaction, row: LocalThing): Promise<(LocalThing & { attachmentIds?: string[] }) | null>;
	restore?: <T extends LocalThing>(tx: WorkspaceTransaction, row: T) => Promise<T>;
	removeBound?(tx: WorkspaceTransaction, id: string, targetId: string): Promise<void>;
	restoreParent?(tx: WorkspaceTransaction, targetId: string, attachmentIds: string[]): Promise<void>;
	prepareRemove?(tx: WorkspaceTransaction, targetId: string): Promise<boolean>;
};
const COLLECTION = 'thing-sync';
const DELETED_CONTENT = 'thing-deletions';
const CLAIM_MS = 60_000;
const REQUEST_MS = 20_000;
const contentFields = ['thingtime', 'crystal', 'extended', 'tags', 'folderId', 'targetId'] as const;
const writeContent = (row: LocalThing) => Object.fromEntries(contentFields.map(key => [key, row[key] ?? (key === 'folderId' || key === 'targetId' ? null : key === 'tags' ? [] : null)]));
const stable = (input: unknown): string => JSON.stringify(input, function (_key, value) {
	return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value;
});
const sameContent = (remote: AccountThing, operation: FrozenWrite) =>
	Object.entries(operation.body).filter(([key]) => !['shareId', 'id', 'expectedUpdatedAt', 'replaceCrystal'].includes(key))
		.every(([key, value]) => stable((key === 'attachmentIds' ? remote.accountAttachmentIds || [] : (remote as any)[key]) ?? (value === null ? null : undefined)) === stable(value));
export const accountSyncDeadline = async <T>(run: (signal: AbortSignal) => Promise<T>, parent: AbortSignal): Promise<T> => {
	const controller = new AbortController();
	const abort = () => controller.abort(parent.reason);
	parent.addEventListener('abort', abort, { once: true });
	if (parent.aborted) abort();
	let timer: ReturnType<typeof setTimeout>;
	const stopped = new Promise<never>((_, reject) => {
		const fail = () => reject(new WorkspaceError('SYNC_INTERRUPTED', 'Sync was interrupted; the same operation will be retried.', 503));
		controller.signal.addEventListener('abort', fail, { once: true });
		if (controller.signal.aborted) fail();
		timer = setTimeout(() => { controller.abort(); }, REQUEST_MS);
	});
	try { return await Promise.race([run(controller.signal), stopped]); }
	finally { clearTimeout(timer!); parent.removeEventListener('abort', abort); }
};

/** Durable account writes share the canonical Thing content and existing API.
 * The account scope is supplied by the root identity, never imported content.
 * No anonymous workspace can construct a sync queue. */
export class AccountThingSync {
	readonly things: LocalThings;
	constructor(private db: WorkspaceDatabase, readonly scope: AccountScope, private lease: WorkspaceLease,
		private now = () => Date.now(), private uuid = () => crypto.randomUUID(),
		private files?: AccountContentFiles) {
		if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous workspaces never sync', 403);
		this.things = new LocalThings(db, scope, lease, [], () => new Date(now()).toISOString(), uuid,
			(tx, row, previous, input) => this.enqueue(tx, row, previous, input as AccountThingWrite), files?.mutate, async (tx, id) => {
				const refusal = (await accountReadRefusals(tx)).get(id);
				for (const collection of ACCOUNT_READ_COLLECTIONS) {
					const row = await tx.get<{ post: unknown; at: number }>(collection, id);
					if (row?.post && (!refusal || row.at > refusal.at)) return true;
				}
				return false;
			});
	}
	private tx<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) { return this.db.transaction(this.scope, mode, this.lease, run); }
	private checked(input: AccountThing): AccountThing {
		if (!input || input.author?.id !== this.scope.ownerId || typeof input.id !== 'string' || !Number.isFinite(Date.parse(input.updatedAt)))
			throw new WorkspaceError('SYNC_IDENTITY', 'The remote Thing does not belong to this workspace', 409);
		const rawAttachments = (input as any).attachments;
		if (rawAttachments !== undefined && (!Array.isArray(rawAttachments) || rawAttachments.length > 4096)) throw new WorkspaceError('INVALID_SYNC_THING', 'Invalid account attachment receipt.', 502);
		const attachments = (rawAttachments || []).map(normalizePublicAttachment);
		if (attachments.some((file: unknown) => !file)) throw new WorkspaceError('INVALID_SYNC_THING', 'Invalid account attachment receipt.', 502);
		const checked = validateThingtimeCrystal(input.thingtime, snapshotTransferValue(input.crystal), { postAttachments: { hasAny: attachments.length > 0, hasVisual: attachments.some((file: any) => ['image','video'].includes(file.mediaKind)) } });
		if (checked.ok === false || isProtectedThingtime(input.thingtime)) throw new WorkspaceError('INVALID_SYNC_THING', 'This Thing requires its dedicated local adapter', 502);
		// Whitelist the cache projection. Never retain hidden-link bearer keys,
		// credentials, grants or arbitrary server envelope fields.
		return snapshotTransferValue({ id: input.id, thingtime: checked.thingtime, crystal: checked.crystal,
			extended: input.extended ?? null, tags: input.tags || [], folderId: input.folderId || null, targetId: input.targetId || null,
			createdAt: input.createdAt, updatedAt: input.updatedAt, revision: 1, ...(input.thingtime.includes('post') ? { accountAttachmentIds: attachments.map((file: any) => file.id) } : {}),
			author: { id: this.scope.ownerId }, acl: input.acl || ['tt:user'], visibility: input.visibility || 'private' }) as unknown as AccountThing;
	}
	async remember(input: AccountThing, startedAt = this.now(), admitFiles?: (tx: WorkspaceTransaction) => Promise<void>) { return (await this.rememberMany([input], startedAt, admitFiles))[0]; }
	/** One bounded catalogue page commits atomically; quota or invalid content
	 * cannot leave a partially retained page presented as complete. */
	async rememberMany(input: AccountThing[], startedAt = this.now(), admitFiles?: (tx: WorkspaceTransaction) => Promise<void>) {
		if (!Array.isArray(input) || input.length > 50 || (admitFiles && input.length !== 1)) throw new WorkspaceError('INVALID_SYNC_BATCH', 'Invalid account cache page.', 400);
		const remotes = input.map(row => this.checked(row));
		return this.tx('readwrite', async tx => {
			const result: (LocalThing | undefined)[] = [];
			const refusals = await accountReadRefusals(tx);
			for (const remote of remotes) result.push(await this.rememberIn(tx, remote, startedAt, refusals, admitFiles));
			return result;
		});
	}
	private async rememberIn(tx: WorkspaceTransaction, remote: AccountThing, startedAt: number, refusals: Awaited<ReturnType<typeof accountReadRefusals>>, admitFiles?: (tx: WorkspaceTransaction) => Promise<void>) {
		if ([remote.id, remote.targetId].some(id => id && (refusals.get(id)?.at ?? -Infinity) >= startedAt)) return undefined;
		const sync = await tx.get<SyncRecord>(COLLECTION, remote.id);
		if (sync?.deleted) return undefined;
		// A background read cannot erase unsynced editing, nor regress the base.
		if (sync && sync.state !== 'synced') return tx.get<LocalThing>('things', remote.id);
		const previous = await tx.get<LocalThing>('things', remote.id);
		if (previous && sync?.base && (Date.parse(sync.base.updatedAt) > Date.parse(remote.updatedAt) || (!admitFiles && Date.parse(sync.base.updatedAt) === Date.parse(remote.updatedAt)))) return previous;
		if (admitFiles) await admitFiles(tx);
		if (previous && sync?.base && Date.parse(sync.base.updatedAt) === Date.parse(remote.updatedAt)) {
			const restored = this.files?.restore ? await this.files.restore(tx, previous) : previous;
			if (stable(restored) === stable(previous)) {
				if (admitFiles && stable(sync.postAttachmentIds) !== stable(remote.accountAttachmentIds || [])) await tx.put(COLLECTION, remote.id, { ...sync, postAttachmentIds: remote.accountAttachmentIds || [] });
				return previous;
			}
		}
		const cached = previous ? { ...remote, revision: previous.revision + 1,
			updatedAt: new Date(Math.max(Date.parse(previous.updatedAt) + 1, Date.parse(remote.updatedAt))).toISOString() } : remote;
		const device = this.files?.restore ? await this.files.restore(tx, cached) : cached;
		await tx.put('things', remote.id, device);
		await tx.put(COLLECTION, remote.id, { id: remote.id, state: 'synced', base: remote, ...(admitFiles ? { postAttachmentIds: remote.accountAttachmentIds || [] } : {}), audience: { acl: remote.acl, visibility: remote.visibility }, attempts: 0, retryAt: 0 } satisfies SyncRecord);
		return device;
	}
	private async enqueue(tx: WorkspaceTransaction, row: LocalThing, previous: LocalThing | null, input: AccountThingWrite) {
		if (!this.files && row.thingtime.some(kind => ['post','comment'].includes(kind)) && (await tx.list<LocalThing>('things')).some(item => item.value.thingtime.includes('attachment') && item.value.targetId === row.id)) throw new WorkspaceError('UNSUPPORTED_ACCOUNT_MEDIA', 'Bound post media requires its account binding adapter.', 409);
		if (!accountThingCanCache(row)) throw new WorkspaceError('UNSUPPORTED_ACCOUNT_CONTENT', 'This kind requires its dedicated account sync adapter.', 409);
		if (row.thingtime.includes('comment') && Object.entries(row.crystal).some(([key,value]) => value != null && !['type','text','richText','images','listing','thing','mediaLayout'].includes(key))) throw new WorkspaceError('UNSUPPORTED_COMMENT_CONTENT', 'This comment includes fields its account endpoint cannot preserve.', 409);
		const existing = await tx.get<SyncRecord>(COLLECTION, row.id);
		if (existing?.deleted) throw new WorkspaceError('LOCAL_THING_DELETED', 'This Thing was deleted. Restore it before editing.', 409);
		if (previous && !existing) throw new WorkspaceError('SYNC_BASE_MISSING', 'Load the account Thing before editing it offline', 409);
		const acl = sanitizeAcl(row.thingtime.includes('comment') ? ['tt:inherit'] : input.acl ?? (input.visibility !== undefined ? aclFromVisibility(input.visibility) : existing?.audience.acl || ['tt:user']));
		if (!Array.isArray(acl)) throw new WorkspaceError('INVALID_AUDIENCE', acl.error);
		const audience = { acl, visibility: visibilityFromAcl(acl) };
		await tx.put(COLLECTION, row.id, { ...existing, id: row.id, base: existing?.base || null, audience,
			state: existing?.state === 'conflict' || existing?.state === 'error' ? existing.state : 'pending',
			attempts: existing?.attempts || 0, retryAt: existing?.retryAt || 0 } satisfies SyncRecord);
	}
	/** Content, tombstones and sync bases must describe the same device revision. */
	async exportSnapshot() {
		return this.tx('readonly', async tx => ({
			things: (await tx.list<LocalThing>('things')).map(row => row.value),
			records: (await tx.list<SyncRecord>(COLLECTION)).map(({ value: row }) => ({ id: row.id, state: row.state, remote: !!row.base, deleted: !!row.deleted,
				...(row.postAttachmentIds ? { postAttachmentIds: row.postAttachmentIds } : {}) }))
		}));
	}
	async isDeleted(id: string) { return this.tx('readonly', async tx => !!(await tx.get<SyncRecord>(COLLECTION, id))?.deleted); }
	/** Match canonical deletion: drain folder children to their surviving parent;
	 * cascade target-linked content. Content removal and intent commit together. */
	async remove(ids: string[], expectedUpdatedAt?: string) {
		if (expectedUpdatedAt !== undefined && (typeof expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(expectedUpdatedAt)))) throw new WorkspaceError('INVALID_VERSION', 'expectedUpdatedAt must be an ISO timestamp.');
		if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length)
			throw new WorkspaceError('INVALID_IDS', 'Choose between 1 and 200 distinct Things.');
		return this.tx('readwrite', async tx => {
			const all = (await tx.list<LocalThing>('things')).map(row => row.value), selected = new Set(ids);
			const byId = new Map(all.map(row => [row.id, row]));
			for (const id of ids) {
				const row = byId.get(id);
				if (!row) throw new WorkspaceError('LOCAL_CONTENT_MISSING', 'Open this Thing online once before deleting it offline.', 404);
				if (expectedUpdatedAt && row.updatedAt !== expectedUpdatedAt) throw new WorkspaceError('SYNC_CONFLICT', 'This Thing changed. Review it before deleting.', 409);
			}
			for (let changed = true; changed;) {
				changed = false;
				for (const row of all) if (row.targetId && selected.has(row.targetId) && !selected.has(row.id)) { selected.add(row.id); changed = true; }
			}
			// Validate the entire content cascade before changing any file intent.
			// Files stay behind their dedicated upload/deletion replay fences.
			for (const row of all) if (selected.has(row.id)) {
				if (isLocalAttachment(row)) {
					if (!row.targetId || !selected.has(row.targetId) || !this.files?.removeBound)
						throw new WorkspaceError('UNSUPPORTED_LOCAL_DELETE', 'This file requires its owning editor.', 409);
				} else if (!await tx.get<SyncRecord>(COLLECTION, row.id) || isProtectedThingtime(row.thingtime))
					throw new WorkspaceError('UNSUPPORTED_LOCAL_DELETE', 'This item requires its dedicated deletion adapter.', 409);
			}
			for (const row of all) if (selected.has(row.id) && isLocalAttachment(row))
				await this.files!.removeBound!(tx, row.id, row.targetId!);

			for (const row of all) {
				if (selected.has(row.id)) {
					if (isLocalAttachment(row)) continue;
					const state = await tx.get<SyncRecord>(COLLECTION, row.id);
					if (!state || isProtectedThingtime(row.thingtime)) throw new WorkspaceError('UNSUPPORTED_LOCAL_DELETE', 'This item requires its dedicated deletion adapter.', 409);
					await tx.delete('things', row.id);
					if (!state.base && !state.pending) await tx.delete(COLLECTION, row.id); // Never sent: nothing to delete remotely.
					else {
						await tx.put(DELETED_CONTENT, row.id, row);
						await tx.put(COLLECTION, row.id, { ...state, deleted: { id: row.id, revision: row.revision, updatedAt: row.updatedAt }, state: state.state === 'syncing' ? 'syncing' : 'pending', error: undefined, retryAt: 0 });
					}
				} else if (row.folderId && selected.has(row.folderId)) {
					let folderId: string | null = row.folderId; const seen = new Set<string>();
					while (folderId && selected.has(folderId)) {
						if (seen.has(folderId)) throw new WorkspaceError('INVALID_FOLDER', 'The folder chain is cyclic.');
						seen.add(folderId); folderId = byId.get(folderId)?.folderId || null;
					}
					const next = { ...row, folderId, revision: row.revision + 1, updatedAt: new Date(Math.max(this.now(), Date.parse(row.updatedAt) + 1)).toISOString() };
					await tx.put('things', row.id, next); await this.enqueue(tx, next, row, { folderId });
				}
			}
			return { ok: true, deleted: [...selected] };
		});
	}
	async view(id: string) {
		return this.tx('readonly', async tx => {
			const thing = await tx.get<LocalThing>('things', id);
			const sync = await tx.get<SyncRecord>(COLLECTION, id);
			if (!thing || !sync || sync.deleted) return null;
			return { ...thing, ...sync.audience, author: { id: this.scope.ownerId }, syncState: sync.state, localOnly: false, localWorkspace: true };
		});
	}
	async views(ids: string[]) { return (await this.viewSnapshot(ids)).rows; }
	/** Content and tombstones come from one read revision across tabs. */
	async viewSnapshot(ids: string[]) {
		return this.tx('readonly', async tx => {
			const rows = [], deleted = new Set<string>();
			for (const id of ids) {
				const thing = await tx.get<LocalThing>('things', id), sync = await tx.get<SyncRecord>(COLLECTION, id);
				if (sync?.deleted) deleted.add(id);
				if (thing && sync && !sync.deleted) rows.push({ ...thing, ...sync.audience, author: { id: this.scope.ownerId }, syncState: sync.state, localOnly: false, localWorkspace: true });
			}
			return { rows, deleted };
		});
	}
	async status() { return this.tx('readonly', async tx => (await tx.list<SyncRecord>(COLLECTION)).map(({ value }) => ({ id: value.id, state: value.state, deleted: !!value.deleted, error: value.error, attempts: value.attempts, retryAt: value.retryAt }))); }
	async retry(id: string) {
		return this.tx('readwrite', async tx => {
			const value = await tx.get<SyncRecord>(COLLECTION, id);
			if (!value || value.state === 'synced') return;
			if (value.state === 'conflict' && !value.deleted) throw new WorkspaceError('SYNC_CONFLICT', 'Keep or compare the conflicting versions before syncing', 409);
			await tx.put(COLLECTION, id, { ...value, state: 'pending', retryAt: 0, error: undefined });
		});
	}
	async inspectConflict(transport: AccountSyncTransport, id: string, signal = new AbortController().signal) {
		const remote = this.checked(await accountSyncDeadline(child => transport.get(id, child), signal));
		if (remote.id !== id) throw new WorkspaceError('SYNC_IDENTITY', 'Server returned a different Thing', 409);
		return this.tx('readonly', async tx => {
			const state = await tx.get<SyncRecord>(COLLECTION, id), local = await tx.get<LocalThing>(state?.deleted ? DELETED_CONTENT : 'things', id);
			if (state?.state !== 'conflict' || !local) throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'This conflict changed. Review it again.', 409);
			return { local: { ...local, ...state.audience }, remote, localRevision: local.revision, deleted: !!state.deleted };
		});
	}
	/** Only an explicit reviewed choice may replace either version. Recheck both
	 * sides so typing, another tab or another device invalidates an old review. */
	async resolveConflict(transport: AccountSyncTransport, choice: { id: string; keep: 'local' | 'remote'; localRevision: number; remoteUpdatedAt: string }, signal = new AbortController().signal) {
		if (!['local', 'remote'].includes(choice.keep)) throw new WorkspaceError('INVALID_CONFLICT_CHOICE', 'Choose which version to keep');
		const remote = this.checked(await accountSyncDeadline(child => transport.get(choice.id, child), signal));
		if (remote.id !== choice.id || remote.updatedAt !== choice.remoteUpdatedAt) throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'The account version changed. Review it again.', 409);
		return this.tx('readwrite', async tx => {
			const state = await tx.get<SyncRecord>(COLLECTION, choice.id), local = await tx.get<LocalThing>(state?.deleted ? DELETED_CONTENT : 'things', choice.id);
			if (state?.state !== 'conflict' || !local || local.revision !== choice.localRevision)
				throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'Your local version changed. Review it again.', 409);
			if (choice.keep === 'remote') {
				if (state.deleted) await this.files?.restoreParent?.(tx, choice.id, remote.accountAttachmentIds || []);
				await tx.delete(DELETED_CONTENT, choice.id);
				await tx.put('things', choice.id, { ...remote, revision: local.revision + 1, updatedAt: new Date(Math.max(this.now(), Date.parse(local.updatedAt) + 1)).toISOString() });
			}
			await tx.put(COLLECTION, choice.id, { id: choice.id, state: choice.keep === 'local' ? 'pending' : 'synced', base: remote,
				...(choice.keep === 'local' && state.deleted ? { deleted: state.deleted } : {}),
				...(choice.keep === 'local' && state.postAttachmentIds ? { postAttachmentIds: state.postAttachmentIds } : {}),
				audience: choice.keep === 'local' ? state.audience : { acl: remote.acl, visibility: remote.visibility }, attempts: 0, retryAt: 0 } satisfies SyncRecord);
		});
	}
	/** One claimed operation at a time, even across browser tabs. A crashed
	 * tab's lease expires; the next tab replays the identical frozen request. */
	async sync(transport: AccountSyncTransport, signal: AbortSignal = new AbortController().signal, maxWrites = 25) {
		let completed = 0;
		for (let count = 0; count < Math.min(100, Math.max(0, maxWrites)); count++) {
			this.lease.assertCurrent(); signal.throwIfAborted();
			const claimed = await this.tx('readwrite', async tx => {
				const rows = (await tx.list<SyncRecord>(COLLECTION)).map(row => row.value);
				let record: SyncRecord | undefined, row: (LocalThing & { attachmentIds?: string[] }) | undefined;
				for (const candidate of rows) {
					if (!['pending', 'syncing'].includes(candidate.state) || candidate.retryAt > this.now() || (candidate.claim && candidate.claim.expiresAt > this.now())) continue;
					if (candidate.deleted && !candidate.base && !candidate.pending) {
						await tx.delete(DELETED_CONTENT, candidate.id);
						await tx.put(COLLECTION, candidate.id, { ...candidate, state: 'synced', claim: undefined, error: undefined }); continue;
					}
					const content = await tx.get<LocalThing>(candidate.deleted ? DELETED_CONTENT : 'things', candidate.id);
					// Aborting the pass here would re-select this same orphan on every
					// later drain, silently stalling every other pending write behind a
					// queue entry that can never progress. Quarantine it as a visible
					// error instead, so status/retry surface it and the queue drains on.
					if (!content) {
						await tx.put(COLLECTION, candidate.id, { ...candidate, state: 'error', claim: undefined, pending: undefined,
							error: 'The local content for this pending change is missing on this device.' });
						continue;
					}
					// Skip blocked children so their parents can progress first.
					if (candidate.deleted && rows.some(other => other.id !== candidate.id && other.state === 'synced' && !other.deleted && other.base?.targetId === candidate.id)) {
						await tx.put(COLLECTION, candidate.id, { ...candidate, state: 'error', claim: undefined,
							error: 'A linked Thing was kept in its account version. Delete that linked Thing explicitly before retrying this parent deletion.' });
						continue;
					}
					if (candidate.deleted && rows.some(other => other.id !== candidate.id && other.state !== 'synced' &&
						[other.base?.folderId, other.base?.targetId, other.pending?.body.folderId, other.pending?.body.targetId].includes(candidate.id))) continue;
					if (!candidate.deleted && [content.folderId, content.targetId, content.thingtime.includes('data') ? content.crystal.schemaId : null, ...((content.thingtime.includes('post') || content.thingtime.includes('comment')) ? postThingReferences(content.crystal.thing).map(ref => ref.id) : [])].some(id => id && rows.some(other => other.id === id && !other.base))) continue;
					// Resolve an uncertain parent write and active file claims first.
					// The version-checked parent DELETE owns remote attachment cascade.
					if (candidate.deleted && !candidate.pending && this.files?.prepareRemove) {
						try { if (!await this.files.prepareRemove(tx, candidate.id)) continue; }
						catch (error) {
							if (!(error instanceof WorkspaceError)) throw error;
							await tx.put(COLLECTION, candidate.id, { ...candidate, state: 'error', claim: undefined, error: error.message }); continue;
						}
					}
					let prepared = content;
					if (!candidate.deleted && !candidate.pending && this.files) {
						try {
							const ready = await this.files.prepare(tx, content);
							if (!ready) continue;
							prepared = ready;
						} catch (error) {
							if (!(error instanceof WorkspaceError)) throw error;
							await tx.put(COLLECTION, candidate.id, { ...candidate, state: 'error', claim: undefined, error: error.message }); continue;
						}
					}
					record = candidate; row = prepared; break;
				}
				if (!record || !row) return null;
				const pending: FrozenWrite | FrozenDelete = record.pending || (record.deleted && record.base ? {
					id: row.id, operationId: this.uuid(), version: row.revision, method: 'delete', body: { id: row.id, expectedUpdatedAt: record.base.updatedAt }
				} : { id: row.id, operationId: this.uuid(), version: row.revision,
					method: record.base ? 'update' : 'create', body: { ...writeContent(row), ...record.audience, ...(row.attachmentIds ? { attachmentIds: row.attachmentIds } : {}),
						...(record.base ? { id: row.id, expectedUpdatedAt: record.base.updatedAt, replaceCrystal: true } : { shareId: row.id }) } });
				const claim = { token: this.uuid(), expiresAt: this.now() + CLAIM_MS };
				await tx.put(COLLECTION, row.id, { ...record, state: 'syncing', pending, claim });
				return { pending, claim };
			});
			if (!claimed) break;
			const { pending, claim } = claimed;
			const controller = new AbortController();
			const unsubscribe = this.lease.onInvalidate(() => controller.abort());
			const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
			try {
				if (pending.method === 'delete') {
					if (!transport.remove) throw new WorkspaceError('DELETE_UNAVAILABLE', 'This account adapter cannot synchronize deletion yet.', 422);
					try { await accountSyncDeadline(child => transport.remove!(pending, child), controller.signal); }
					catch (failure) {
						this.lease.assertCurrent();
						const status = Number((failure as any)?.status);
						if (status !== 404 && status !== 409 && status > 0 && status < 500 && status !== 408 && status !== 429) throw failure;
						let absent = false;
						try { await accountSyncDeadline(child => transport.get(pending.id, child), controller.signal); }
						catch (error) { absent = Number((error as any)?.status) === 404; }
						if (!absent) throw failure;
					}
					await this.tx('readwrite', async tx => {
						const latest = await tx.get<SyncRecord>(COLLECTION, pending.id);
						if (latest?.claim?.token === claim.token) {
							await tx.delete(DELETED_CONTENT, pending.id);
							await tx.put(COLLECTION, pending.id, { ...latest, base: null, state: 'synced', pending: undefined, claim: undefined, attempts: 0, retryAt: 0, error: undefined });
						}
					});
					completed++; continue;
				}
				let remote: AccountThing;
				try { remote = this.checked(await accountSyncDeadline(child => transport.write(pending, child), controller.signal)); }
				catch (failure) {
					this.lease.assertCurrent();
					// A create may have committed before its response was lost; a
					// conditional update may now conflict with its own prior success.
					const status = Number((failure as any)?.status);
					if (status !== 409 && status > 0 && status < 500 && status !== 408 && status !== 429) throw failure;
					try {
						const found = this.checked(await accountSyncDeadline(child => transport.get(pending.id, child), controller.signal));
						if (found.id !== pending.id || !sameContent(found, pending)) throw failure;
						remote = found;
					} catch { throw failure; }
				}
				if (remote.id !== pending.id) throw new WorkspaceError('SYNC_IDENTITY', 'Server returned a different Thing', 409);
				if (pending.body.attachmentIds && stable(remote.accountAttachmentIds || []) !== stable(pending.body.attachmentIds)) throw new WorkspaceError('SYNC_ATTACHMENTS', 'Account attachment binding differs from this saved request. Your local files are preserved.', 409);
				await this.tx('readwrite', async tx => {
					const latest = await tx.get<SyncRecord>(COLLECTION, pending.id);
					if (latest?.claim?.token !== claim.token) return;
					const row = await tx.get<LocalThing>('things', pending.id);
					const newer = !!latest.deleted || (row && row.revision !== pending.version);
					const device = this.files?.restore ? await this.files.restore(tx, remote) : remote;
					if (!newer) await tx.put('things', pending.id, { ...device, ...(row?.localSubmission ? { localSubmission: row.localSubmission } : {}), revision: row?.revision || 1, updatedAt: row?.updatedAt || remote.updatedAt });
					await tx.put(COLLECTION, pending.id, { id: pending.id, state: newer ? 'pending' : 'synced', base: remote,
						...(this.files && Array.isArray(pending.body.attachmentIds) ? { postAttachmentIds: remote.accountAttachmentIds || [] } : {}),
						...(latest.deleted ? { deleted: latest.deleted } : {}),
						audience: newer ? latest.audience : { acl: remote.acl, visibility: remote.visibility }, attempts: 0, retryAt: 0 } satisfies SyncRecord);
				});
				completed++;
			} catch (failure) {
				this.lease.assertCurrent();
				await this.tx('readwrite', async tx => {
					const latest = await tx.get<SyncRecord>(COLLECTION, pending.id);
					if (latest?.claim?.token !== claim.token) return;
					const status = Number((failure as any)?.status);
					const state: SyncState = status === 409 ? 'conflict' : [400, 401, 403, 404, 410, 413, 422].includes(status) ? 'error' : 'pending';
					await tx.put(COLLECTION, pending.id, { ...latest, state, claim: undefined, ...(state === 'error' ? { pending: undefined } : {}), attempts: latest.attempts + 1,
						retryAt: this.now() + Math.min(60_000, 1000 * 2 ** Math.min(latest.attempts, 6)),
						error: state === 'conflict' ? 'Remote content changed. Your local edits are preserved.' : state === 'error' ? 'Account sync was refused. Your local edits are preserved.' : 'Saved on this device; waiting to sync.' });
				});
				break;
			} finally { unsubscribe(); signal.removeEventListener('abort', abort); }
		}
		return { completed };
	}
}
