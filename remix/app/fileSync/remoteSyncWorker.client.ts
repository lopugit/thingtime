import { readNativeSyncActivity } from './syncActivity.client';
import { withDeviceSyncHistoryRecordingIssue } from './deviceSyncHistory.client';
import { parseSyncDirections } from './directionalProgress';
import { readStampedCache } from '../hooks/localCache';
import { syncScopeKey } from './reconcile';
import type { ForegroundSyncProgress } from './foregroundSync';
import { rootIdentity } from '../utils/rootIdentity';
import { createNativeSyncHost, getNativeSyncAdapter, isNativeSyncAdapterCurrent } from './nativeSyncHost.client';
import type { FolderHost } from './desktopFolders.client';
import { supportsNativeSourcePaths, type MobileFolder } from './mobileFolders.client';
import { enrollNativeFolderSync, nativeSyncTasks, pauseNativeSyncJob, startNativeSyncTask } from './nativeSyncTasks.client';
import { readOwnedFileSyncConfiguration } from './configuredPlan';
import { openSyncJournal } from './journal.client';
import { holdDesktopSyncWindow } from './desktopSyncWindow.client';
import { createFolderHostFetch } from './folderHostFetch.client';
import { executeRemoteSyncDetails } from './remoteSyncDetails.client';
import type { SyncScope } from './reconcile';
import { deviceResourceKey, readDeviceSyncResourcePolicy, saveDeviceSyncResourcePolicy } from './deviceResourcePolicy';
import { REMOTE_SYNC_DIRECTION_REQUIREMENTS, REMOTE_SYNC_SOURCE_PATH_REQUIREMENTS, REMOTE_SYNC_RESOURCE_REQUIREMENTS, REMOTE_SYNC_HISTORY_REQUIREMENTS, REMOTE_SYNC_ACTIVITY_REQUIREMENTS, REMOTE_SYNC_RESULT_BYTES, validateRemoteSyncCommand, parseRemoteSyncResources, supportsRemoteResourceControls, type RemoteSyncCommand, type RemoteSyncStatus } from './remoteSyncProtocol';

export const REMOTE_SYNC_REQUIREMENTS = { 'api.devices-sync-control': '1.0.0' } as const;
// One bounded, host/owner/device/origin-scoped optional negotiation. A short
// expiry lets older deployments gain support without restarting ordinary jobs.
const sourcePathNegotiations = new WeakMap<FolderHost, { key: string; expiresAt: number; result: Promise<boolean> }>();
async function projectRemoteRoots(context: RemoteSyncWorkerContext, roots: MobileFolder[]): Promise<MobileFolder[]> {
 const { host } = context;
 let available = false;
 if (supportsNativeSourcePaths(host.capabilities)) {
  const key = JSON.stringify([host.origin(), context.ownerId, context.deviceId]);
  let entry = sourcePathNegotiations.get(host);
  if (!entry || entry.key !== key || entry.expiresAt <= Date.now()) {
   const result = Promise.resolve().then(() => host.requireCapability('api.devices-sync-control', REMOTE_SYNC_SOURCE_PATH_REQUIREMENTS['api.devices-sync-control'])).then(() => true, () => false);
   entry = { key, expiresAt: Date.now() + 30_000, result }; sourcePathNegotiations.set(host, entry);
  }
  available = await entry.result;
 }
 context.check();
 return roots.map(root => {
  if (available) return root;
  const { sourcePath: _sourcePath, ...withoutLocation } = root;
  return withoutLocation;
 });
}
const directionNegotiations = new WeakMap<FolderHost, { key: string; expires: number; result: Promise<boolean> }>();
async function remoteDirectionsReady(context: RemoteSyncWorkerContext) {
 if (!supportsRemoteResourceControls(context.host.capabilities)) return false;
 const key = JSON.stringify([context.host.origin(), context.ownerId, context.deviceId]);
 let saved = directionNegotiations.get(context.host);
 if (!saved || saved.key !== key || saved.expires < Date.now()) {
  saved = { key, expires: Date.now() + 30000, result: context.host.requireCapability('api.devices-sync-control', REMOTE_SYNC_DIRECTION_REQUIREMENTS['api.devices-sync-control']).then(() => true, () => false) }; directionNegotiations.set(context.host, saved);
 }
 const ready = await saved.result; context.check(); return ready;
}
const reviews = new WeakMap<object, string>();
const reviewId = (controller: object) => {
	let id = reviews.get(controller);
	if (!id) { id = crypto.randomUUID(); reviews.set(controller, id); }
	return id;
};
export type RemoteSyncWorkerContext = {
	ownerId: string; deviceId: string; generation: number; host: FolderHost; signal: AbortSignal;
	check(): void; scope(connectionId: string): SyncScope;
};
type DeviceSession = { host: FolderHost; nativeHost?: FolderHost; roots: MobileFolder[]; rootsReady: boolean; rootsObservedAt?: string };

async function accountRequest(context: RemoteSyncWorkerContext, path: string, body?: unknown) {
	context.check();
	const response = await context.host.fetch(new URL(path, context.host.origin()), {
		method: body === undefined ? 'GET' : 'POST', credentials: 'include', redirect: 'error', cache: 'no-store', signal: context.signal,
		headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
			'X-Thingtime-Expected-Actor': context.ownerId, 'X-Thingtime-Expected-Data-Plane': 'home' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	context.check();
	const value = await response.json(); context.check();
	if (!response.ok || value?.ok === false) throw Error('The remote sync account connection is unavailable.');
	return value;
}

async function readRemoteSyncConfiguration(context: RemoteSyncWorkerContext, connectionId: string) {
	const result = await accountRequest(context, `/api/v1/things?${new URLSearchParams({ id: connectionId })}`);
	const saved = readOwnedFileSyncConfiguration(result.thing, context.ownerId);
	if (saved.id !== connectionId || saved.configuration.deviceId !== context.deviceId)
		throw Error('The connection changed. Refresh its saved settings.');
	return saved;
}

const ownTask = (context: RemoteSyncWorkerContext) => {
	const task = nativeSyncTasks.read();
	return task?.scope.ownerId === context.ownerId && task.scope.deviceId === context.deviceId && task.scope.origin === context.host.origin() && task.scope.dataPlane === 'home' ? task : null;
};

async function authorizeRemoteHistoryRead(context: RemoteSyncWorkerContext) {
 const { host, ownerId, deviceId, signal } = context;
 // The rootless resource lane can verify identity while the native scan is busy.
 if (supportsRemoteResourceControls(host.capabilities)) {
  const authorization = await host.request(ownerId, { action: 'resources' }, AbortSignal.any([signal, AbortSignal.timeout(4_000)]));
  if (authorization.roots.length || !authorization.deviceResourceLimits) throw Error('The source device did not confirm its sync identity.');
 } else await host.authorizeDevice(ownerId, deviceId, signal);
 context.check();
}

async function readableActivityConfigs(context: RemoteSyncWorkerContext, ids: string[]) {
 const accepted = new Set<string>();
 if (!ids.length) return accepted;
 // Exact batch GET preserves ordinary Thing ACLs. Keep encoded URLs small.
 await context.host.requireCapability('api.things', '1.49.0');
 const read = async (batch: string[]) => {
  const value = await accountRequest(context, '/api/v1/things?' + new URLSearchParams({ ids: JSON.stringify(batch) }));
  if (!Array.isArray(value.things) || value.things.length !== batch.length) throw Error('The saved sync configs could not be verified.');
  value.things.forEach((row: unknown, index: number) => {
   try {
    const config = readOwnedFileSyncConfiguration(row, context.ownerId);
    if (config.id === batch[index] && config.configuration.deviceId === context.deviceId) accepted.add(config.id);
   } catch { /* Missing, shared or unreadable configs contribute no activity. */ }
  });
 };
 let batch: string[] = [];
 for (const id of ids) {
  if (new URLSearchParams({ ids: JSON.stringify([...batch, id]) }).toString().length > 6000) {
   await read(batch);
   batch = [];
  }
  batch.push(id);
 }
 if (batch.length) await read(batch);
 return accepted;
}

/** Serializes only management operations. Starting a transfer admits the
 * existing app-owned runner and returns immediately, leaving Pause available. */
export async function executeRemoteSyncCommand(command: RemoteSyncCommand, context: RemoteSyncWorkerContext, session: DeviceSession): Promise<unknown> {
	context.check();
	const { host, ownerId, deviceId, generation, signal } = context;
	switch (command.action) {
		case 'connection-activity': {
			await host.requireCapability('api.devices-sync-control', REMOTE_SYNC_ACTIVITY_REQUIREMENTS['api.devices-sync-control']);
			await authorizeRemoteHistoryRead(context);
			const value = await accountRequest(context, '/api/v1/things?' + new URLSearchParams({ id: command.connectionId }));
			const config = readOwnedFileSyncConfiguration(value.thing, ownerId);
			if (config.id !== command.connectionId || config.configuration.deviceId !== deviceId)
				throw Error('This sync config does not belong to the selected device.');
			const scope = context.scope(config.id);
			const page = await readNativeSyncActivity(scope, { ...command, signal, currentScope: () => { context.check(); return context.scope(config.id); } });
			return { connectionId: config.id, ...page };
		}
		case 'history': {
			await host.requireCapability('api.devices-sync-control', REMOTE_SYNC_HISTORY_REQUIREMENTS['api.devices-sync-control']);
			await authorizeRemoteHistoryRead(context);
			const scope = { origin: host.origin(), ownerId, deviceId, dataPlane: 'home' };
			const journal = await openSyncJournal();
			try {
				const history = await journal.deviceHistory({ scope, assertCurrent: context.check, signal }).read(command.range);
				context.check();
				return withDeviceSyncHistoryRecordingIssue(scope, history);
			}
			finally { journal.close(); }
		}
		case 'resources': {
			await host.requireCapability('api.devices-sync-control', REMOTE_SYNC_RESOURCE_REQUIREMENTS['api.devices-sync-control']); context.check();
			if (!supportsRemoteResourceControls(host.capabilities)) throw Error('Update the selected Mac and its scanner to manage device resource limits.');
			await host.authorizeDevice(ownerId, deviceId, signal); context.check();
			const result = await host.request(ownerId, { action: 'resources', ...(command.operation === 'save' ? { deviceResourceLimits: command.deviceResourceLimits } : {}) }, signal); context.check();
			if (result.roots.length) throw Error('The resource request returned unexpected folder access.');
			const accepted = parseRemoteSyncResources({ deviceResourceLimits: result.deviceResourceLimits, ...(result.resources ? { resources: result.resources } : {}) });
			// This code runs on the selected device. Its already-running hosts read
			// this shared policy before chunks; stale renderer preferences must not
			// overwrite a policy accepted through remote management.
			const key = deviceResourceKey(host.origin(), ownerId, deviceId);
			if (JSON.stringify(readDeviceSyncResourcePolicy(key)) !== JSON.stringify(accepted.deviceResourceLimits)) saveDeviceSyncResourcePolicy(key, accepted.deviceResourceLimits);
			return accepted;
		}
		case 'status': {
            const directionsReady = await remoteDirectionsReady(context);
			const activityReady = await host.requireCapability('api.devices-sync-control', REMOTE_SYNC_ACTIVITY_REQUIREMENTS['api.devices-sync-control']).then(() => true, () => false);
			context.check();
			const scope = context.scope('remote-sync-status');
			const journal = await openSyncJournal();
			const jobs: RemoteSyncStatus['jobs'] = [];
			const offset = Number(command.cursor ?? 0), pageSize = 32;
			let pageJobs: RemoteSyncStatus['jobs'] = [];
			const task = ownTask(context);
			const activityRows = new Set<string>();
			try {
				const source = journal.jobs({ scope, currentScope: () => { context.check(); return scope; }, signal });
				let after: string | undefined;
				do {
					const page = await source.list(after); context.check();
					for (const job of page.jobs) if (job.scope.deviceId === deviceId && job.scope.origin === scope.origin && job.scope.dataPlane === 'home') {
						jobs.push({ connectionId: job.scope.rootId, state: job.state, ...(job.intervalMs ? { intervalMs: job.intervalMs } : {}),
							...(job.nextRunAt ? { nextRunAt: job.nextRunAt } : {}), ...(job.retryAt ? { retryAt: job.retryAt } : {}),
							...(job.pendingFolderValidation ? { pendingFolderValidation: true as const } : {}),
							...(job.failureReason ? { failureReason: job.failureReason } : {}) });
					}
					after = page.next ?? undefined;
				} while (after);
				jobs.sort((a, b) => a.connectionId.localeCompare(b.connectionId));
				pageJobs = jobs.slice(offset, offset + pageSize);
				if (activityReady) {
					const activeId = task?.active && task.activity ? task.scope.rootId : undefined;
					const ids = [...new Set([...pageJobs.map(job => job.connectionId), ...(activeId ? [activeId] : [])])];
					try {
						const readable = await readableActivityConfigs(context, ids);
						for (const id of readable) activityRows.add(id);
						await Promise.all(pageJobs.map(async job => {
							if (!readable.has(job.connectionId)) return;
							const activityScope = context.scope(job.connectionId);
							try {
								const { records } = await journal.syncActivity({ scope: activityScope, signal, currentScope: () => {
									context.check(); return context.scope(job.connectionId);
								} }).read({ limit: 1 });
								if (records[0]) job.activity = records[0];
							} catch { context.check(); /* An unavailable local receipt is not zero activity. */ }
						}));
					} catch { context.check(); /* Keep ordinary status when the config check is unavailable. */ }
				}
			} finally { journal.close(); }
			const roots = [...session.roots].sort((a, b) => a.id.localeCompare(b.id));
			const snapshot: RemoteSyncStatus = {
				version: 1, ...(activityReady ? { folderEnrollmentVersion: '1.0.0' as const } : {}), ...(directionsReady ? { directionalProgressVersion: '1.0.0' as const } : {}), ...(activityReady ? { connectionActivityVersion: '1.0.0' as const } : {}), deviceId, observedAt: new Date().toISOString(), capabilities: { ...host.capabilities! }, rootsReady: session.rootsReady,
				...(session.rootsObservedAt ? { rootsObservedAt: session.rootsObservedAt } : {}),
				roots: await projectRemoteRoots(context, roots.slice(offset, offset + pageSize)), jobs: pageJobs.map(job => {
                    const cached = directionsReady ? readStampedCache<ForegroundSyncProgress>('tt:sync-progress:' + syncScopeKey(context.scope(job.connectionId))) : null;
                    let directions; try { directions = cached?.directions ? parseSyncDirections(cached.directions) : undefined; } catch { /* Invalid historical data stays absent. */ }
                    return { ...job, ...(directions && cached ? { progress: { directions, totalFinal: cached.totalFinal, indexState: cached.indexState, statisticsObservedAt: cached.statisticsObservedAt, stage: cached.stage } } : {}) };
                }),
				...(offset + pageSize < Math.max(roots.length, jobs.length) ? { nextCursor: String(offset + pageSize) } : {}),
				task: task ? { connectionId: task.scope.rootId, active: task.active, stopping: task.stopping, status: task.status,
					waiting: task.waiting, progress: directionsReady ? structuredClone(task.progress) : (() => { const { directions: _directions, ...legacy } = task.progress; return structuredClone(legacy); })(),
					...(task.active && task.activity && activityRows.has(task.scope.rootId) ? { activity: structuredClone(task.activity) } : {}),
					...(task.progressDescriptor ? { progressDescriptor: structuredClone(task.progressDescriptor) } : {}),
					...(task.inventoryDescriptor ? { inventoryDescriptor: structuredClone(task.inventoryDescriptor) } : {}),
					...(task.transferSeries ? { transferRates: {
						upload: task.transferSeries.read({ direction: 'upload', unit: 'Mbps', windowMs: 5000 }),
						download: task.transferSeries.read({ direction: 'download', unit: 'Mbps', windowMs: 5000 }) } } : {}),
					...(task.pagedReview ? { review: { id: reviewId(task.pagedReview), view: structuredClone(task.pagedReview.getSnapshot()) } } : {}) } : null
			};
			// The existing status heartbeat carries one current device-wide sample.
			// No folder grants or transfer admission are needed, including paused jobs.
			if (!command.cursor && supportsRemoteResourceControls(host.capabilities)) {
				try { snapshot.resourceUsage = parseRemoteSyncResources(await executeRemoteSyncCommand({ action: 'resources', operation: 'read' }, context, session)); }
				catch { context.check(); /* Older origins/native failures leave measurements explicitly unavailable. */ }
			}
			return snapshot;
		}
		case 'folders': {
			const request = command.request;
			if (ownTask(context)?.active) {
				if (request.action === 'list' && session.rootsReady) return { roots: await projectRemoteRoots(context, structuredClone(session.roots)) };
				throw Error('Pause the current transfer before changing folder access or recovering device files.');
			}
			if ('trash' in request) {
				const scope = request.trash.scope;
				if (scope.ownerId !== ownerId || scope.deviceId !== deviceId || scope.origin !== host.origin() || scope.dataPlane !== 'home')
					throw Error('The recovery item belongs to a different account or device.');
			}
			await host.authorizeDevice(ownerId, deviceId, signal); context.check();
			const result = await host.request(ownerId, request, signal); context.check();
			session.roots = result.roots; session.rootsReady = true; session.rootsObservedAt = new Date().toISOString();
			return { ...result, roots: await projectRemoteRoots(context, result.roots) };
		}
		case 'start': {
			const saved = await readRemoteSyncConfiguration(context, command.connectionId);
			if (saved.updatedAt !== command.expectedUpdatedAt)
				throw Error('The connection changed. Refresh its saved settings before starting sync.');
			if (saved.configuration.paused) throw Error('Unpause this connection in its saved settings before starting sync.');
			if (command.queueOnly && saved.configuration.sourceKind === 'photos')
				throw Error('Automatic folder enrollment requires a saved folder sync config.');
			if (command.intervalMs !== undefined && saved.configuration.sourceKind !== 'photos') {
				const job = await enrollNativeFolderSync(saved, context.scope(saved.id), generation, command.intervalMs, signal,
					{ queue: command.queueOnly, respectPause: command.queueOnly });
				context.check();
				if (!job || job.reviewed.id !== saved.id || job.reviewed.updatedAt !== saved.updatedAt || job.intervalMs !== command.intervalMs)
					throw Error('The saved automatic sync job could not be confirmed.');
				return { accepted: true, folderEnrollmentVersion: '1.0.0', connectionId: saved.id, expectedUpdatedAt: saved.updatedAt, intervalMs: command.intervalMs, pendingFolderValidation: !!job.pendingFolderValidation };
			}
			if (nativeSyncTasks.read()?.active) throw Error('A transfer is already running. Pause it before starting another sync config.');
			await host.authorizeDevice(ownerId, deviceId, signal); context.check();
			const running = startNativeSyncTask(saved, context.scope(saved.id), generation, undefined, command.intervalMs);
			// The runtime publishes a synchronous starting snapshot and retains the
			// promise. Its later failures appear in status, never an unhandled rejection.
			void running.catch(() => {});
			const task = ownTask(context);
			if (!task?.active || task.scope.rootId !== saved.id) await running;
			context.check();
			return { accepted: true };
		}
		case 'pause': {
			await pauseNativeSyncJob(context.scope(command.connectionId), generation, () => readRemoteSyncConfiguration({
				...context, signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)])
			}, command.connectionId));
			context.check();
			return { accepted: true };
		}
		case 'review': {
			const task = ownTask(context), controller = task?.pagedReview;
			if (!controller || task!.scope.rootId !== command.connectionId || reviewId(controller) !== command.reviewId)
				throw Error('This conflict review changed. Refresh before applying a choice.');
			switch (command.operation) {
				case 'reload': await controller.reload(); break;
				case 'next': await controller.next(); break;
				case 'previous': await controller.previous(); break;
				case 'choose': await controller.choose(command.path!, command.from!, command.revision!); break;
				case 'finish':
					if (controller.getSnapshot().page?.progress.revision !== command.revision) throw Error('Saved conflict choices changed. Refresh the review before applying.');
					await controller.finish(command.resolution!); break;
				case 'cancel': controller.cancel(); break;
			}
			context.check(); return structuredClone(controller.getSnapshot());
		}
		default: return executeRemoteSyncDetails(command, context);
	}
}

/** Polls only verified local pairings. Account ownership at the mailbox never
 * substitutes for the signed host's owner/device/origin authorization. */
export function startRemoteSyncWorker(ownerId: string, generation: number, parentSignal: AbortSignal) {
	const controller = new AbortController(), signal = AbortSignal.any([parentSignal, controller.signal]);
	const adapter = getNativeSyncAdapter();
	if (!adapter || adapter.platform !== 'macos' || !adapter.bridge.nodeGetStatus) return () => {};
	const origin = window.location.origin, sessions = new Map<string, DeviceSession>();
	let timer: ReturnType<typeof setTimeout> | undefined, stopped = false, releaseWindow: (() => Promise<void>) | undefined;
	let historyRead: Promise<void> | undefined;
	let enrollment: { deviceId: string; origin: string; connectionId: string; controller: AbortController } | undefined;
	const check = () => {
		signal.throwIfAborted();
		if (stopped || rootIdentity.read().pending || rootIdentity.read().generation !== generation || window.location.origin !== origin || !isNativeSyncAdapterCurrent(adapter))
			throw Error('The remote sync account changed.');
	};
	const run = async () => {
		try {
			check();
			const local = await adapter.bridge.nodeGetStatus!(); check();
			if (local.pairingStatus !== 'paired') return;
			const candidates = [...new Set(local.deviceIds?.length ? local.deviceIds : local.deviceId ? [local.deviceId] : [])];
			for (const deviceId of candidates) {
				check();
				try {
					let session = sessions.get(deviceId);
					try { (session?.nativeHost ?? session?.host)?.assertCurrent(); } catch { sessions.delete(deviceId); session = undefined; }
					if (!session) {
						const live = nativeSyncTasks.read();
						const activeHost = live?.scope.ownerId === ownerId && live.scope.deviceId === deviceId && live.scope.dataPlane === 'home' ? live.host : undefined;
						activeHost?.assertCurrent();
						const nativeHost = activeHost ?? await createNativeSyncHost({ ownerId, deviceId, adapter, signal, assertCurrent: check }); check();
						for (const [feature, minimum] of Object.entries(REMOTE_SYNC_REQUIREMENTS)) await nativeHost.requireCapability(feature, minimum);
						check();
						// The mailbox transport outlives any particular transfer. Pausing
						// must still acknowledge after that transfer aborts its native host.
						const verifiedOrigin = nativeHost.origin();
						const host: FolderHost = { ...nativeHost, origin: () => { check(); return verifiedOrigin; }, assertCurrent: check,
							fetch: createFolderHostFetch({ origin: verifiedOrigin, localOrigin: origin, ownerId, signal, check,
								fetch: (target, init) => window.fetch(target, init) }) };
						session = { host, nativeHost, roots: [], rootsReady: false }; sessions.set(deviceId, session);
					}
					const bound = session;
					const context: RemoteSyncWorkerContext = { ownerId, deviceId, generation, host: bound.host, signal,
						check: () => { check(); bound.host.assertCurrent(); },
						scope: connectionId => ({ origin: bound.host.origin(), ownerId, deviceId, dataPlane: 'home', rootId: connectionId }) };
					// Folder discovery is never allowed to delay Pause behind native IO.
					if ((!session.rootsReady || Date.now() - Date.parse(session.rootsObservedAt ?? '') >= 30_000) && !enrollment && !nativeSyncTasks.read()?.active) {
						try {
							session.roots = (await session.host.request(ownerId, { action: 'list' }, AbortSignal.any([signal, AbortSignal.timeout(10_000)]))).roots;
							session.rootsReady = true; session.rootsObservedAt = new Date().toISOString(); check();
						} catch { check(); /* Keep previously observed roots during native contention. */ }
					}
					const response = await accountRequest(context, '/api/v1/devices/sync-control', { action: 'poll', deviceId });
					if (!releaseWindow) {
						const release = await holdDesktopSyncWindow(adapter.bridge);
						if (stopped || signal.aborted) { await release(); check(); }
						releaseWindow = release; check();
					}
					const pending = response.command;
					if (!pending) continue;
					if (typeof pending.id !== 'string' || typeof pending.leaseId !== 'string' || !Number.isFinite(Date.parse(pending.expiresAt)) || Date.parse(pending.expiresAt) <= Date.now()) continue;
					let command: RemoteSyncCommand | undefined;
					try { command = validateRemoteSyncCommand(pending.command); } catch { /* Reply on the same claimed lease below. */ }
					const history = command?.action === 'history' || command?.action === 'connection-activity';
					const timedStart = command?.action === 'start' && command.intervalMs !== undefined ? command : undefined;
					const runCommand = async (blocked?: string, enrollmentSignal?: AbortSignal) => {
						const deadline = Math.max(1, Date.parse(pending.expiresAt) - Date.now());
						const commandSignal = AbortSignal.any([signal, AbortSignal.timeout(history ? Math.min(deadline, 25_000) : deadline), ...(enrollmentSignal ? [enrollmentSignal] : [])]);
						const commandContext = { ...context, signal: commandSignal, check: () => { commandSignal.throwIfAborted(); context.check(); } };
						let result: unknown, error: string | undefined;
						try {
							if (!command) throw Error('Invalid remote sync command.');
							if (blocked) throw Error(blocked);
							result = await executeRemoteSyncCommand(command, commandContext, bound);
							if (new TextEncoder().encode(JSON.stringify(result)).byteLength > REMOTE_SYNC_RESULT_BYTES) throw Error('This device response needs a smaller page. Refresh and retry.');
						} catch (cause) {
							const message = cause instanceof Error ? cause.message : '';
							error = history && commandSignal.aborted && !signal.aborted ? 'Sync history took too long to read on the source device. Refresh to retry.' :
								message && message.length <= 512 ? message : 'The device could not complete this sync action. Refresh its status and retry.';
						}
						context.check();
						const replyContext = history || timedStart ? { ...context, signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]) } : context;
						await accountRequest(replyContext, '/api/v1/devices/sync-control', { action: 'complete', deviceId, requestId: pending.id, leaseId: pending.leaseId,
							...(error ? { error } : { result }) });
					};
					// Consent can wait on the source device. Keep polling so an
					// exact Pause can cancel it before or after native approval begins.
					if (timedStart && !enrollment) {
						const activeEnrollment = { deviceId, origin: context.host.origin(), connectionId: timedStart.connectionId,
							controller: new AbortController() };
						enrollment = activeEnrollment;
						void runCommand(undefined, activeEnrollment.controller.signal).catch(() => {}).finally(() => {
							if (enrollment === activeEnrollment) enrollment = undefined;
						});
					} else if (command?.action === 'pause') {
						if (enrollment?.deviceId === deviceId && enrollment.origin === context.host.origin() && enrollment.connectionId === command.connectionId)
							enrollment.controller.abort(new DOMException('Automatic sync setup was paused.', 'AbortError'));
						await runCommand();
					} else if (history && !historyRead) {
						historyRead = runCommand().catch(() => {}).finally(() => { historyRead = undefined; });
					} else if (history) {
						await runCommand('The source device is reading another Sync history range. Retry after it finishes.');
					} else if (enrollment && command && command.action !== 'status') {
						await runCommand('The source device is confirming another automatic sync setup. Check its status before retrying.');
					} else await runCommand();
				} catch {
					// Missing capability, revoked pairing, disconnect or an uncertain
					// completion waits for the next poll. Claimed commands never replay.
					check(); sessions.delete(deviceId);
				}
			}
		} catch { /* Identity teardown or temporary native availability. */ }
		finally { if (!stopped && !signal.aborted) timer = setTimeout(run, 2000); }
	};
	const stop = () => { if (stopped) return; stopped = true; controller.abort(); clearTimeout(timer); sessions.clear(); void releaseWindow?.().catch(() => {}); releaseWindow = undefined; };
	signal.addEventListener('abort', stop, { once: true });
	timer = setTimeout(run, 0);
	return () => { stop(); signal.removeEventListener('abort', stop); };
}
