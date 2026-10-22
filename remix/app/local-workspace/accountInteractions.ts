import { interactionState, interactionMatches, type InteractionState, type InteractionWrite } from '../utils/interactionState';
import { sanitizeReactionToken, MAX_REACTIONS_PER_USER_PER_POST } from '../utils/reactionTokens';
import { accountSyncDeadline, type SyncState } from './accountSync';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
import type { LocalThing } from './things';

const COLLECTION = 'account-interactions';
type Changes = { saved?: boolean; reactions: Record<string, boolean> };
type RecordState = {
	id: string;
	base: InteractionState | null;
	observed?: InteractionState;
	readAt?: number;
	mutationAt?: number;
	changes: Changes;
	version: number;
	state: SyncState;
	stamp: string;
	pending?: InteractionWrite;
	pendingVersion?: number;
	claim?: { token: string; expiresAt: number };
	attempts: number;
	retryAt: number;
	error?: string;
};
export type InteractionTransport = {
	read(ids: string[], signal?: AbortSignal): Promise<InteractionState[]>;
	write(command: InteractionWrite, signal?: AbortSignal): Promise<InteractionState>;
};
const empty = (id: string): InteractionState => ({ id, revision: null, saved: false, reactions: [] });
const apply = (row: RecordState): InteractionState => {
	const base = row.base || row.observed || empty(row.id),
		reactions = new Set(base.reactions),
		counts = { ...base.reactionCounts };
	for (const [token, active] of Object.entries(row.changes.reactions)) {
		counts[token] = Math.max(0, (counts[token] || 0) + Number(active) - Number(base.reactions.includes(token)));
		if (active) reactions.add(token);
		else reactions.delete(token);
	}
	return {
		...base,
		reactionCounts: counts,
		saved: row.changes.saved ?? base.saved,
		savedAt: row.changes.saved === true ? row.stamp : base.savedAt,
		reactions: [...reactions].sort()
	};
};
const hasChanges = (row: RecordState) => row.changes.saved !== undefined || Object.keys(row.changes.reactions).length > 0;
const nextCommand = (row: RecordState): InteractionWrite | null => {
	if (!row.base) return null;
	const common = { id: row.id, expectedRevision: row.base.revision };
	if (row.changes.saved !== undefined) return { ...common, kind: 'save', active: row.changes.saved };
	const entry = Object.entries(row.changes.reactions)[0];
	return entry ? { ...common, kind: 'reaction', emoji: entry[0], active: entry[1] } : null;
};

/** Account-only intent. No remote authority is inferred from cached content.
 * Each tab claims a frozen conditional command; retries never toggle state. */
export class AccountInteractionSync {
	constructor(
		private db: WorkspaceDatabase,
		private scope: WorkspaceScope,
		private lease: WorkspaceLease,
		private now = () => Date.now(),
		private uuid = () => crypto.randomUUID()
	) {
		if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous workspaces never synchronize interactions', 403);
	}
	private tx<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>) {
		return this.db.transaction(this.scope, mode, this.lease, run);
	}
	private fresh(id: string): RecordState {
		return {
			id,
			base: null,
			changes: { reactions: {} },
			version: 0,
			state: 'synced',
			stamp: new Date(this.now()).toISOString(),
			attempts: 0,
			retryAt: 0
		};
	}
	async remember(states: InteractionState[], revisionKnown = true, startedAt = this.now()) {
		if (!Array.isArray(states) || states.length > 50 || !Number.isFinite(startedAt))
			throw new WorkspaceError('INVALID_INTERACTIONS', 'Invalid interaction page');
		const checked = states.map(interactionState);
		return this.tx('readwrite', async (tx) => {
			let changed = false;
			for (const state of checked) {
				const old = await tx.get<RecordState>(COLLECTION, state.id);
				if (old && (old.state !== 'synced' || (old.readAt ?? -Infinity) > startedAt || (old.mutationAt ?? -Infinity) >= startedAt)) continue;
				if (!revisionKnown && state.saved && state.savedAt === undefined) state.savedAt = (old?.base || old?.observed)?.savedAt;
				if (old && JSON.stringify(revisionKnown ? old.base : old.observed) === JSON.stringify(state)) {
					if (startedAt > (old.readAt ?? -Infinity)) await tx.put(COLLECTION, state.id, { ...old, readAt: startedAt });
					continue;
				}
				await tx.put(COLLECTION, state.id, {
					...this.fresh(state.id),
					base: revisionKnown ? state : null,
					readAt: startedAt,
					observed: revisionKnown ? undefined : state,
					version: (old?.version || 0) + 1
				});
				changed = true;
			}
			return changed;
		});
	}
	async toggle(kind: 'save' | 'reaction', id: string, value?: unknown) {
		if (!['save', 'reaction'].includes(kind)) throw new WorkspaceError('INVALID_INTERACTION', 'Unsupported interaction');
		if (typeof id !== 'string' || !id.trim() || id.length > 200) throw new WorkspaceError('INVALID_INTERACTION', 'Choose a Thing');
		const token = kind === 'reaction' ? sanitizeReactionToken(value) : null;
		if (kind === 'reaction' && value !== null && !token) throw new WorkspaceError('INVALID_INTERACTION', 'Unsupported reaction');
		return this.tx('readwrite', async (tx) => {
			const row = (await tx.get<RecordState>(COLLECTION, id)) || this.fresh(id),
				state = apply(row);
			if (kind === 'reaction' && value === null) return state;
			if (kind === 'save') {
				row.changes.saved = !state.saved;
				row.stamp = new Date(this.now()).toISOString();
			} else {
				const active = !state.reactions.includes(token!);
				if (active && state.reactions.length >= MAX_REACTIONS_PER_USER_PER_POST)
					throw new WorkspaceError('REACTION_LIMIT', 'You can add at most 20 reactions');
				row.changes.reactions[token!] = active;
			}
			row.version++;
			if (row.state !== 'conflict' && row.state !== 'error') row.state = 'pending';
			await tx.put(COLLECTION, id, row);
			return apply(row);
		});
	}
	async discard(ids: string[]) {
		return this.tx('readwrite', async (tx) => {
			for (const id of ids) await tx.delete(COLLECTION, id);
		});
	}
	async states() {
		return this.tx('readonly', async (tx) => (await tx.list<RecordState>(COLLECTION)).map(({ value }) => apply(value)));
	}
	async rows(): Promise<LocalThing[]> {
		const states = await this.states();
		return states.flatMap((state) =>
			[...(state.saved ? [{ kind: 'save', token: '' }] : []), ...state.reactions.map((token) => ({ kind: 'reaction', token }))].map(
				({ kind, token }) => ({
					id: `interaction-view:${state.id}:${kind}:${token}`,
					thingtime: [kind],
					targetId: state.id,
					crystal: token ? { emoji: token } : {},
					createdAt: state.savedAt || new Date(0).toISOString(),
					updatedAt: new Date(0).toISOString(),
					revision: 0
				})
			)
		);
	}
	async status() {
		return this.tx('readonly', async (tx) =>
			(await tx.list<RecordState>(COLLECTION)).map(({ value }) => ({ id: value.id, state: value.state, error: value.error, retryAt: value.retryAt }))
		);
	}
	async retry(id: string) {
		return this.tx('readwrite', async (tx) => {
			const row = await tx.get<RecordState>(COLLECTION, id);
			if (!row) return;
			if (row.state === 'conflict') throw new WorkspaceError('REVIEW_REQUIRED', 'Review changed account interactions before retrying', 409);
			if (row.claim && row.claim.expiresAt > this.now()) return;
			await tx.put(COLLECTION, id, { ...row, state: 'pending', retryAt: 0, error: undefined });
		});
	}
	async inspect(transport: InteractionTransport, id: string) {
		const remote = interactionState((await transport.read([id]))[0]);
		if (remote.id !== id) throw new WorkspaceError('SYNC_IDENTITY', 'Interaction target changed', 409);
		return this.tx('readonly', async (tx) => {
			const row = await tx.get<RecordState>(COLLECTION, id);
			if (!row) throw new WorkspaceError('MISSING_INTERACTION', 'Local interaction is missing', 404);
			return { id, version: row.version, local: apply(row), remote };
		});
	}
	async resolve(transport: InteractionTransport, review: Awaited<ReturnType<AccountInteractionSync['inspect']>>, keep: 'local' | 'remote') {
		if (!['local', 'remote'].includes(keep)) throw new WorkspaceError('INVALID_CHOICE', 'Choose the device or account interactions');
		const remote = interactionState((await transport.read([review.id]))[0]);
		if (remote.id !== review.id || remote.revision !== review.remote.revision)
			throw new WorkspaceError('SYNC_CONFLICT', 'Account interactions changed again. Review them again.', 409);
		await this.tx('readwrite', async (tx) => {
			const row = await tx.get<RecordState>(COLLECTION, review.id);
			if (!row || row.version !== review.version || row.claim)
				throw new WorkspaceError('SYNC_CONFLICT', 'Local interactions changed. Review them again.', 409);
			await tx.put(COLLECTION, row.id, {
				...row,
				base: remote,
				readAt: this.now(),
				mutationAt: this.now(),
				changes: keep === 'local' ? row.changes : { reactions: {} },
				pending: undefined,
				pendingVersion: undefined,
				state: keep === 'local' && hasChanges(row) ? 'pending' : 'synced',
				error: undefined,
				retryAt: 0,
				version: row.version + 1
			});
		});
	}
	async sync(
		transport: InteractionTransport,
		signal = new AbortController().signal,
		ready: (id: string) => Promise<boolean> = async () => true,
		maxWrites = 25
	) {
		let completed = 0;
		for (let i = 0; i < maxWrites && !signal.aborted; i++) {
			const ids = (await this.status()).filter((row) => ['pending', 'syncing'].includes(row.state) && row.retryAt <= this.now()).map((row) => row.id);
			let claimed: RecordState | null = null;
			for (const id of ids) {
				if (!(await ready(id))) continue;
				claimed = await this.tx('readwrite', async (tx) => {
					const row = await tx.get<RecordState>(COLLECTION, id);
					if (!row || !['pending', 'syncing'].includes(row.state) || row.retryAt > this.now() || (row.claim && row.claim.expiresAt > this.now()))
						return null;
					const next = { ...row, state: 'syncing' as const, claim: { token: this.uuid(), expiresAt: this.now() + 60_000 } };
					await tx.put(COLLECTION, id, next);
					return next;
				});
				if (claimed) break;
			}
			if (!claimed) break;
			const item = claimed,
				controller = new AbortController(),
				unsubscribe = this.lease.onInvalidate(() => controller.abort()),
				abort = () => controller.abort();
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort();
			try {
				let command = item.pending;
				if (!command) {
					const base = item.base || interactionState((await accountSyncDeadline((s) => transport.read([item.id], s), controller.signal))[0]);
					if (base.id !== item.id) throw new WorkspaceError('SYNC_IDENTITY', 'Interaction response target changed', 409);
					command = await this.tx('readwrite', async (tx) => {
						const row = await tx.get<RecordState>(COLLECTION, item.id);
						if (row?.claim?.token !== item.claim!.token) throw new WorkspaceError('SYNC_CLAIM', 'Interaction claim changed', 409);
						row.base = base;
						const next = nextCommand(row);
						if (!next) throw new WorkspaceError('MISSING_INTENT', 'Interaction intent is missing', 409);
						await tx.put(COLLECTION, row.id, { ...row, pending: next, pendingVersion: row.version });
						return next;
					});
				}
				let remote: InteractionState;
				try {
					remote = interactionState(await accountSyncDeadline((s) => transport.write(command!, s), controller.signal));
				} catch (error) {
					const status = Number((error as any)?.status);
					if (status !== 409 && status > 0 && status < 500 && status !== 408 && status !== 429) throw error;
					const observed = interactionState((await accountSyncDeadline((s) => transport.read([item.id], s), controller.signal))[0]);
					if (observed.id !== item.id || !interactionMatches(observed, command)) throw error;
					remote = observed;
				}
				if (remote.id !== item.id || !interactionMatches(remote, command))
					throw new WorkspaceError('SYNC_CONFLICT', 'Account interactions changed. Your local choice is preserved.', 409);
				await this.tx('readwrite', async (tx) => {
					const row = await tx.get<RecordState>(COLLECTION, item.id);
					if (row?.claim?.token !== item.claim!.token) return;
					if (command!.kind === 'save') {
						if (row.changes.saved === command!.active) delete row.changes.saved;
					} else if (row.changes.reactions[command!.emoji!] === command!.active) delete row.changes.reactions[command!.emoji!];
					await tx.put(COLLECTION, row.id, {
						...row,
						base: remote,
						readAt: this.now(),
						mutationAt: this.now(),
						pending: undefined,
						pendingVersion: undefined,
						claim: undefined,
						state: hasChanges(row) ? 'pending' : 'synced',
						attempts: 0,
						retryAt: 0,
						error: undefined
					});
				});
				completed++;
			} catch (error) {
				this.lease.assertCurrent();
				await this.tx('readwrite', async (tx) => {
					const row = await tx.get<RecordState>(COLLECTION, item.id);
					if (row?.claim?.token !== item.claim!.token) return;
					const status = Number((error as any)?.status),
						state: SyncState = status === 409 ? 'conflict' : [400, 401, 403, 404, 410, 413, 422].includes(status) ? 'error' : 'pending';
					await tx.put(COLLECTION, row.id, {
						...row,
						state,
						claim: undefined,
						attempts: row.attempts + 1,
						retryAt: this.now() + Math.min(60_000, 1000 * 2 ** Math.min(row.attempts, 6)),
						error:
							state === 'conflict'
								? 'Account interactions changed. Review before syncing.'
								: state === 'error'
								? 'Account interaction sync was refused. Your local choice is preserved.'
								: 'Saved on this device; waiting to sync.'
					});
				});
				break;
			} finally {
				unsubscribe();
				signal.removeEventListener('abort', abort);
			}
		}
		return { completed };
	}
}
