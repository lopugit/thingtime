import { rootIdentity } from '../utils/rootIdentity';
import { createNativeSyncHost, getNativeSyncAdapter, isNativeSyncAdapterCurrent } from './nativeSyncHost.client';
import type { FolderHost } from './desktopFolders.client';
import type { MobileFolder } from './mobileFolders.client';
import { nativeSyncTasks, pauseNativeSyncJob, startNativeSyncTask } from './nativeSyncTasks.client';
import { readOwnedFileSyncConfiguration } from './configuredPlan';
import { openSyncJournal } from './journal.client';
import { holdDesktopSyncWindow } from './desktopSyncWindow.client';
import { createFolderHostFetch } from './folderHostFetch.client';
import { executeRemoteSyncDetails } from './remoteSyncDetails.client';
import type { SyncScope } from './reconcile';
import { REMOTE_SYNC_RESULT_BYTES, validateRemoteSyncCommand, type RemoteSyncCommand, type RemoteSyncStatus } from './remoteSyncProtocol';

export const REMOTE_SYNC_REQUIREMENTS = { 'api.devices-sync-control': '1.0.0' } as const;
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
const ownTask = (context: RemoteSyncWorkerContext) => {
	const task = nativeSyncTasks.read();
	return task?.scope.ownerId === context.ownerId && task.scope.deviceId === context.deviceId && task.scope.origin === context.host.origin() && task.scope.dataPlane === 'home' ? task : null;
};

/** Serializes only management operations. Starting a transfer admits the
 * existing app-owned runner and returns immediately, leaving Pause available. */
export async function executeRemoteSyncCommand(command: RemoteSyncCommand, context: RemoteSyncWorkerContext, session: DeviceSession): Promise<unknown> {
	context.check();
	const { host, ownerId, deviceId, generation, signal } = context;
	switch (command.action) {
		case 'status': {
			const scope = context.scope('remote-sync-status');
			const journal = await openSyncJournal();
			const jobs: RemoteSyncStatus['jobs'] = [];
			try {
				const source = journal.jobs({ scope, currentScope: () => { context.check(); return scope; }, signal });
				let after: string | undefined;
				do {
					const page = await source.list(after); context.check();
					for (const job of page.jobs) if (job.scope.deviceId === deviceId && job.scope.origin === scope.origin && job.scope.dataPlane === 'home') {
						jobs.push({ connectionId: job.scope.rootId, state: job.state, ...(job.intervalMs ? { intervalMs: job.intervalMs } : {}),
							...(job.nextRunAt ? { nextRunAt: job.nextRunAt } : {}), ...(job.retryAt ? { retryAt: job.retryAt } : {}) });
					}
					after = page.next ?? undefined;
				} while (after);
			} finally { journal.close(); }
			const task = ownTask(context), offset = Number(command.cursor ?? 0), pageSize = 32;
			const roots = [...session.roots].sort((a, b) => a.id.localeCompare(b.id));
			jobs.sort((a, b) => a.connectionId.localeCompare(b.connectionId));
			const snapshot: RemoteSyncStatus = {
				version: 1, deviceId, observedAt: new Date().toISOString(), capabilities: { ...host.capabilities! }, rootsReady: session.rootsReady,
				...(session.rootsObservedAt ? { rootsObservedAt: session.rootsObservedAt } : {}),
				roots: roots.slice(offset, offset + pageSize), jobs: jobs.slice(offset, offset + pageSize),
				...(offset + pageSize < Math.max(roots.length, jobs.length) ? { nextCursor: String(offset + pageSize) } : {}),
				task: task ? { connectionId: task.scope.rootId, active: task.active, stopping: task.stopping, status: task.status,
					waiting: task.waiting, progress: structuredClone(task.progress),
					...(task.progressDescriptor ? { progressDescriptor: structuredClone(task.progressDescriptor) } : {}),
					...(task.inventoryDescriptor ? { inventoryDescriptor: structuredClone(task.inventoryDescriptor) } : {}),
					...(task.transferSeries ? { transferRates: {
						upload: task.transferSeries.read({ direction: 'upload', unit: 'Mbps', windowMs: 5000 }),
						download: task.transferSeries.read({ direction: 'download', unit: 'Mbps', windowMs: 5000 }) } } : {}),
					...(task.pagedReview ? { review: { id: reviewId(task.pagedReview), view: structuredClone(task.pagedReview.getSnapshot()) } } : {}) } : null
			};
			return snapshot;
		}
		case 'folders': {
			const request = command.request;
			if (ownTask(context)?.active) {
				if (request.action === 'list' && session.rootsReady) return { roots: structuredClone(session.roots) };
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
			return result;
		}
		case 'start': {
			if (nativeSyncTasks.read()?.active) throw Error('A transfer is already running. Pause it before starting another connection.');
			const result = await accountRequest(context, `/api/v1/things?${new URLSearchParams({ id: command.connectionId })}`);
			const saved = readOwnedFileSyncConfiguration(result.thing, ownerId);
			if (saved.id !== command.connectionId || saved.configuration.deviceId !== deviceId || saved.updatedAt !== command.expectedUpdatedAt)
				throw Error('The connection changed. Refresh its saved settings before starting sync.');
			if (saved.configuration.paused) throw Error('Unpause this connection in its saved settings before starting sync.');
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
		case 'pause': await pauseNativeSyncJob(context.scope(command.connectionId), generation); context.check(); return { accepted: true };
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
					if ((!session.rootsReady || Date.now() - Date.parse(session.rootsObservedAt ?? '') >= 30_000) && !nativeSyncTasks.read()?.active) {
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
					const commandSignal = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Date.parse(pending.expiresAt) - Date.now()))]);
					const commandContext = { ...context, signal: commandSignal, check: () => { commandSignal.throwIfAborted(); context.check(); } };
					let result: unknown, error: string | undefined;
					try {
						result = await executeRemoteSyncCommand(validateRemoteSyncCommand(pending.command), commandContext, bound);
						if (new TextEncoder().encode(JSON.stringify(result)).byteLength > REMOTE_SYNC_RESULT_BYTES) throw Error('This device response needs a smaller page. Refresh and retry.');
					} catch (cause) {
						const message = cause instanceof Error ? cause.message : '';
						error = message && message.length <= 512 ? message : 'The device could not complete this sync action. Refresh its status and retry.';
					}
					context.check();
					await accountRequest(context, '/api/v1/devices/sync-control', { action: 'complete', deviceId, requestId: pending.id, leaseId: pending.leaseId,
						...(error ? { error } : { result }) });
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
