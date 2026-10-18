import { parseFileSyncConfiguration } from './configuration';
import type { SavedFileSyncConfiguration } from './configuredPlan';
import { journalScope, type JournalAccess } from './journalScope';
import { syncScopeKey, type SyncScope } from './reconcile';

const STORE = 'sync-admitted-jobs';
export const SYNC_JOB_PAGE_SIZE = 32;
export const MAX_SYNC_JOBS_PER_ACCOUNT = 256;
export type SyncJob = {
	version: 1; key: string; id: string; revision: number;
	scope: SyncScope; reviewed: SavedFileSyncConfiguration;
	state: 'runnable' | 'paused' | 'attention' | 'complete';
};
export function upgradeSyncJobJournal(db: IDBDatabase) {
	if (!db.objectStoreNames.contains(STORE)) {
		const store = db.createObjectStore(STORE, { keyPath: 'key' });
		store.createIndex('account', ['scope.ownerId', 'key'], { unique: true });
	}
}
function canonical(saved: SavedFileSyncConfiguration, scope: SyncScope): SavedFileSyncConfiguration {
	if (!saved || saved.id !== scope.rootId || typeof saved.updatedAt !== 'string' || !Number.isFinite(Date.parse(saved.updatedAt)))
		throw Error('The admitted sync connection changed.');
	const configuration = parseFileSyncConfiguration(saved.configuration);
	if (scope.dataPlane !== 'home' || configuration.deviceId !== scope.deviceId) throw Error('The admitted sync device changed.');
	return { id: saved.id, updatedAt: saved.updatedAt, configuration };
}
function validate(value: SyncJob): SyncJob {
	if (!value || value.version !== 1 || value.key !== syncScopeKey(value.scope) ||
		!Number.isSafeInteger(value.revision) || value.revision < 1 ||
		!['runnable', 'paused', 'attention', 'complete'].includes(value.state) ||
		typeof value.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value.id) ||
		JSON.stringify(canonical(value.reviewed, value.scope)) !== JSON.stringify(value.reviewed))
		throw Error('Invalid saved sync job.');
	return value;
}

/** Explicit execution admission, not file history or native permission.
 * One bounded record per connection. All IO still rechecks the live account,
 * configuration and native grants. Call admission/resume under the root lock. */
export function syncJobJournal(db: IDBDatabase, access: JournalAccess, keyRange?: typeof IDBKeyRange) {
	const bound = journalScope(db, access, keyRange), ranges = keyRange ?? globalThis.IDBKeyRange;
	const accountRange = (after?: string) => ranges.bound([bound.scope.ownerId, ...(after ? [after] : [])], [bound.scope.ownerId, []], !!after);
	const read = () => bound.transaction<SyncJob | null>([STORE], 'readonly', (tx, done, fail) => {
		const request = tx.objectStore(STORE).get(bound.key);
		request.onsuccess = () => { try { done(request.result ? validate(request.result) : null); } catch (error) { fail(error); } };
	});
	return {
		read,
		/** Discovery is account-scoped across origins/devices. Each candidate is
		 * independently checked against the native selected origin before IO. */
		list: (after?: string) => bound.transaction<{ jobs: SyncJob[]; next?: string }>([STORE], 'readonly', (tx, done, fail) => {
			if (after !== undefined && (typeof after !== 'string' || after.length > 4096)) throw Error('Invalid sync job cursor.');
			const request = tx.objectStore(STORE).index('account').openCursor(accountRange(after));
			const jobs: SyncJob[] = [];
			request.onsuccess = () => {
				try {
					const cursor = request.result;
					if (!cursor) { done({ jobs }); return; }
					if (jobs.length === SYNC_JOB_PAGE_SIZE) { done({ jobs, next: jobs.at(-1)!.key }); return; }
					const job = validate(cursor.value);
					if (job.scope.ownerId !== bound.scope.ownerId) throw Error('Sync job account changed.');
					jobs.push(job); cursor.continue();
				} catch (error) { fail(error); }
			};
		}),
		admit: (saved: SavedFileSyncConfiguration, id: string) => bound.transaction<SyncJob>([STORE], 'readwrite', (tx, done, fail) => {
			const reviewed = canonical(saved, bound.scope), store = tx.objectStore(STORE), request = store.get(bound.key);
			request.onsuccess = () => {
				try {
					const previous = request.result ? validate(request.result) : null;
					if (previous && previous.state !== 'complete' && JSON.stringify(previous.reviewed.configuration) !== JSON.stringify(reviewed.configuration))
						throw Error('An unfinished sync job belongs to different settings. Restore its settings before retrying.');
					const job = validate({ version: 1, key: bound.key, id: previous && previous.state !== 'complete' ? previous.id : id,
						revision: (previous?.revision ?? 0) + 1, scope: bound.scope, reviewed, state: 'runnable' });
					const count = store.index('account').count(accountRange());
					count.onsuccess = () => {
						if (!previous && count.result >= MAX_SYNC_JOBS_PER_ACCOUNT) { fail(Error('This account has reached its saved sync job limit.')); return; }
						store.put(job); done(job);
					};
				} catch (error) { fail(error); }
			};
		}),
		/** CAS prevents an old discovery or late completion from reviving a
		 * stopped job, replacing a newer attempt, or replaying completed work. */
		transition: (expected: SyncJob, state: SyncJob['state']) => bound.transaction<SyncJob | null>([STORE], 'readwrite', (tx, done, fail) => {
			validate(expected);
			if (expected.key !== bound.key) throw Error('Sync job scope changed.');
			const store = tx.objectStore(STORE), request = store.get(bound.key);
			request.onsuccess = () => {
				try {
					const current = request.result ? validate(request.result) : null;
					if (!current || current.state !== 'runnable' || current.id !== expected.id || current.revision !== expected.revision) { done(null); return; }
					const next = validate({ ...current, state, revision: current.revision + 1 }); store.put(next); done(next);
				} catch (error) { fail(error); }
			};
		})
	};
}
