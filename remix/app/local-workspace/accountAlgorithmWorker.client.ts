import { AccountAlgorithmSync } from './accountAlgorithms';
import { accountAlgorithmTransport } from './algorithmTransport.client';
import { createSyncPump } from './syncPump';
import { canSyncAccountWorkspace } from './runtime.client';
import type { WorkspaceDatabase, WorkspaceLease, WorkspaceScope } from './storage';

/** Home content uses the currently selected authority, never authority inferred
 * from the home destination. Each queue owns its own scheduling and failures. */
export function createAccountAlgorithmWorker(
	db: WorkspaceDatabase,
	authority: Extract<WorkspaceScope, { kind: 'account' }>,
	lease: WorkspaceLease,
	announce: () => void,
	wakeContent: () => void
) {
	const algorithms = new AccountAlgorithmSync(db, { ...authority, dataPlane: 'home' }, lease, undefined, undefined, authority);
	const transport = accountAlgorithmTransport(authority, lease),
		controller = new AbortController();
	const errors = { catalog: '', selection: '' };
	let stopped = false;
	const enabled = () => !stopped && navigator.onLine !== false && canSyncAccountWorkspace(authority);
	const reads: Partial<Record<keyof typeof errors, Promise<void>>> = {},
		lastRead = { catalog: 0, selection: 0 };
	const refresh = (kind: keyof typeof errors, force = false): Promise<void> => {
		if (!enabled()) return Promise.resolve();
		if (reads[kind]) return reads[kind]!;
		if (!force && Date.now() - lastRead[kind] < 30_000) return Promise.resolve();
		lastRead[kind] = Date.now();
		reads[kind] = (kind === 'catalog' ? algorithms.refresh(transport, controller.signal) : algorithms.selection.refresh(transport, controller.signal))
			.then((changed) => {
				lease.assertCurrent();
				const previous = errors[kind];
				errors[kind] = '';
				if (changed || previous) announce();
			})
			.catch(() => {
				lease.assertCurrent();
				const message =
					kind === 'catalog'
						? 'Account algorithms could not be refreshed. Device edits are still available.'
						: 'Account selection could not be refreshed. This device keeps its choice.';
				if (errors[kind] !== message) {
					errors[kind] = message;
					announce();
				}
			})
			.finally(() => {
				delete reads[kind];
			});
		return reads[kind]!;
	};
	const delay = (rows: { state: string; retryAt: number }[], completed: number) => {
		const pending = rows.filter((row) => ['pending', 'syncing'].includes(row.state));
		if (!pending.length) return null;
		const waits = pending.map((row) => row.retryAt - Date.now()).filter((wait) => wait > 0);
		return completed ? 0 : waits.length ? Math.min(...waits) : 60_000;
	};
	const selectionPump = createSyncPump(enabled, async () => {
		const before = JSON.stringify(await algorithms.selection.status());
		const result = await algorithms.selection.sync(
			transport,
			async (id) => !!(await algorithms.status()).find((row) => row.id === id && !row.deleted)?.baseVersion,
			controller.signal
		);
		const row = await algorithms.selection.status();
		if (JSON.stringify(row) !== before) announce();
		return delay(row ? [row] : [], result.completed);
	});
	const profilePump = createSyncPump(enabled, async () => {
		const before = JSON.stringify(await algorithms.status());
		const result = await algorithms.sync(transport, controller.signal),
			rows = await algorithms.status();
		if (JSON.stringify(rows) !== before) announce();
		if (result.completed) {
			selectionPump.wake();
			wakeContent();
		}
		return delay(rows, result.completed);
	});
	return {
		algorithms,
		transport,
		errors,
		refresh: (force = false) => refresh('catalog', force),
		refreshSelection: (force = false) => refresh('selection', force),
		wake(forceRefresh = false) {
			if (!enabled()) return;
			profilePump.wake();
			selectionPump.wake();
			void refresh('catalog', forceRefresh).catch(() => {});
			void refresh('selection', forceRefresh).catch(() => {});
		},
		stop() {
			stopped = true;
			controller.abort();
			profilePump.stop();
			selectionPump.stop();
		}
	};
}
