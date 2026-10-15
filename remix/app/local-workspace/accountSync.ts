import { LocalThings, type LocalThing, type ThingWrite } from './things';
import { WorkspaceDatabase, WorkspaceError, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
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
export type AccountThing = LocalThing & { author: { id: string }; acl: string[]; visibility: string };
type FrozenWrite = { id: string; operationId: string; version: number; method: 'create' | 'update'; body: Record<string, unknown> };
type SyncRecord = {
	id: string; state: SyncState; base: AccountThing | null; audience: { acl: string[]; visibility: string };
	pending?: FrozenWrite; claim?: { token: string; expiresAt: number }; attempts: number; retryAt: number; error?: string;
};
export type AccountSyncTransport = {
	/** Must pin expected actor + data plane on every request, including reads. */
	get(id: string, signal: AbortSignal): Promise<AccountThing>;
	write(operation: Readonly<FrozenWrite>, signal: AbortSignal): Promise<AccountThing>;
};
const COLLECTION = 'thing-sync';
const CLAIM_MS = 60_000;
const REQUEST_MS = 20_000;
const contentFields = ['thingtime', 'crystal', 'extended', 'tags', 'folderId', 'targetId'] as const;
const writeContent = (row: LocalThing) => Object.fromEntries(contentFields.map(key => [key, row[key] ?? (key === 'folderId' || key === 'targetId' ? null : key === 'tags' ? [] : null)]));
const stable = (input: unknown): string => JSON.stringify(input, function (_key, value) {
	return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value;
});
const sameContent = (remote: AccountThing, operation: FrozenWrite) =>
	Object.entries(operation.body).filter(([key]) => !['shareId', 'id', 'expectedUpdatedAt', 'replaceCrystal'].includes(key))
		.every(([key, value]) => stable((remote as any)[key] ?? (value === null ? null : undefined)) === stable(value));
const deadline = async <T>(run: (signal: AbortSignal) => Promise<T>, parent: AbortSignal): Promise<T> => {
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
		private now = () => Date.now(), private uuid = () => crypto.randomUUID()) {
		if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous workspaces never sync', 403);
		this.things = new LocalThings(db, scope, lease, [], () => new Date(now()).toISOString(), uuid,
			(tx, row, previous, input) => this.enqueue(tx, row, previous, input as AccountThingWrite));
	}
	private tx<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) { return this.db.transaction(this.scope, mode, this.lease, run); }
	private checked(input: AccountThing): AccountThing {
		if (!input || input.author?.id !== this.scope.ownerId || typeof input.id !== 'string' || !Number.isFinite(Date.parse(input.updatedAt)))
			throw new WorkspaceError('SYNC_IDENTITY', 'The remote Thing does not belong to this workspace', 409);
		const checked = validateThingtimeCrystal(input.thingtime, snapshotTransferValue(input.crystal));
		if (checked.ok === false || isProtectedThingtime(input.thingtime)) throw new WorkspaceError('INVALID_SYNC_THING', 'This Thing requires its dedicated local adapter', 502);
		// Whitelist the cache projection. Never retain hidden-link bearer keys,
		// credentials, grants or arbitrary server envelope fields.
		return snapshotTransferValue({ id: input.id, thingtime: checked.thingtime, crystal: checked.crystal,
			extended: input.extended ?? null, tags: input.tags || [], folderId: input.folderId || null, targetId: input.targetId || null,
			createdAt: input.createdAt, updatedAt: input.updatedAt, revision: 1,
			author: { id: this.scope.ownerId }, acl: input.acl || ['tt:user'], visibility: input.visibility || 'private' }) as unknown as AccountThing;
	}
	async remember(input: AccountThing) {
		const remote = this.checked(input);
		return this.tx('readwrite', async tx => {
			const sync = await tx.get<SyncRecord>(COLLECTION, remote.id);
			// A background read is never allowed to erase unsynced editing.
			if (sync && sync.state !== 'synced') return tx.get<LocalThing>('things', remote.id);
			const previous = await tx.get<LocalThing>('things', remote.id);
			// Local timestamps are editor concurrency tokens, not server clocks.
			// An acknowledgement must not invalidate an editor's next save.
			if (previous && sync?.base && Date.parse(sync.base.updatedAt) >= Date.parse(remote.updatedAt)) return previous;
			const cached = previous ? { ...remote, revision: previous.revision + 1,
				updatedAt: new Date(Math.max(Date.parse(previous.updatedAt) + 1, Date.parse(remote.updatedAt))).toISOString() } : remote;
			await tx.put('things', remote.id, cached);
			await tx.put(COLLECTION, remote.id, { id: remote.id, state: 'synced', base: remote, audience: { acl: remote.acl, visibility: remote.visibility }, attempts: 0, retryAt: 0 } satisfies SyncRecord);
			return cached;
		});
	}
	private async enqueue(tx: WorkspaceTransaction, row: LocalThing, previous: LocalThing | null, input: AccountThingWrite) {
		const existing = await tx.get<SyncRecord>(COLLECTION, row.id);
		if (previous && !existing) throw new WorkspaceError('SYNC_BASE_MISSING', 'Load the account Thing before editing it offline', 409);
		const acl = sanitizeAcl(input.acl ?? (input.visibility !== undefined ? aclFromVisibility(input.visibility) : existing?.audience.acl || ['tt:user']));
		if (!Array.isArray(acl)) throw new WorkspaceError('INVALID_AUDIENCE', acl.error);
		const audience = { acl, visibility: visibilityFromAcl(acl) };
		await tx.put(COLLECTION, row.id, { ...existing, id: row.id, base: existing?.base || null, audience,
			state: existing?.state === 'conflict' || existing?.state === 'error' ? existing.state : 'pending',
			attempts: existing?.attempts || 0, retryAt: existing?.retryAt || 0 } satisfies SyncRecord);
	}
	async view(id: string) {
		return this.tx('readonly', async tx => {
			const thing = await tx.get<LocalThing>('things', id);
			const sync = await tx.get<SyncRecord>(COLLECTION, id);
			if (!thing || !sync) return null;
			return { ...thing, ...sync.audience, author: { id: this.scope.ownerId }, syncState: sync.state, localOnly: false, localWorkspace: true };
		});
	}
	async views(ids: string[]) {
		return this.tx('readonly', async tx => {
			const rows = [];
			for (const id of ids) {
				const thing = await tx.get<LocalThing>('things', id), sync = await tx.get<SyncRecord>(COLLECTION, id);
				if (thing && sync) rows.push({ ...thing, ...sync.audience, author: { id: this.scope.ownerId }, syncState: sync.state, localOnly: false, localWorkspace: true });
			}
			return rows;
		});
	}
	async status() { return this.tx('readonly', async tx => (await tx.list<SyncRecord>(COLLECTION)).map(({ value }) => ({ id: value.id, state: value.state, error: value.error, attempts: value.attempts, retryAt: value.retryAt }))); }
	async retry(id: string) {
		return this.tx('readwrite', async tx => {
			const value = await tx.get<SyncRecord>(COLLECTION, id);
			if (!value || value.state === 'synced') return;
			if (value.state === 'conflict') throw new WorkspaceError('SYNC_CONFLICT', 'Keep or compare the conflicting versions before syncing', 409);
			await tx.put(COLLECTION, id, { ...value, state: 'pending', retryAt: 0, error: undefined });
		});
	}
	async inspectConflict(transport: AccountSyncTransport, id: string, signal = new AbortController().signal) {
		const remote = this.checked(await deadline(child => transport.get(id, child), signal));
		if (remote.id !== id) throw new WorkspaceError('SYNC_IDENTITY', 'Server returned a different Thing', 409);
		return this.tx('readonly', async tx => {
			const state = await tx.get<SyncRecord>(COLLECTION, id), local = await tx.get<LocalThing>('things', id);
			if (state?.state !== 'conflict' || !local) throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'This conflict changed. Review it again.', 409);
			return { local: { ...local, ...state.audience }, remote, localRevision: local.revision };
		});
	}
	/** Only an explicit reviewed choice may replace either version. Recheck both
	 * sides so typing, another tab or another device invalidates an old review. */
	async resolveConflict(transport: AccountSyncTransport, choice: { id: string; keep: 'local' | 'remote'; localRevision: number; remoteUpdatedAt: string }, signal = new AbortController().signal) {
		if (!['local', 'remote'].includes(choice.keep)) throw new WorkspaceError('INVALID_CONFLICT_CHOICE', 'Choose which version to keep');
		const remote = this.checked(await deadline(child => transport.get(choice.id, child), signal));
		if (remote.id !== choice.id || remote.updatedAt !== choice.remoteUpdatedAt) throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'The account version changed. Review it again.', 409);
		return this.tx('readwrite', async tx => {
			const state = await tx.get<SyncRecord>(COLLECTION, choice.id), local = await tx.get<LocalThing>('things', choice.id);
			if (state?.state !== 'conflict' || !local || local.revision !== choice.localRevision)
				throw new WorkspaceError('SYNC_CONFLICT_CHANGED', 'Your local version changed. Review it again.', 409);
			if (choice.keep === 'remote') await tx.put('things', choice.id, { ...remote, revision: local.revision + 1,
				updatedAt: new Date(Math.max(this.now(), Date.parse(local.updatedAt) + 1)).toISOString() });
			await tx.put(COLLECTION, choice.id, { id: choice.id, state: choice.keep === 'local' ? 'pending' : 'synced', base: remote,
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
				let record: SyncRecord | undefined, row: LocalThing | undefined;
				for (const candidate of rows) {
					if (!['pending', 'syncing'].includes(candidate.state) || candidate.retryAt > this.now() || (candidate.claim && candidate.claim.expiresAt > this.now())) continue;
					const content = await tx.get<LocalThing>('things', candidate.id);
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
					if ([content.folderId, content.targetId].some(id => id && rows.some(other => other.id === id && !other.base))) continue;
					record = candidate; row = content; break;
				}
				if (!record || !row) return null;
				const pending: FrozenWrite = record.pending || { id: row.id, operationId: this.uuid(), version: row.revision,
					method: record.base ? 'update' : 'create', body: { ...writeContent(row), ...record.audience,
						...(record.base ? { id: row.id, expectedUpdatedAt: record.base.updatedAt, replaceCrystal: true } : { shareId: row.id }) } };
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
				let remote: AccountThing;
				try { remote = this.checked(await deadline(child => transport.write(pending, child), controller.signal)); }
				catch (failure) {
					this.lease.assertCurrent();
					// A create may have committed before its response was lost; a
					// conditional update may now conflict with its own prior success.
					const status = Number((failure as any)?.status);
					if (status !== 409 && status > 0 && status < 500 && status !== 408 && status !== 429) throw failure;
					try {
						const found = this.checked(await deadline(child => transport.get(pending.id, child), controller.signal));
						if (found.id !== pending.id || !sameContent(found, pending)) throw failure;
						remote = found;
					} catch { throw failure; }
				}
				if (remote.id !== pending.id) throw new WorkspaceError('SYNC_IDENTITY', 'Server returned a different Thing', 409);
				await this.tx('readwrite', async tx => {
					const latest = await tx.get<SyncRecord>(COLLECTION, pending.id);
					if (latest?.claim?.token !== claim.token) return;
					const row = await tx.get<LocalThing>('things', pending.id);
					const newer = row && row.revision !== pending.version;
					if (!newer) await tx.put('things', pending.id, { ...remote, revision: row?.revision || 1, updatedAt: row?.updatedAt || remote.updatedAt });
					await tx.put(COLLECTION, pending.id, { id: pending.id, state: newer ? 'pending' : 'synced', base: remote,
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
