import { syncScopeKey, type SyncScope } from './reconcile';
import type { ForegroundSyncProgress } from './foregroundSync';
import type { createConflictReviewController } from './conflictReviewController';
import type { SyncConflict, SyncConflictChoice } from './conflictResolution';
import type { FolderHost } from './desktopFolders.client';

export type SyncTaskSnapshot = {
	scope: SyncScope;
	active: boolean;
	host?: FolderHost;
	progress: ForegroundSyncProgress & { message?: string };
	pagedReview?: ReturnType<typeof createConflictReviewController>;
	legacyReview?: { conflicts: SyncConflict[]; apply(choices: SyncConflictChoice[]): void; retain(): void; cancel(): void };
};

/** App-owned execution. Subscribers are views, never owners of cancellation.
 * The existing journal owns durable operations; this object owns only the live
 * run and its review handoff. One run avoids competing native request streams. */
export function createSyncTaskRuntime() {
	let snapshot: SyncTaskSnapshot | null = null;
	let active: AbortController | undefined;
	const listeners = new Set<() => void>();
	const publish = (value: SyncTaskSnapshot | null) => {
		snapshot = value;
		for (const listener of listeners) listener();
	};
	return {
		read: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		cancel(scope: SyncScope) { if (snapshot && syncScopeKey(scope) === syncScopeKey(snapshot.scope)) active?.abort(); },
		invalidate() { active?.abort(); publish(null); },
		async start(scope: SyncScope, run: (signal: AbortSignal, update: (patch: Partial<Pick<SyncTaskSnapshot, 'progress' | 'pagedReview' | 'legacyReview' | 'host'>>) => void) => Promise<void>) {
			if (active) throw Error('A transfer is already running. Reopen its connection to review or stop it.');
			syncScopeKey(scope);
			const controller = new AbortController(); active = controller;
			publish({ scope: structuredClone(scope), active: true, progress: { stage: 'checking', confirmed: 0, total: 0 } });
			const update = (patch: Partial<Pick<SyncTaskSnapshot, 'progress' | 'pagedReview' | 'legacyReview' | 'host'>>) => {
				controller.signal.throwIfAborted();
				if (snapshot) publish({ ...snapshot, ...patch });
			};
			try { await run(controller.signal, update); }
			catch (error) {
				if (snapshot) publish({ ...snapshot, progress: { ...snapshot.progress,
					message: controller.signal.aborted ? 'Transfer stopped. Retry to recover saved work.' :
						error instanceof Error ? error.message : 'Transfer interrupted. Retry to recover saved work.' } });
			} finally {
				if (snapshot) publish({ ...snapshot, active: false, pagedReview: undefined, legacyReview: undefined });
				if (active === controller) active = undefined;
			}
		}
	};
}
