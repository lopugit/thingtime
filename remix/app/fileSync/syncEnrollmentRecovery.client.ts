import { requireThingtimeCapability } from '../api/utils/capabilities/requireCapability.client';
import { rootIdentity } from '../utils/rootIdentity';
import {
	claimSyncEnrollment, CONFIGURATION_DRAFT_PREFIX, configurationDraftKey, persistConfigurationDrafts,
	readConfigurationDrafts, readSavedSyncEnrollment, SYNC_ENROLLMENT_RECOVERED_EVENT, type ConfigurationDraft, type ConfigurationEditorScope
} from './configurationEditor';
import { createNativeSyncHost, isNativeSyncAdapterCurrent, type NativeSyncAdapter } from './nativeSyncHost.client';
import { enrollNativeFolderSync, nativeSyncTasks } from './nativeSyncTasks.client';
import { createRemoteSyncClient } from './remoteSyncClient.client';
import { assertRemoteFolderEnrollment, REMOTE_SYNC_ENROLLMENT_REQUIREMENTS, type RemoteSyncStatus } from './remoteSyncProtocol';
import { validateSyncScope } from './reconcile';

const retryAfter = new Map<string, number>();
const BATCH = 2;
const retryMs = 60_000;
function savedScope(key: string, ownerId: string): ConfigurationEditorScope | null {
	try {
		const value = JSON.parse(key.slice(CONFIGURATION_DRAFT_PREFIX.length)) as ConfigurationEditorScope;
		if (!value || Object.keys(value).length !== 4 || value.ownerId !== ownerId || value.dataPlane !== 'home' ||
			configurationDraftKey(value) !== key) return null;
		validateSyncScope({ ...value, rootId: 'automatic-setup-recovery' });
		return value;
	} catch { return null; }
}

/** Resume only cloud commits the user already authorized through Save & sync.
 * The normal job discovery owns execution after admission; this does not
 * replay settings writes, prompt for a grant, or invent another scheduler. */
export async function recoverSavedSyncEnrollments(ownerId: string, generation: number, signal: AbortSignal, adapter?: NativeSyncAdapter) {
	let storage: Storage;
	try { storage = window.localStorage; if (!storage || typeof storage.key !== 'function') return; } catch { return; }
	const rendererOrigin = window.location.origin;
	const checkIdentity = () => {
		signal.throwIfAborted();
		const identity = rootIdentity.read();
		if (identity.pending || identity.generation !== generation || window.location.origin !== rendererOrigin)
			throw Error('The active account or sync server changed.');
	};
	const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string =>
		typeof key === 'string' && key.startsWith(CONFIGURATION_DRAFT_PREFIX));
	const now = Date.now();
	for (const [key, until] of retryAfter) if (until <= now) retryAfter.delete(key);
	let attempted = 0;
	for (const key of keys) {
		if (attempted >= BATCH) break;
		checkIdentity();
		const scope = savedScope(key, ownerId);
		if (!scope) continue;
		const state = { raw: null as string | null, drafts: [] as ConfigurationDraft[] };
		try { state.raw = storage.getItem(key); state.drafts = readConfigurationDrafts(state.raw, scope.deviceId); } catch { continue; }
		for (const draft of state.drafts) {
			if (attempted >= BATCH) break;
			const intent = draft.enrollment;
			if (!intent?.transport || draft.configuration.paused || draft.configuration.sourceKind === 'photos') continue;
			const local = intent.transport === 'local';
			if (local ? !adapter || (adapter.platform === 'ios' && (scope.origin !== rendererOrigin || document.visibilityState === 'hidden')) : scope.origin !== rendererOrigin) continue;
			const binding = { ...scope, rootId: draft.id };
			const attemptKey = JSON.stringify([key, draft.id, intent.savedRevision]);
			if (retryAfter.has(attemptKey) || (local && nativeSyncTasks.isPaused(binding))) continue;
			const cancellation = new AbortController();
			const release = claimSyncEnrollment(scope, () => cancellation.abort());
			if (!release) break;
			attempted++;
			const deadline = AbortSignal.any([signal, cancellation.signal, AbortSignal.timeout(12_000)]);
			const changed = (event: StorageEvent) => {
				if (event.key !== key && event.key !== null) return;
				try { if (storage.getItem(key) !== state.raw) cancellation.abort(); } catch { cancellation.abort(); }
			};
			window.addEventListener('storage', changed);
			const current = () => {
				checkIdentity(); deadline.throwIfAborted();
				if (storage.getItem(key) !== state.raw || (local && (!adapter || !isNativeSyncAdapterCurrent(adapter) || nativeSyncTasks.isPaused(binding))))
					throw Error('This saved automatic setup changed.');
			};
			const writeDrafts = (next: ConfigurationDraft[]) => {
				current();
				const previous = state.raw;
				state.raw = persistConfigurationDrafts(storage, key, previous, next);
				state.drafts = next;
				window.dispatchEvent(new CustomEvent(SYNC_ENROLLMENT_RECOVERED_EVENT, { detail: { key, previous, raw: state.raw } }));
			};
			try {
				const host = local && adapter ? await createNativeSyncHost({ adapter, ownerId, deviceId: scope.deviceId, signal: deadline, assertCurrent: current }) : null;
				current();
				if (host && host.origin() !== scope.origin) { retryAfter.set(attemptKey, Date.now() + retryMs); continue; }
				if (host) await host.requireCapability('api.things', '1.36.0');
				else {
					await requireThingtimeCapability('api.things', '1.36.0', scope.origin);
					await requireThingtimeCapability('api.devices-sync-control', REMOTE_SYNC_ENROLLMENT_REQUIREMENTS['api.devices-sync-control'], scope.origin);
				}
				const saved = await readSavedSyncEnrollment(draft, scope, { assertCurrent: current, get: async id => {
					const url = new URL('/api/v1/things', scope.origin);
					url.searchParams.set('id', id);
					const fetcher = host?.fetch ?? ((input, init) => window.fetch(input, init));
					const response = await fetcher(url, { signal: deadline, credentials: 'same-origin', redirect: 'error', cache: 'no-store',
						headers: { 'X-Thingtime-Expected-Actor': ownerId, 'X-Thingtime-Expected-Api-Origin': scope.origin, 'X-Thingtime-Expected-Data-Plane': 'home' } });
					current();
					if (response.redirected || !response.ok) throw Object.assign(Error('Could not read the saved automatic setup.'), { status: response.status });
					return (await response.json()).thing as unknown;
				} });
				if (!saved) { retryAfter.set(attemptKey, Date.now() + retryMs); continue; }
				if (!intent.savedRevision) writeDrafts(state.drafts.map(row => row.id === draft.id ? { ...row, enrollment: { ...intent, savedRevision: saved.updatedAt } } : row));
				current();
				if (local) {
					const job = await enrollNativeFolderSync(saved, binding, generation, intent.intervalMs, deadline, { queue: true, respectPause: true });
					if (job.reviewed.updatedAt !== saved.updatedAt || job.intervalMs !== intent.intervalMs) throw Error('The saved automatic setup was not confirmed.');
				} else {
					const client = createRemoteSyncClient({ ...scope, signal: deadline, assertCurrent: current });
					const status = await client.send<RemoteSyncStatus>({ action: 'status' }, { timeoutMs: 6_000 });
					current();
					if (status.deviceId !== scope.deviceId || status.folderEnrollmentVersion !== '1.0.0') throw Error('The device could not confirm automatic setup.');
					const expected = { connectionId: saved.id, expectedUpdatedAt: saved.updatedAt, intervalMs: intent.intervalMs };
					assertRemoteFolderEnrollment(await client.send({ action: 'start', ...expected, queueOnly: true }), expected);
				}
				writeDrafts(state.drafts.filter(row => row.id !== saved.id));
			} catch {
				checkIdentity();
				// Leave the exact request visible for review. A later existing
				// discovery tick may retry a changed network or device condition.
				retryAfter.set(attemptKey, Date.now() + retryMs);
			} finally { window.removeEventListener('storage', changed); release(); }
		}
	}
}
