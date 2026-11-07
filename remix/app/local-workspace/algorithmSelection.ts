import { isDefaultAlgorithm } from '../components/Feed/defaultAlgorithms';
import {
	parseAlgorithmSelection,
	parseAlgorithmSelectionWrite,
	parseAlgorithmSelectionAcknowledgment,
	type AlgorithmSelection,
	type AlgorithmSelectionWrite,
	type AlgorithmSelectionAcknowledgment
} from '../api/utils/algorithms/algorithmSelectionContract';
import { accountSyncDeadline, type SyncState } from './accountSync';
import { WorkspaceError, type WorkspaceDatabase, type WorkspaceLease, type WorkspaceScope, type WorkspaceTransaction } from './storage';
export type AlgorithmSelectionTransport = {
	selection(signal: AbortSignal): Promise<AlgorithmSelection>;
	select(command: AlgorithmSelectionWrite, signal: AbortSignal): Promise<AlgorithmSelectionAcknowledgment>;
};
type State = {
	revision: number;
	desired: string | null;
	base: AlgorithmSelection | null;
	state: SyncState;
	pending?: { command: AlgorithmSelectionWrite; revision: number };
	claim?: { token: string; expiresAt: number };
	retryAt: number;
	attempts: number;
	error?: string;
};
const key = 'account-algorithm-selection';
export type AccountAlgorithmSelectionState = State;
export { key as ACCOUNT_ALGORITHM_SELECTION };
const fail = (message: string): never => {
	throw new WorkspaceError('SELECTION_CONFLICT', message, 409);
};
/** Independent pointer intent: applying a algorithm on this device never awaits
 * catalogue writes, account selection or a network read. */
export class AccountAlgorithmSelection {
	constructor(
		private db: WorkspaceDatabase,
		private scope: Extract<WorkspaceScope, { kind: 'account' }>,
		private lease: WorkspaceLease,
		private now = () => Date.now(),
		private uuid = () => crypto.randomUUID()
	) {
		if (scope.kind !== 'account') throw new WorkspaceError('ACCOUNT_REQUIRED', 'Anonymous selections never synchronize.', 403);
		if (scope.dataPlane !== 'home') throw new WorkspaceError('ALGORITHM_HOME_REQUIRED', 'Account selections belong to home.', 409);
	}
	private tx<T>(mode: IDBTransactionMode, run: (tx: WorkspaceTransaction) => Promise<T>, signal?: AbortSignal) {
		const lease = signal
			? {
					assertCurrent: () => {
						this.lease.assertCurrent();
						signal.throwIfAborted();
					},
					onInvalidate: (cb: () => void) => {
						const off = this.lease.onInvalidate(cb);
						signal.addEventListener('abort', cb, { once: true });
						return () => {
							off();
							signal.removeEventListener('abort', cb);
						};
					}
			  }
			: this.lease;
		return this.db.transaction(this.scope, mode, lease, run);
	}
	async setIn(tx: WorkspaceTransaction, algorithmId: string | null) {
		const old = await tx.get<State>('settings', key);
		if (old?.desired === algorithmId) return;
		await tx.put('settings', key, {
			revision: (old?.revision ?? 0) + 1,
			desired: algorithmId,
			base: old?.base ?? null,
			state: old?.state === 'conflict' || old?.state === 'error' ? old.state : 'pending',
			pending: old?.pending,
			claim: old?.claim,
			retryAt: old?.retryAt ?? 0,
			attempts: old?.attempts ?? 0,
			error: old?.error
		} satisfies State);
	}
	status() {
		return this.tx('readonly', (tx) => tx.get<State>('settings', key));
	}
	private async applyIn(tx: WorkspaceTransaction, algorithmId: string | null) {
		if (algorithmId) await tx.put('settings', 'active-algorithm', algorithmId);
		else await tx.delete('settings', 'active-algorithm');
	}
	async remember(raw: unknown, revision: number | null, signal?: AbortSignal) {
		const remote = parseAlgorithmSelection(raw);
		return this.tx(
			'readwrite',
			async (tx) => {
				const old = await tx.get<State>('settings', key);
				if ((old?.revision ?? null) !== revision) return false;
				if (!old || old.state === 'synced') {
					await tx.put('settings', key, {
						revision: (old?.revision ?? 0) + 1,
						desired: remote.algorithmId,
						base: remote,
						state: 'synced',
						retryAt: 0,
						attempts: 0
					} satisfies State);
					await this.applyIn(tx, remote.algorithmId);
					return true;
				}
				if (!old.base) {
					await tx.put('settings', key, { ...old, base: remote });
					return true;
				}
				return false;
			},
			signal
		);
	}
	async refresh(transport: AlgorithmSelectionTransport, signal = new AbortController().signal) {
		const revision = (await this.status())?.revision ?? null;
		const remote = await accountSyncDeadline((s) => transport.selection(s), signal);
		return this.remember(remote, revision, signal);
	}
	async sync(transport: AlgorithmSelectionTransport, ready: (id: string) => Promise<boolean>, signal = new AbortController().signal) {
		const first = await this.status();
		if (!first || !['pending', 'syncing'].includes(first.state) || first.retryAt > this.now()) return { completed: 0 };
		if (!first.base) await this.refresh(transport, signal);
		const state = await this.status();
		if (!state?.pending && state?.desired && !isDefaultAlgorithm(state.desired) && !(await ready(state.desired))) return { completed: 0 };
		const claimed = await this.tx(
			'readwrite',
			async (tx) => {
				const row = await tx.get<State>('settings', key);
				if (
					!row ||
					!row.base ||
					!['pending', 'syncing'].includes(row.state) ||
					row.retryAt > this.now() ||
					(row.claim && row.claim.expiresAt > this.now()) ||
					row.revision !== state?.revision
				)
					return null;
				const pending = row.pending ?? {
					command: parseAlgorithmSelectionWrite({ algorithmId: row.desired, expectedVersion: row.base.version, writeId: this.uuid() }),
					revision: row.revision
				};
				const next = { ...row, pending, state: 'syncing' as const, claim: { token: this.uuid(), expiresAt: this.now() + 60_000 } };
				await tx.put('settings', key, next);
				return next;
			},
			signal
		);
		if (!claimed) return { completed: 0 };
		const controller = new AbortController(),
			off = this.lease.onInvalidate(() => controller.abort()),
			abort = () => controller.abort();
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		try {
			const command = parseAlgorithmSelectionWrite(claimed.pending.command);
			let result: AlgorithmSelection;
			try {
				const acknowledgment = parseAlgorithmSelectionAcknowledgment(
					await accountSyncDeadline((s) => transport.select(structuredClone(command), s), controller.signal)
				);
				if (
					acknowledgment.algorithmId !== command.algorithmId ||
					acknowledgment.writeId !== command.writeId ||
					acknowledgment.expectedVersion !== command.expectedVersion
				)
					throw new WorkspaceError('INVALID_SELECTION_ACK', 'Selection acknowledgment changed.', 502);
				result = acknowledgment.result;
			} catch (error) {
				// Profile deletion can already have cleared the account pointer.
				// A freshly confirmed equal choice needs no second write or review.
				if (Number((error as any)?.status) !== 409 || ['WORKSPACE_CHANGED', 'ACCOUNT_UNCONFIRMED'].includes((error as any)?.code)) throw error;
				const observed = parseAlgorithmSelection(await accountSyncDeadline((s) => transport.selection(s), controller.signal));
				if (observed.algorithmId !== command.algorithmId) throw error;
				result = observed;
			}

			await this.tx(
				'readwrite',
				async (tx) => {
					const row = await tx.get<State>('settings', key);
					if (row?.claim?.token !== claimed.claim.token) return;
					await tx.put('settings', key, {
						...row,
						base: result,
						pending: undefined,
						claim: undefined,
						state: row.revision === claimed.pending.revision ? 'synced' : 'pending',
						attempts: 0,
						retryAt: 0,
						error: undefined
					});
				},
				controller.signal
			);
			return { completed: 1 };
		} catch (error) {
			this.lease.assertCurrent();
			await this.tx('readwrite', async (tx) => {
				const row = await tx.get<State>('settings', key);
				if (row?.claim?.token !== claimed.claim.token) return;
				const status = Number((error as any)?.status),
					changed = ['WORKSPACE_CHANGED', 'ACCOUNT_UNCONFIRMED'].includes((error as any)?.code),
					state: SyncState =
						status === 409 && !changed ? 'conflict' : !changed && [400, 401, 403, 404, 410, 413, 422].includes(status) ? 'error' : 'pending';
				await tx.put('settings', key, {
					...row,
					claim: undefined,
					state,
					attempts: row.attempts + 1,
					retryAt:
						this.now() +
						Math.max(Math.min(60_000, 1000 * 2 ** Math.min(row.attempts, 6)), Math.min(86_400_000, Number((error as any)?.retryAfterMs) || 0)),
					error:
						state === 'conflict'
							? 'Your account selected another algorithm. Review the choice.'
							: state === 'error'
							? 'Account selection was refused. This device keeps its choice.'
							: 'Applied on this device; waiting to synchronize.'
				});
			});
			return { completed: 0 };
		} finally {
			off();
			signal.removeEventListener('abort', abort);
		}
	}
	async retry() {
		return this.tx('readwrite', async (tx) => {
			const row = await tx.get<State>('settings', key);
			if (!row) return;
			if (row.state === 'conflict') return fail('Review the changed selection first.');
			if (row.claim && row.claim.expiresAt > this.now()) return;
			await tx.put('settings', key, { ...row, state: 'pending', retryAt: 0, error: undefined });
		});
	}
	async inspect(transport: AlgorithmSelectionTransport, signal = new AbortController().signal) {
		const remote = parseAlgorithmSelection(await accountSyncDeadline((s) => transport.selection(s), signal));
		return this.tx(
			'readonly',
			async (tx) => {
				const row = await tx.get<State>('settings', key);
				if (!row || row.claim || !['conflict', 'error'].includes(row.state)) return fail('The selection is not ready for review.');
				return { revision: row.revision, desired: row.desired, remote };
			},
			signal
		);
	}
	async resolve(
		review: Awaited<ReturnType<AccountAlgorithmSelection['inspect']>>,
		keep: 'local' | 'remote',
		transport: AlgorithmSelectionTransport,
		signal = new AbortController().signal
	) {
		if (!['local', 'remote'].includes(keep)) return fail('Choose the device or account selection.');
		const remote = parseAlgorithmSelection(await accountSyncDeadline((s) => transport.selection(s), signal));
		if (remote.version !== review.remote.version || remote.algorithmId !== review.remote.algorithmId)
			return fail('The account selection changed again.');
		return this.tx(
			'readwrite',
			async (tx) => {
				const row = await tx.get<State>('settings', key);
				if (!row || row.claim || row.revision !== review.revision || !['conflict', 'error'].includes(row.state))
					return fail('The device selection changed.');
				const desired = keep === 'local' ? row.desired : remote.algorithmId;
				await tx.put('settings', key, {
					...row,
					revision: row.revision + 1,
					base: remote,
					desired,
					state: keep === 'local' ? 'pending' : 'synced',
					pending: undefined,
					claim: undefined,
					attempts: 0,
					retryAt: 0,
					error: undefined
				});
				await this.applyIn(tx, desired);
			},
			signal
		);
	}
}
