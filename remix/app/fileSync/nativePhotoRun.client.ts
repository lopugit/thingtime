import { rootIdentity } from '../utils/rootIdentity';
import { FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS, PHOTO_AUTOMATION_INTERVAL_MS } from './configuration';
import { assertConfiguredSyncApproval, readOwnedFileSyncConfiguration, type SavedFileSyncConfiguration } from './configuredPlan';
import { SyncConditionsWait } from './foregroundSyncContext';
import { openSyncJournal, syncScopeKey, withSyncRootLock } from './journal.client';
import { readNativePhotoRunProgress, supportsNativePhotoContinuation } from './mobileFolders.client';
import { createNativeSyncHost, isNativeSyncAdapterCurrent, type NativeSyncAdapter } from './nativeSyncHost.client';
import { assertPhotoSourcePolicy } from './photoSourcePolicy';
import { samePhotoBackupSource } from './photoSettingsPolicy';
import type { SyncScope } from './reconcile';

const pendingArms = new Map<string, AbortController>();
const authorityRetryAt = new Map<string, number>();
export function cancelAllPendingNativePhotoArms() { for (const arm of pendingArms.values()) arm.abort(); }
export function cancelPendingNativePhotoArm(scope: SyncScope) { pendingArms.get(syncScopeKey(scope))?.abort(); }

/** The browser supplies current consent and observes the native run. It never
 * prepares a file operation or transfers an original on this entry point. */
export async function armNativePhotoRun(input: {
	reviewed: SavedFileSyncConfiguration; scope: SyncScope; generation: number; adapter: NativeSyncAdapter;
	automatic: boolean; discoverySignal?: AbortSignal; isPaused(scope: SyncScope): boolean; resumeScope(scope: SyncScope): void;
}) {
	const { reviewed, scope, generation, adapter, automatic } = input;
	const key = syncScopeKey(scope), controller = new AbortController();
	if (automatic && pendingArms.has(key)) return;
	cancelPendingNativePhotoArm(scope);
	pendingArms.set(key, controller);
	const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(45_000), ...(input.discoverySignal ? [input.discoverySignal] : [])]);
	const check = () => {
		signal.throwIfAborted();
		const identity = rootIdentity.read();
		if (identity.pending || identity.generation !== generation || !isNativeSyncAdapterCurrent(adapter) ||
			window.location.origin !== scope.origin) throw Error('The active Photos account, server or device changed.');
	};
	const stop = () => controller.abort();
	const unsubscribe = rootIdentity.subscribe(() => { if (rootIdentity.read().pending || rootIdentity.read().generation !== generation) stop(); });
	window.addEventListener('pagehide', stop);
	try {
		await withSyncRootLock(scope, async () => {
			check();
			if (automatic && input.isPaused(scope)) return;
			const journal = await openSyncJournal();
			try {
				const jobs = journal.jobs({ scope, currentScope: () => { check(); return scope; }, signal });
				const prior = await jobs.read(); check();
				if (automatic && (prior?.state === 'paused' || input.isPaused(scope))) return;
				if (prior && !samePhotoBackupSource(prior.reviewed.configuration, reviewed.configuration))
					throw Error('The saved Photos grant changed. Review this connection before continuing.');
				const host = await createNativeSyncHost({ ownerId: scope.ownerId, deviceId: scope.deviceId, adapter, signal, assertCurrent: check });
				for (const [feature, minimum] of Object.entries(FILE_SYNC_PHOTO_AUTOMATION_REQUIREMENTS)) await host.requireCapability(feature, minimum);
				await host.requireCapability('api.file-sync-transfer-admissions', '1.3.0');
				const { localRootId, remoteFolderId } = reviewed.configuration;
				const statusScope = { rootId: localRootId, configurationId: reviewed.id, deviceId: scope.deviceId };
				if (automatic) {
					const status = await readNativePhotoRunProgress(scope.ownerId, statusScope, signal, host.request); check();
					const progress = status.photoRunProgress;
					if (status.configurationRevision === reviewed.updatedAt && progress) {
						// Build 53 reports expired authority as waiting without a retry date.
						// A live run can look the same. Rechecking its exact binding is
						// idempotent, and native retains the same checkpoint on renewal.
						const needsAuthorityCheck = progress.stage === 'waiting' && progress.retryAt === undefined &&
							progress.minimumPartBytes === undefined && progress.continuation === undefined;
						// A saved-settings hold describes lost authority, not a user
						// decision. Recheck the current grant and saved Thing below;
						// native/server authorization still decides whether it may run.
						const savedSettingsHold = progress.stage === 'needs-review' && progress.activity?.reason === 'saved-settings';
						if (progress.continuation === 'held' || (progress.stage !== 'paused' && !needsAuthorityCheck && !savedSettingsHold)) return;
						if (savedSettingsHold) {
							const now = Date.now();
							if (now < (authorityRetryAt.get(key) ?? 0) || (progress.retryAt && now < Date.parse(progress.retryAt))) return;
							// Condition/page wakes must not turn a persistent refusal into
							// a tight authorization loop. Failed checks retain this cooldown.
							for (const [scopeKey, retryAt] of authorityRetryAt) if (retryAt <= now) authorityRetryAt.delete(scopeKey);
							authorityRetryAt.set(key, now + PHOTO_AUTOMATION_INTERVAL_MS);
						}
					}
				}
				const { roots } = await host.request(scope.ownerId, { action: 'list' }, signal); check();
				assertPhotoSourcePolicy(reviewed.configuration, roots);
				const url = new URL('/api/v1/things', scope.origin); url.searchParams.set('id', reviewed.id);
				const response = await host.fetch(url, { credentials: 'include', cache: 'no-store', redirect: 'error', signal,
					headers: { 'X-Thingtime-Expected-Actor': scope.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home' } });
				check();
				if (!response.ok) throw Error('The saved Photos connection could not be verified.');
				const current = readOwnedFileSyncConfiguration((await response.json()).thing, scope.ownerId); check();
				assertConfiguredSyncApproval(current, { ...reviewed, scope }, scope, localRootId, remoteFolderId);
				if (current.configuration.paused) throw new SyncConditionsWait('paused');
				if (current.configuration.ignoreRules || current.configuration.resourceLimits)
					throw Error('This Photos connection has folder-only resource or Gitignore settings. Review its settings before continuing.');
				if (!automatic) {
					if (prior?.state === 'paused' && !(await jobs.resumePhotoPause(prior))) throw Error('The saved Photos pause changed. Reopen this connection.');
					check();
					input.resumeScope(scope);
				}
				if (input.isPaused(scope)) return;
				const continueInBackground = !automatic && adapter.platform === 'ios' && supportsNativePhotoContinuation(adapter.bridge, '1.1.0');
				await host.request(scope.ownerId, { action: 'arm-photo-run', rootId: localRootId,
					authorization: { ...reviewed, scope }, execution: 'native', ...(!automatic ? { resume: true as const } : {}),
					...(continueInBackground ? { continueInBackground: true as const } : {}) }, signal);
				check();
			} finally { journal.close(); }
		}, undefined, signal);
	} finally {
		if (pendingArms.get(key) === controller) pendingArms.delete(key);
		unsubscribe(); window.removeEventListener('pagehide', stop);
	}
}
