import { syncScopeKey, type SyncScope } from './reconcile';
import type { ForegroundSyncProgress, SyncInventoryDescriptor } from './foregroundSync';
import type { createConflictReviewController } from './conflictReviewController';
import type { SyncConflict, SyncConflictChoice } from './conflictResolution';
import type { FolderHost } from './desktopFolders.client';
import type { SyncProgressDescriptor } from './progressProjection';
import { createTransferActivitySession, type TransferActivity } from './transferActivity';
import type { TransferSpeedSeries } from './transferSpeed';
import { SyncConditionsWait } from './foregroundSyncContext';
import { NativeInventoryRetryWait } from './nativeInventory';
import { SyncConnectionWait } from './syncConnectionWait';

export type SyncTaskSnapshot = {
	scope: SyncScope;
	active: boolean;
	stopping?: boolean;
	host?: FolderHost;
	progress: ForegroundSyncProgress & { message?: string };
	progressDescriptor?: SyncProgressDescriptor;
	inventoryDescriptor?: SyncInventoryDescriptor;
	transferSeries?: TransferSpeedSeries;
	status?: 'running' | 'paused' | 'error' | 'complete';
	waiting?: boolean;
	pagedReview?: ReturnType<typeof createConflictReviewController>;
	legacyReview?: { conflicts: SyncConflict[]; apply(choices: SyncConflictChoice[]): void; retain(): void; cancel(): void };
};

/** App-owned execution. Subscribers are views, never owners of cancellation.
 * The existing journal owns durable operations; this object owns only the live
 * run and its review handoff. One run avoids competing native request streams. */
export function createSyncTaskRuntime() {
	let snapshot: SyncTaskSnapshot | null = null;
	let active: AbortController | undefined;
	let saveStop: (() => Promise<void>) | undefined;
	let suspensionMessage: string | undefined;
	let transferSession: ReturnType<typeof createTransferActivitySession> | undefined;
	const listeners = new Set<() => void>();
	const pausedScopes = new Set<string>();
	let pendingStop: Promise<void> | undefined;
	let notification: ReturnType<typeof setTimeout> | undefined;
	const notify = () => { notification = undefined; for (const listener of listeners) listener(); };
	const publish = (value: SyncTaskSnapshot | null, immediate = true) => {
		snapshot = value;
		if (immediate) { clearTimeout(notification); notify(); }
		else if (notification === undefined) notification = setTimeout(notify, 100);
	};
	return {
		read: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		isPaused: (scope: SyncScope) => pausedScopes.has(syncScopeKey(scope)),
		async cancel(scope: SyncScope) {
			// Install the scope barrier synchronously, including idle discovery races.
			pausedScopes.add(syncScopeKey(scope));
			if (!snapshot || syncScopeKey(scope) !== syncScopeKey(snapshot.scope) || !active) return;
			if (pendingStop) return pendingStop;
			const controller = active;
			suspensionMessage = 'Transfer stopped. Saved work can be resumed.';
			let resolve!: () => void, reject!: (error: unknown) => void;
			const stopping = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
			pendingStop = stopping;
			publish({ ...snapshot, status: 'paused', stopping: true, waiting: false, progress: { ...snapshot.progress, message: 'Stopping transfer…' } });
			// Abort IO and CPU/rate waits before any persistence or capture cleanup.
			controller.abort();
			try { await saveStop?.();
				if (snapshot && active === controller) publish({ ...snapshot, progress: { ...snapshot.progress, message: suspensionMessage } });
				resolve(); }
			catch (error) {
				if (snapshot && active === controller) publish({ ...snapshot, status: 'error', progress: { ...snapshot.progress,
					message: error instanceof Error ? error.message : 'Transfer stopped, but its pause could not be saved.' } });
				reject(error);
			}
			return stopping;
		},
		// Lifecycle interruption preserves runnable admission. Only cancel saves
		// the user's durable Stop, so returning to the foreground can recover.
		suspend(message: string) { if (active && !active.signal.aborted) { suspensionMessage = message; active.abort(); } },
		invalidate() { active?.abort(); transferSession?.clear(); publish(null); },
		async start(scope: SyncScope, run: (signal: AbortSignal, update: (patch: Partial<Pick<SyncTaskSnapshot, 'progress' | 'progressDescriptor' | 'inventoryDescriptor' | 'pagedReview' | 'legacyReview' | 'host'>> & { transfer?: TransferActivity }) => void) => Promise<void>, onStop?: () => Promise<void>, options?: { automatic?: boolean }) {
			if (options?.automatic && pausedScopes.has(syncScopeKey(scope))) return;
			if (active) throw Error('A transfer is already running. Reopen its connection to review or stop it.');
			if (!options?.automatic) pausedScopes.delete(syncScopeKey(scope));
			pendingStop = undefined;
			syncScopeKey(scope);
			const controller = new AbortController(); active = controller; saveStop = onStop;
			suspensionMessage = undefined;
			const transfers = createTransferActivitySession(); transferSession = transfers;
			publish({ scope: structuredClone(scope), active: true, status: 'running', transferSeries: transfers.series, progress: { stage: 'checking', confirmed: 0, total: 0 } });
			const update = (patch: Partial<Pick<SyncTaskSnapshot, 'progress' | 'progressDescriptor' | 'inventoryDescriptor' | 'pagedReview' | 'legacyReview' | 'host'>> & { transfer?: TransferActivity }) => {
				controller.signal.throwIfAborted();
				const { transfer, ...view } = patch;
				if (view.progress) transfers.stage(view.progress.stage);
				if (transfer) transfers.add(transfer);
				if (snapshot) {
					const immediate = Object.keys(view).some(key => !['progress', 'progressDescriptor', 'inventoryDescriptor'].includes(key)) ||
						!!view.progress && (view.progress.stage !== snapshot.progress.stage || view.progress.stage === 'complete' || view.progress.stage === 'reviewing');
					publish({ ...snapshot, ...view }, immediate);
				}
			};
			try { await run(controller.signal, update); }
			catch (error) {
				const waiting = !controller.signal.aborted && (error instanceof SyncConditionsWait || error instanceof NativeInventoryRetryWait || error instanceof SyncConnectionWait);
				if (snapshot) publish({ ...snapshot, waiting, status: snapshot.stopping && snapshot.status === 'error' ? 'error' : controller.signal.aborted || waiting ? 'paused' : 'error', progress: { ...snapshot.progress,
					message: snapshot.stopping ? snapshot.progress.message : controller.signal.aborted ? suspensionMessage ?? 'Transfer stopped. Retry to recover saved work.' :
						error instanceof Error ? error.message : 'Transfer interrupted. Retry to recover saved work.' } });
			} finally {
				// The runner may own a journal needed by its stop hook. Do not release
				// execution until that hook settles, including failed pause persistence.
				await pendingStop?.catch(() => {});
				transfers.stop();
				if (snapshot) publish({ ...snapshot, active: false, stopping: false,
					status: snapshot.status === 'running' ? (snapshot.progress.stage === 'complete' ? 'complete' : 'paused') : snapshot.status,
					pagedReview: undefined, legacyReview: undefined });
				if (active === controller) { active = undefined; saveStop = undefined; pendingStop = undefined; }
			}
		}
	};
}
