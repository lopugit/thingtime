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
	const publish = (value: SyncTaskSnapshot | null) => {
		snapshot = value;
		for (const listener of listeners) listener();
	};
	return {
		read: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		async cancel(scope: SyncScope) {
			if (!snapshot || syncScopeKey(scope) !== syncScopeKey(snapshot.scope) || !active) return;
			const controller = active;
			suspensionMessage = undefined;
			try { await saveStop?.(); } finally { if (active === controller) controller.abort(); }
		},
		// Lifecycle interruption preserves runnable admission. Only cancel saves
		// the user's durable Stop, so returning to the foreground can recover.
		suspend(message: string) { if (active && !active.signal.aborted) { suspensionMessage = message; active.abort(); } },
		invalidate() { active?.abort(); transferSession?.clear(); publish(null); },
		async start(scope: SyncScope, run: (signal: AbortSignal, update: (patch: Partial<Pick<SyncTaskSnapshot, 'progress' | 'progressDescriptor' | 'inventoryDescriptor' | 'pagedReview' | 'legacyReview' | 'host'>> & { transfer?: TransferActivity }) => void) => Promise<void>, onStop?: () => Promise<void>) {
			if (active) throw Error('A transfer is already running. Reopen its connection to review or stop it.');
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
				if (snapshot) publish({ ...snapshot, ...view });
			};
			try { await run(controller.signal, update); }
			catch (error) {
				const waiting = !controller.signal.aborted && (error instanceof SyncConditionsWait || error instanceof NativeInventoryRetryWait || error instanceof SyncConnectionWait);
				if (snapshot) publish({ ...snapshot, waiting, status: controller.signal.aborted || waiting ? 'paused' : 'error', progress: { ...snapshot.progress,
					message: controller.signal.aborted ? suspensionMessage ?? 'Transfer stopped. Retry to recover saved work.' :
						error instanceof Error ? error.message : 'Transfer interrupted. Retry to recover saved work.' } });
			} finally {
				transfers.stop();
				if (snapshot) publish({ ...snapshot, active: false,
					status: snapshot.status === 'running' ? (snapshot.progress.stage === 'complete' ? 'complete' : 'paused') : snapshot.status,
					pagedReview: undefined, legacyReview: undefined });
				if (active === controller) { active = undefined; saveStop = undefined; }
			}
		}
	};
}
