import { AccountAlgorithmSelection, ACCOUNT_ALGORITHM_SELECTION, type AccountAlgorithmSelectionState } from './algorithmSelection';
import { LocalAlgorithms } from './algorithms';
import type { LocalThing } from './things';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceScope, type WorkspaceLease, type WorkspaceTransaction } from './storage';
import { accountSyncDeadline, type SyncState } from './accountSync';
import { copyBoundedJson } from '../utils/boundedJson';
import { MAX_SAVED_ALGORITHMS } from '../api/utils/algorithms/algorithmContent';
import { parseAlgorithmTransfer, type AlgorithmTransferContent } from '../api/utils/algorithms/algorithmTransferCore';
import { algorithmTransferContent, isTransferAlgorithm, validateTransferAlgorithm } from '../utils/thingTransfer/algorithm';
import {
	parseAlgorithmWrite,
	parseAlgorithmWriteAcknowledgment,
	validAlgorithmVersion,
	type AlgorithmWrite,
	type AlgorithmWriteAcknowledgment
} from '../api/utils/algorithms/algorithmSyncContract';

type Scope = Extract<WorkspaceScope, { kind: 'account' }>;
export type AccountAlgorithmSnapshot = {
	id: string;
	version: string;
	content: AlgorithmTransferContent;
	description: string;
	parentId: string | null;
	shared: boolean;
	listed: boolean;
	folderId: string | null;
	legacy: boolean;
	createdAt: string;
	updatedAt: string;
};
export type AccountAlgorithmTransport = {
	snapshot(signal: AbortSignal): Promise<AccountAlgorithmSnapshot[]>;
	write(command: AlgorithmWrite, signal: AbortSignal): Promise<AlgorithmWriteAcknowledgment>;
};
export type AccountAlgorithmState = {
	id: string;
	revision: number;
	base: Omit<AccountAlgorithmSnapshot, 'content'> | null;
	baseVersion: string | null;
	state: SyncState;
	deleted: boolean;
	remoteFolderId?: string | null;
	placementIntent?: boolean;
	pending?: { command: AlgorithmWrite; revision: number };
	claim?: { token: string; expiresAt: number };
	retryAt: number;
	attempts: number;
	error?: string;
};
type State = AccountAlgorithmState;
const profileMetadata = ({ content: _content, ...metadata }: AccountAlgorithmSnapshot) => metadata;
type Catalog = { epoch: number; read: number; complete: boolean };
const collection = 'account-algorithm-sync',
	catalogKey = 'account-algorithm-catalog';
export { collection as ACCOUNT_ALGORITHM_SYNC };
const blankCatalog = (): Catalog => ({ epoch: 0, read: 0, complete: false });
const fail = (message: string, code = 'ALGORITHM_SYNC_CONFLICT', status = 409): never => {
	throw new WorkspaceError(code, message, status);
};
const identity = (value: unknown): value is string =>
	typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value) && !value.startsWith('timeline-');
const stamp = (value: unknown): value is string =>
	typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
/** A malformed or partial remote catalogue must never imply local deletions. */
export function parseAccountAlgorithmSnapshot(input: unknown): AccountAlgorithmSnapshot[] {
	const rows = copyBoundedJson(input, { maxBytes: 8 * 1024 * 1024, maxDepth: 12, maxNodes: 250000 });
	if (!Array.isArray(rows) || rows.length > MAX_SAVED_ALGORITHMS) return fail('Invalid algorithm catalogue.', 'INVALID_ALGORITHM_SNAPSHOT', 502);
	const seen = new Set<string>();
	return rows.map((raw) => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Invalid algorithm catalogue.', 'INVALID_ALGORITHM_SNAPSHOT', 502);
		const row = raw as Record<string, any>;
		if (
			Object.keys(row).some(
				(key) =>
					!['id', 'version', 'content', 'description', 'parentId', 'shared', 'listed', 'folderId', 'legacy', 'createdAt', 'updatedAt'].includes(key)
			) ||
			!identity(row.id) ||
			seen.has(row.id) ||
			!validAlgorithmVersion(row.version) ||
			typeof row.description !== 'string' ||
			row.description.length > 300 ||
			(row.parentId !== null && !identity(row.parentId)) ||
			(row.folderId !== null && !identity(row.folderId)) ||
			typeof row.shared !== 'boolean' ||
			typeof row.listed !== 'boolean' ||
			typeof row.legacy !== 'boolean' ||
			!stamp(row.createdAt) ||
			!stamp(row.updatedAt)
		)
			return fail('Invalid algorithm catalogue.', 'INVALID_ALGORITHM_SNAPSHOT', 502);
		seen.add(row.id);
		return { ...row, content: parseAlgorithmTransfer(row.content) } as AccountAlgorithmSnapshot;
	});
}
/** The same protected local writer serves anonymous and account workspaces.
 * Only this account-only adapter adds retry metadata in the original home scope.
 * It has no network authority: the transport must verify a fresh remote lease. */
export class AccountAlgorithmSync {
	readonly algorithms: LocalAlgorithms;
	readonly selection: AccountAlgorithmSelection;
	constructor(
		private db: WorkspaceDatabase,
		readonly scope: Scope,
		private lease: WorkspaceLease,
		private now = () => Date.now(),
		private uuid = () => crypto.randomUUID(),
		observationScope: Scope = scope
	) {
		if (scope.kind !== 'account') return fail('Anonymous algorithms never synchronize.', 'ACCOUNT_REQUIRED', 403);
		if (scope.dataPlane !== 'home') return fail('Account algorithms belong to the home workspace.', 'ALGORITHM_HOME_REQUIRED');
		this.selection = new AccountAlgorithmSelection(db, scope, lease, now, uuid);
		this.algorithms = new LocalAlgorithms(db, lease, {
			scope,
			observationScope,
			now,
			uuid,
			onActive: (tx, id) => this.selection.setIn(tx, id),
			onWrite: (tx, row, previous) => this.mutated(tx, row, previous)
		});
	}
	private tx<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>, signal?: AbortSignal) {
		const lease: WorkspaceLease = signal
			? {
					assertCurrent: () => {
						this.lease.assertCurrent();
						signal.throwIfAborted();
					},
					onInvalidate: (callback) => {
						const off = this.lease.onInvalidate(callback);
						signal.addEventListener('abort', callback, { once: true });
						return () => {
							off();
							signal.removeEventListener('abort', callback);
						};
					}
			  }
			: this.lease;
		return this.db.transaction(this.scope, mode, lease, run);
	}
	private async bump(tx: WorkspaceTransaction) {
		const old = (await tx.get<Catalog>('settings', catalogKey)) ?? blankCatalog();
		await tx.put('settings', catalogKey, { ...old, epoch: old.epoch + 1 });
	}
	private async mutated(tx: WorkspaceTransaction, row: LocalThing | null, previous: LocalThing | null) {
		const id = row?.id ?? previous!.id,
			old = await tx.get<State>(collection, id);
		if (previous && !old) return fail('Refresh this account algorithm before editing it.');
		if (!row && old?.baseVersion === null && !old.pending) {
			await tx.delete(collection, id);
			await this.bump(tx);
			return;
		}
		await tx.put(collection, id, {
			id,
			revision: (old?.revision ?? 0) + 1,
			base: old?.base ?? null,
			baseVersion: old?.baseVersion ?? null,
			remoteFolderId: old?.remoteFolderId !== undefined ? old.remoteFolderId : old?.base?.folderId ?? null,
			placementIntent: old?.placementIntent || (row?.folderId ?? null) !== (previous?.folderId ?? null),
			state: old && ['conflict', 'error'].includes(old.state) ? old.state : 'pending',
			deleted: !row,
			pending: old?.pending,
			claim: old?.claim,
			retryAt: old?.retryAt ?? 0,
			attempts: old?.attempts ?? 0,
			error: old?.error
		} satisfies State);
		await this.bump(tx);
	}
	/** Canonical import already validated the bundle and remapped every ID.
	 * This hook adds account intent in that same device transaction. */
	async importIn(tx: WorkspaceTransaction, row: LocalThing) {
		this.lease.assertCurrent();
		validateTransferAlgorithm(row);
		if ((await tx.get(collection, row.id)) || (await tx.get('thing-sync', row.id)))
			return fail('An imported algorithm must have an independent identity.');
		await this.mutated(tx, row, null);
		const state = (await tx.get<State>(collection, row.id))!;
		await tx.put(collection, row.id, { ...state, placementIntent: true });
	}
	async viewIn(tx: WorkspaceTransaction, id: string) {
		this.lease.assertCurrent();
		const row = await tx.get<LocalThing>('things', id),
			state = await tx.get<State>(collection, id);
		if (!row || !isTransferAlgorithm(row) || !state || state.deleted) return null;
		return {
			...row,
			visibility: 'private',
			acl: ['tt:user'],
			author: { id: this.scope.ownerId },
			syncState: state.state,
			localOnly: false,
			localWorkspace: true
		};
	}
	async isDeletedIn(tx: WorkspaceTransaction, id: string) {
		return !!(await tx.get<State>(collection, id))?.deleted;
	}
	async moveIn(tx: WorkspaceTransaction, row: LocalThing, previous: LocalThing) {
		this.lease.assertCurrent();
		validateTransferAlgorithm({ ...row, crystal: algorithmTransferContent(row.crystal) });
		const stable = (value: unknown) =>
			JSON.stringify(copyBoundedJson(value, { maxBytes: 2 * 1024 * 1024, maxDepth: 12, maxNodes: 65000, sortKeys: true }));
		if (row.id !== previous.id || stable(row.crystal) !== stable(previous.crystal))
			return fail('Algorithm placement cannot replace its protected content.');
		await this.mutated(tx, row, previous);
		const state = (await tx.get<State>(collection, row.id))!;
		await tx.put(collection, row.id, { ...state, placementIntent: true });
	}
	async renameIn(tx: WorkspaceTransaction, row: LocalThing, previous: LocalThing) {
		this.lease.assertCurrent();
		if (this.scope.dataPlane !== 'home') return fail('Rename algorithms in the home library.');
		validateTransferAlgorithm({ ...row, crystal: algorithmTransferContent(row.crystal) });
		const { title: _new, ...next } = row.crystal, { title: _old, ...before } = previous.crystal;
		const stable = (value: unknown) => JSON.stringify(copyBoundedJson(value, { maxBytes: 2 * 1024 * 1024, maxDepth: 12, maxNodes: 65000, sortKeys: true }));
		if (row.id !== previous.id || row.folderId !== previous.folderId || stable(next) !== stable(before))
			return fail('Algorithm title changes cannot replace protected content.');
		await this.mutated(tx, row, previous);
	}
	removeIn(tx: WorkspaceTransaction, id: string) {
		return this.algorithms.removeIn(tx, id);
	}
	async prepareFolderDelete(tx: WorkspaceTransaction, id: string, destination: string | null) {
		for (const { value: state } of await tx.list<State>(collection)) {
			const remoteFolder = state.remoteFolderId !== undefined ? state.remoteFolderId : state.base?.folderId;
			const pendingFolder = state.pending?.command.action === 'save' ? state.pending.command.folderId : undefined;
			if (remoteFolder !== id && pendingFolder !== id) continue;
			const local = await tx.get<LocalThing>('things', state.id);
			if (local?.folderId === id) {
				const moved = {
					...local,
					folderId: destination,
					revision: local.revision + 1,
					updatedAt: new Date(Math.max(this.now(), Date.parse(local.updatedAt) + 1)).toISOString()
				};
				await tx.put('things', local.id, moved);
				await this.moveIn(tx, moved, local);
			}
			if (['conflict', 'error'].includes(state.state))
				return fail('Review the algorithm conflict before retrying this folder deletion.', 'ALGORITHM_SYNC_BLOCKED');
			return false;
		}
		return true;
	}
	async exportSnapshot() {
		return this.tx('readonly', async (tx) => {
			const states = (await tx.list<State>(collection)).map((row) => row.value),
				things: LocalThing[] = [];
			for (const state of states) {
				if (state.deleted) continue;
				const row = await tx.get<LocalThing>('things', state.id);
				if (!row || !isTransferAlgorithm(row)) return fail('Retained algorithm content is incomplete.', 'LOCAL_ALGORITHM_INCOMPLETE');
				things.push({
					id: row.id,
					thingtime: ['feed-algorithm'],
					crystal: algorithmTransferContent(row.crystal),
					...(row.folderId ? { folderId: row.folderId } : {}),
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
					revision: row.revision
				});
			}
			return {
				things,
				records: states.map((state) => ({
					id: state.id,
					state: state.state,
					remote: state.baseVersion !== null,
					deleted: state.deleted,
					complete: true
				}))
			};
		});
	}
	async assertExportReadable(ids: Iterable<string>) {
		return this.tx('readonly', async (tx) => {
			for (const id of ids)
				if (!(await this.viewIn(tx, id))) return fail('This algorithm is no longer available for export.', 'EXPORT_ACCESS_REFUSED');
		});
	}
	async list() {
		return this.tx('readonly', async (tx) => {
			const result = await this.algorithms.listIn(tx);
			const states = new Map((await tx.list<State>(collection)).map(({ id, value }) => [id, value]));
			return {
				...result,
				algorithms: result.algorithms.map((row) => {
					const state = states.get(row.id);
					return {
						...row,
						localOnly: false,
						localSaved: true,
						shared: state?.base?.shared ?? false,
						listed: state?.base?.listed ?? false,
						syncState: state?.state ?? 'error',
						syncError: state?.error
					};
				}),
				complete: (await tx.get<Catalog>('settings', catalogKey))?.complete === true
			};
		});
	}
	async status() {
		return this.tx('readonly', async (tx) => (await tx.list<State>(collection)).map((row) => row.value));
	}
	async beginRead() {
		return this.tx('readwrite', async (tx) => {
			const old = (await tx.get<Catalog>('settings', catalogKey)) ?? blankCatalog(),
				next = { ...old, read: old.read + 1 };
			await tx.put('settings', catalogKey, next);
			return { read: next.read, epoch: next.epoch };
		});
	}
	private async install(tx: WorkspaceTransaction, remote: AccountAlgorithmSnapshot, old?: State) {
		const row = await tx.get<LocalThing>('things', remote.id);
		if (row && (!isTransferAlgorithm(row) || !old)) return fail('Account algorithm collides with another device Thing.');
		await tx.put('things', remote.id, {
			...row,
			id: remote.id,
			thingtime: ['feed-algorithm'],
			crystal: { ...remote.content, parentId: remote.parentId, description: remote.description },
			folderId: remote.folderId,
			createdAt: row?.createdAt ?? remote.createdAt,
			updatedAt: new Date(Math.max(Date.parse(remote.updatedAt), row ? Date.parse(row.updatedAt) + 1 : 0)).toISOString(),
			revision: (row?.revision ?? 0) + 1
		} satisfies LocalThing);
		await tx.put(collection, remote.id, {
			id: remote.id,
			revision: (old?.revision ?? 0) + 1,
			base: remote ? profileMetadata(remote) : null,
			baseVersion: remote.version,
			remoteFolderId: remote.folderId,
			state: 'synced',
			deleted: false,
			retryAt: 0,
			attempts: 0
		} satisfies State);
	}
	async remember(input: unknown, ticket: { read: number; epoch: number }, signal?: AbortSignal) {
		const remote = parseAccountAlgorithmSnapshot(input);
		return this.tx(
			'readwrite',
			async (tx) => {
				const catalog = (await tx.get<Catalog>('settings', catalogKey)) ?? blankCatalog();
				if (catalog.read !== ticket.read || catalog.epoch !== ticket.epoch) return false;
				const states = new Map((await tx.list<State>(collection)).map((row) => [row.id, row.value])),
					present = new Set(remote.map((row) => row.id));
				const dependents = new Set((await tx.list<LocalThing>('things')).flatMap(({ value }) => [value.folderId, value.targetId].filter(Boolean)));
				for (const row of remote) {
					const old = states.get(row.id);
					if (old?.deleted) continue;
					if (!old || old.state === 'synced') {
						if (!old || old.baseVersion !== row.version || old.base?.version !== row.version) await this.install(tx, row, old);
					}
				}
				const choice = await tx.get<AccountAlgorithmSelectionState>('settings', ACCOUNT_ALGORITHM_SELECTION);
				for (const [id, state] of states)
					if (!present.has(id) && state.state === 'synced' && !state.deleted) {
						if (dependents.has(id) || (choice?.state !== 'synced' && choice?.desired === id) || choice?.pending?.command.algorithmId === id) {
							await tx.put(collection, id, {
								...state,
								state: 'conflict',
								revision: state.revision + 1,
								error: 'Account algorithm was removed. Review the device choice or related Things before discarding it.'
							});
							continue;
						}
						await tx.delete('things', id);
						await tx.delete(collection, id);
						// Reconcile the account pointer through the independent selection reader.
					}
				if ((await tx.list<LocalThing>('things')).filter((row) => isTransferAlgorithm(row.value)).length > MAX_SAVED_ALGORITHMS)
					return fail('Retaining this catalogue exceeds the device algorithm limit.', 'LOCAL_QUOTA', 413);
				await tx.put('settings', catalogKey, { ...catalog, complete: true, epoch: catalog.epoch + 1 });
				return true;
			},
			signal
		);
	}
	async refresh(transport: AccountAlgorithmTransport, signal = new AbortController().signal) {
		const ticket = await this.beginRead();
		return this.remember(await accountSyncDeadline((s) => transport.snapshot(s), signal), ticket, signal);
	}
	async sync(transport: AccountAlgorithmTransport, signal = new AbortController().signal, maxWrites = 25) {
		let completed = 0;
		for (let i = 0; i < Math.min(100, Math.max(0, maxWrites)) && !signal.aborted; i++) {
			const claimed = await this.tx(
				'readwrite',
				async (tx) => {
					const states = await tx.list<State>(collection);
					let blockedDeletions: Set<string> | undefined;
					for (const { value: row } of states) {
						if (!['pending', 'syncing'].includes(row.state) || row.retryAt > this.now() || (row.claim && row.claim.expiresAt > this.now())) continue;
						let pending = row.pending;
						if (!pending) {
							const thing = await tx.get<LocalThing>('things', row.id);
							if (row.deleted) {
								if (!blockedDeletions) {
									const unsent = new Set(states.filter(({ value }) => value.baseVersion === null && !value.deleted).map((row) => row.id));
									blockedDeletions = new Set(
										(await tx.list<LocalThing>('things'))
											.filter(({ value }) => unsent.has(value.id) && isTransferAlgorithm(value) && typeof value.crystal.parentId === 'string')
											.map(({ value }) => String(value.crystal.parentId))
									);
								}
								if (blockedDeletions.has(row.id)) continue;
							}
							if (!row.deleted && row.placementIntent && thing?.folderId) {
								const folder = await tx.get<{ base?: { id?: string }; deleted?: unknown }>('thing-sync', thing.folderId);
								if (folder && (!folder.base || folder.base.id !== thing.folderId || folder.deleted)) continue;
							}
							const parent = thing?.crystal.parentId;
							if (!row.baseVersion && parent) {
								const state = await tx.get<State>(collection, String(parent));
								if (state && !state.baseVersion && !state.deleted) continue;
							}
							try {
								if (!row.deleted && (!thing || !isTransferAlgorithm(thing))) return fail('Retained profile is missing.');
								if (!row.baseVersion && parent) {
									const state = await tx.get<State>(collection, String(parent));
									if (!state?.baseVersion) return fail('The branch source is unavailable. Keep an independent copy before synchronizing.');
								}
								const common = { id: row.id, writeId: this.uuid(), expectedVersion: row.baseVersion };
								pending = {
									revision: row.revision,
									command: parseAlgorithmWrite(
										row.deleted
											? { ...common, action: 'delete' }
											: {
													...common,
													action: 'save',
													content: algorithmTransferContent(thing!.crystal),
													description: thing!.crystal.description ?? '',
													...(row.placementIntent ? { folderId: thing!.folderId || null } : {}),
													...(row.baseVersion === null ? { parentId: parent ?? null } : {})
											  }
									)
								};
							} catch {
								await tx.put(collection, row.id, {
									...row,
									state: 'error',
									error: 'The saved profile or branch source needs review before synchronization.'
								});
								await this.bump(tx);
								continue;
							}
						}
						const next = { ...row, pending, state: 'syncing' as const, claim: { token: this.uuid(), expiresAt: this.now() + 60000 } };
						await tx.put(collection, row.id, next);
						return next;
					}
					return null;
				},
				signal
			);
			if (!claimed) break;
			const controller = new AbortController(),
				off = this.lease.onInvalidate(() => controller.abort()),
				abort = () => controller.abort();
			signal.addEventListener('abort', abort, { once: true });
			if (signal.aborted) abort();
			try {
				const command = parseAlgorithmWrite(claimed.pending!.command),
					ack = parseAlgorithmWriteAcknowledgment(await accountSyncDeadline((s) => transport.write(structuredClone(command), s), controller.signal));
				if (
					ack.id !== command.id ||
					ack.writeId !== command.writeId ||
					ack.action !== command.action ||
					ack.expectedVersion !== command.expectedVersion
				)
					return fail('Algorithm acknowledgment does not match the saved operation.', 'INVALID_ALGORITHM_ACK', 502);
				await this.tx(
					'readwrite',
					async (tx) => {
						const row = await tx.get<State>(collection, claimed.id);
						if (row?.claim?.token !== claimed.claim!.token) return;
						await tx.put(collection, row.id, {
							...row,
							baseVersion: ack.resultVersion,
							base: command.action === 'delete' ? null : row.base,
							remoteFolderId:
								command.action === 'delete'
									? null
									: command.folderId !== undefined
									? command.folderId
									: row.remoteFolderId !== undefined
									? row.remoteFolderId
									: row.base?.folderId ?? null,
							placementIntent: row.revision === claimed.pending!.revision ? undefined : row.placementIntent,
							pending: undefined,
							claim: undefined,
							state: row.revision === claimed.pending!.revision ? 'synced' : 'pending',
							attempts: 0,
							retryAt: 0,
							error: undefined
						});
						await this.bump(tx);
					},
					controller.signal
				);
				completed++;
			} catch (error) {
				this.lease.assertCurrent();
				await this.tx('readwrite', async (tx) => {
					const row = await tx.get<State>(collection, claimed.id);
					if (row?.claim?.token !== claimed.claim!.token) return;
					const status = Number((error as any)?.status),
						state: SyncState =
							status === 409 && !['WORKSPACE_CHANGED', 'ACCOUNT_UNCONFIRMED'].includes((error as any)?.code)
								? 'conflict'
								: [400, 401, 403, 404, 410, 413, 422].includes(status)
								? 'error'
								: 'pending';
					await tx.put(collection, row.id, {
						...row,
						claim: undefined,
						state,
						attempts: row.attempts + 1,
						retryAt:
							this.now() +
							Math.max(Math.min(60000, 1000 * 2 ** Math.min(row.attempts, 6)), Math.min(86400000, Number((error as any)?.retryAfterMs) || 0)),
						error:
							state === 'conflict'
								? 'Account algorithm changed. Review before synchronizing.'
								: state === 'error'
								? 'Account save was refused. Device changes are preserved.'
								: 'Saved on this device; waiting to synchronize.'
					});
					await this.bump(tx);
				});
				break;
			} finally {
				off();
				signal.removeEventListener('abort', abort);
			}
		}
		return { completed };
	}
	async retry(id: string) {
		return this.tx('readwrite', async (tx) => {
			const row = await tx.get<State>(collection, id);
			if (!row) return;
			if (row.state === 'conflict') return fail('Review the account algorithm before retrying.');
			if (row.claim && row.claim.expiresAt > this.now()) return;
			await tx.put(collection, id, { ...row, state: 'pending', retryAt: 0, error: undefined });
			await this.bump(tx);
		});
	}

	async inspect(id: string, transport: AccountAlgorithmTransport, signal = new AbortController().signal) {
		const remote =
			parseAccountAlgorithmSnapshot(await accountSyncDeadline((s) => transport.snapshot(s), signal)).find((row) => row.id === id) ?? null;
		return this.tx(
			'readonly',
			async (tx) => {
				const state = await tx.get<State>(collection, id);
				if (!state || !['conflict', 'error'].includes(state.state) || state.claim) return fail('Algorithm is not ready for conflict review.');
				return { id, revision: state.revision, remote, local: (await tx.get<LocalThing>('things', id)) ?? null };
			},
			signal
		);
	}
	async resolve(
		review: Awaited<ReturnType<AccountAlgorithmSync['inspect']>>,
		keep: 'local' | 'remote' | 'copy',
		transport: AccountAlgorithmTransport,
		signal = new AbortController().signal
	) {
		if (!['local', 'remote', 'copy'].includes(keep)) return fail('Choose the device profile, account profile or independent copy.');
		const stable = (value: unknown) =>
			JSON.stringify(copyBoundedJson(value, { maxBytes: 8 * 1024 * 1024, maxDepth: 12, maxNodes: 250000, sortKeys: true }));
		const remote =
			parseAccountAlgorithmSnapshot(await accountSyncDeadline((s) => transport.snapshot(s), signal)).find((row) => row.id === review.id) ?? null;
		if (stable(remote) !== stable(review.remote)) return fail('Account algorithm changed again. Review it again.');
		return this.tx(
			'readwrite',
			async (tx) => {
				const state = await tx.get<State>(collection, review.id),
					local = (await tx.get<LocalThing>('things', review.id)) ?? null;
				if (
					!state ||
					state.revision !== review.revision ||
					state.claim ||
					!['conflict', 'error'].includes(state.state) ||
					stable(local) !== stable(review.local)
				)
					return fail('Device algorithm changed. Review it again.');
				let copyId: string | undefined;
				const independent = keep === 'copy' || (keep === 'local' && !remote && !!local);
				if (independent) {
					if (!local || !isTransferAlgorithm(local)) return fail('There is no device profile to copy.');
					const count = (await tx.list<LocalThing>('things')).filter((row) => isTransferAlgorithm(row.value)).length;
					if (count - (remote ? 0 : 1) + 1 > MAX_SAVED_ALGORITHMS) return fail('This workspace has reached its algorithm limit.', 'LOCAL_QUOTA', 413);
					copyId = this.uuid();
					if ((await tx.get('things', copyId)) || (await tx.get(collection, copyId)) || (await tx.get('thing-sync', copyId)))
						return fail('A new profile identity collided. Retry the copy.');
					const content = algorithmTransferContent(local.crystal),
						now = new Date(this.now()).toISOString();
					const copy: LocalThing = {
						id: copyId,
						thingtime: ['feed-algorithm'],
						crystal: {
							...content,
							name: (content.name + ' (device copy)').slice(0, 60),
							parentId: null,
							description: local.crystal.description ?? ''
						},
						...(local.folderId ? { folderId: local.folderId } : {}),
						createdAt: now,
						updatedAt: now,
						revision: 1
					};
					await tx.put('things', copyId, copy);
					await this.mutated(tx, copy, null);
					if ((await tx.get('settings', 'active-algorithm')) === review.id) {
						await tx.put('settings', 'active-algorithm', copyId);
						await this.selection.setIn(tx, copyId);
					}
				}
				if (keep === 'remote' || independent) {
					if (remote) await this.install(tx, remote, state);
					else {
						if ((await tx.list<LocalThing>('things')).some(({ value }) => value.targetId === review.id || value.folderId === review.id))
							return fail('Keep related device Things before removing this profile.');
						await tx.delete('things', review.id);
						await tx.put(collection, review.id, {
							...state,
							revision: state.revision + 1,
							base: null,
							baseVersion: null,
							remoteFolderId: null,
							state: 'synced',
							deleted: true,
							pending: undefined,
							claim: undefined,
							retryAt: 0,
							error: undefined
						});
						if ((await tx.get('settings', 'active-algorithm')) === review.id) {
							await tx.delete('settings', 'active-algorithm');
							await this.selection.setIn(tx, null);
						}
					}
				} else if (!remote && !local) {
					await tx.put(collection, review.id, {
						...state,
						revision: state.revision + 1,
						base: null,
						baseVersion: null,
						remoteFolderId: null,
						placementIntent: false,
						state: 'synced',
						deleted: true,
						pending: undefined,
						claim: undefined,
						retryAt: 0,
						error: undefined
					});
				} else
					await tx.put(collection, review.id, {
						...state,
						base: remote ? profileMetadata(remote) : null,
						baseVersion: remote!.version,
						remoteFolderId: remote!.folderId,
						placementIntent: !!local && (local.folderId ?? null) !== remote!.folderId,
						pending: undefined,
						claim: undefined,
						revision: state.revision + 1,
						state: 'pending',
						attempts: 0,
						retryAt: 0,
						error: undefined
					});
				await this.bump(tx);
				return { copyId };
			},
			signal
		);
	}
}
